/**
 * File d'attente hors ligne GODAC.
 * IndexedDB (pas localStorage) permet de conserver les mutations et les photos
 * encodées même si l'onglet est fermé ou le téléphone redémarre.
 */
import { decisionApresEchec, rejouablePar } from "@/lib/offline/rejeu";
import { avecVerrouRejeu } from "@/lib/offline/verrou-onglets";

export type OfflineMutation = {
  id: string;
  /** Compte qui a enregistré l'action : jamais rejouée sous un autre compte (tablette partagée). */
  userId?: string | null;
  url: string;
  method: string;
  body: string | null;
  headers?: Record<string, string>;
  createdAt: string;
  attempts: number;
  lastError?: string;
};
const DB_NAME = "godac-offline-v1";
const STORE = "outbox";
const FILE_STORE = "files";
const CHANGE_EVENT = "godac:offline-queue-change";

function dbOpen(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") return reject(new Error("Stockage hors ligne indisponible sur cet appareil."));
    const request = indexedDB.open(DB_NAME, 2);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: "id" });
      if (!db.objectStoreNames.contains(FILE_STORE)) db.createObjectStore(FILE_STORE, { keyPath: "id" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Ouverture du stockage hors ligne impossible."));
  });
}
function signal() {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(CHANGE_EVENT));
}
/** Compte connecté sur cet appareil (session locale, sans appel réseau). */
async function utilisateurCourant(): Promise<string | null> {
  try {
    const { createBrowserSupabaseClient } = await import("@/lib/supabase/client");
    const { data } = await createBrowserSupabaseClient().auth.getSession();
    return data.session?.user.id ?? null;
  } catch {
    return null;
  }
}

export type OfflineFile = { id: string; userId?: string | null; blob: Blob; name: string; type: string; createdAt: string; initUrl: string; processUrl: string; bucket: string };

export async function listOfflineFiles(): Promise<OfflineFile[]> {
  const db = await dbOpen();
  return new Promise((resolve, reject) => {
    const request = db.transaction(FILE_STORE, "readonly").objectStore(FILE_STORE).getAll();
    request.onsuccess = () => resolve((request.result as OfflineFile[]).sort((a, b) => a.createdAt.localeCompare(b.createdAt)));
    request.onerror = () => reject(request.error);
  });
}
export async function enqueueOfflineFile(file: File, options?: { initUrl?: string; processUrl?: string; bucket?: string }): Promise<string> {
  const id = crypto.randomUUID();
  const userId = await utilisateurCourant();
  const db = await dbOpen();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(FILE_STORE, "readwrite");
    tx.objectStore(FILE_STORE).add({ id, userId, blob: file, name: file.name, type: file.type || "application/octet-stream", createdAt: new Date().toISOString(), initUrl: options?.initUrl ?? "/api/ocr/tour-report/init", processUrl: options?.processUrl ?? "/api/ocr/tour-report/process", bucket: options?.bucket ?? "tour-photos" } satisfies OfflineFile);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  signal();
  return "offline://" + id;
}
async function getOfflineFile(id: string): Promise<OfflineFile | null> {
  const db = await dbOpen();
  return new Promise((resolve, reject) => {
    const request = db.transaction(FILE_STORE, "readonly").objectStore(FILE_STORE).get(id);
    request.onsuccess = () => resolve((request.result as OfflineFile | undefined) ?? null);
    request.onerror = () => reject(request.error);
  });
}
async function removeOfflineFile(id: string) {
  const db = await dbOpen();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(FILE_STORE, "readwrite");
    tx.objectStore(FILE_STORE).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  signal();
}
async function uploadOfflineFile(id: string): Promise<string> {
  const item = await getOfflineFile(id);
  if (!item) throw new Error("Le fichier local lié à ce document est introuvable.");
  if (item.userId && item.userId !== (await utilisateurCourant())) throw new Error("Ce document a été enregistré sous un autre compte.");
  const init = await fetch(item.initUrl, { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ contentType: item.type }) });
  const initJson = await init.json().catch(() => ({})) as { storagePath?: string; error?: string };
  if (!init.ok || !initJson.storagePath) throw new Error(initJson.error ?? "Impossible de préparer l'envoi du document.");
  const { createBrowserSupabaseClient } = await import("@/lib/supabase/client");
  const supabase = createBrowserSupabaseClient();
  const file = new File([item.blob], item.name, { type: item.type });
  const uploaded = await supabase.storage.from(item.bucket).upload(initJson.storagePath, file, { contentType: item.type });
  if (uploaded.error) throw new Error(uploaded.error.message);
  // Lecture OCR du document : best effort, le document est déjà envoyé.
  const lecture = await fetch(item.processUrl, { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ storagePath: initJson.storagePath }) }).catch(() => null);
  if (!lecture?.ok) console.warn("Lecture automatique du document hors ligne indisponible", lecture?.status ?? "réseau");
  await removeOfflineFile(id);
  return initJson.storagePath;
}

async function toutesLesMutations(): Promise<OfflineMutation[]> {
  const db = await dbOpen();
  return new Promise((resolve, reject) => {
    const request = db.transaction(STORE, "readonly").objectStore(STORE).getAll();
    request.onsuccess = () => resolve((request.result as OfflineMutation[]).sort((a, b) => a.createdAt.localeCompare(b.createdAt)));
    request.onerror = () => reject(request.error);
  });
}
/** Actions en attente du compte connecté. */
export async function listOfflineMutations(): Promise<OfflineMutation[]> {
  const [items, userId] = await Promise.all([toutesLesMutations(), utilisateurCourant()]);
  return items.filter((item) => rejouablePar(item.userId, userId));
}
/** Vide la file (actions et documents) : appelé à la déconnexion. */
export async function clearOfflineQueue(): Promise<void> {
  const db = await dbOpen();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction([STORE, FILE_STORE], "readwrite");
    tx.objectStore(STORE).clear();
    tx.objectStore(FILE_STORE).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  signal();
}
export async function enqueueOfflineMutation(url: string, init: RequestInit): Promise<OfflineMutation> {
  const method = (init.method ?? "POST").toUpperCase();
  if (!["POST", "PATCH", "PUT", "DELETE"].includes(method)) throw new Error("Cette action ne peut pas être mise en attente hors ligne.");
  if (!url.startsWith("/api/")) throw new Error("Seules les actions API peuvent être mises en attente.");
  const item: OfflineMutation = {
    id: crypto.randomUUID(),
    url,
    method,
    body: typeof init.body === "string" ? init.body : null,
    headers: init.headers ? Object.fromEntries(new Headers(init.headers).entries()) : {},
    createdAt: new Date().toISOString(),
    attempts: 0,
    userId: await utilisateurCourant(),
  };
  const db = await dbOpen();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).add(item);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  signal();
  return item;
}
export type ResultatRejeu = { synced: number; pending: number; error?: string };
/** Un seul onglet à la fois rejoue la file ; les autres constatent simplement l'état de la file. */
export async function flushOfflineMutations(): Promise<ResultatRejeu> {
  return avecVerrouRejeu(rejouerFile, async () => ({ synced: 0, pending: (await listOfflineMutations()).length }));
}
async function rejouerFile(): Promise<ResultatRejeu> {
  if (typeof navigator !== "undefined" && !navigator.onLine) return { synced: 0, pending: (await listOfflineMutations()).length };
  let synced = 0;
  const abandons: string[] = [];
  // Seules les actions du compte connecté sont rejouées : celles d'un autre
  // compte (tablette partagée) attendent leur titulaire, sans jamais partir
  // avec la session d'un collègue.
  const items = await listOfflineMutations();
  for (const item of items) {
    const essais = item.attempts + 1;
    let status: number | null = null;
    let reason = "Connexion interrompue : nouvel essai automatique.";
    try {
      let body = item.body;
      if (body && body.includes("offline://")) {
        const matches = [...body.matchAll(/offline:\/\/([a-f0-9-]+)/g)].map((m) => m[1]!);
        for (const fileId of [...new Set(matches)]) {
          const storagePath = await uploadOfflineFile(fileId);
          body = body.split("offline://" + fileId).join(storagePath);
          // Persist each resolved reference before uploading the next file,
          // so a later network failure never loses an already-uploaded path.
          await updateOfflineMutation(item.id, { body });
        }
      }
      const response = await fetch(item.url, {
        method: item.method,
        credentials: "same-origin",
        headers: { ...(item.headers ?? {}), ...(body ? { "Content-Type": "application/json" } : {}), "X-GODAC-Offline-Action": item.id },
        body: body ?? undefined,
      });
      if (response.ok) {
        await removeOfflineMutation(item.id);
        synced++;
        continue;
      }
      status = response.status;
      const data = await response.json().catch(() => ({})) as { error?: unknown };
      reason = typeof data.error === "string" ? data.error : `Réponse serveur ${response.status}`;
    } catch (e) {
      if (e instanceof Error && !isNetworkFailure(e)) reason = e.message;
    }

    if (decisionApresEchec(status) === "abandonner") {
      // Refus définitif du serveur (4xx hors 401/408/429) : l'action est
      // retirée de la file et signalée. Une coupure réseau ou un 5xx ne
      // fait jamais perdre une action.
      await removeOfflineMutation(item.id);
      abandons.push(reason);
      continue;
    }
    await updateOfflineMutation(item.id, { attempts: essais, lastError: reason });
    signal();
    const pending = (await listOfflineMutations()).length;
    return { synced, pending, error: abandons.length ? `${abandons.length} action(s) abandonnée(s) : ${abandons.join(" ; ")}. ${reason}` : reason };
  }
  signal();
  return {
    synced,
    pending: (await listOfflineMutations()).length,
    ...(abandons.length ? { error: `${abandons.length} action(s) hors ligne abandonnée(s) : ${abandons.join(" ; ")}` } : {}),
  };
}
async function updateOfflineMutation(id: string, patch: Partial<OfflineMutation>) {
  const db = await dbOpen();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    const store = tx.objectStore(STORE);
    const get = store.get(id);
    get.onsuccess = () => { if (get.result) store.put({ ...get.result, ...patch }); };
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
async function removeOfflineMutation(id: string) {
  const db = await dbOpen();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  signal();
}
export function isNetworkFailure(error: unknown): boolean {
  return (typeof navigator !== "undefined" && !navigator.onLine) ||
    (error instanceof TypeError && /fetch|network|load failed|failed to fetch/i.test(error.message));
}
export const OFFLINE_QUEUE_EVENT = CHANGE_EVENT;
