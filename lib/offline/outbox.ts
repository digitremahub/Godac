/**
 * File d'attente hors ligne GODAC.
 * IndexedDB (pas localStorage) permet de conserver les mutations et les photos
 * encodées même si l'onglet est fermé ou le téléphone redémarre.
 */
export type OfflineMutation = {
  id: string;
  url: string;
  method: string;
  body: string | null;
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
export type OfflineFile = { id: string; blob: Blob; name: string; type: string; createdAt: string };

export async function listOfflineFiles(): Promise<OfflineFile[]> {
  const db = await dbOpen();
  return new Promise((resolve, reject) => {
    const request = db.transaction(FILE_STORE, "readonly").objectStore(FILE_STORE).getAll();
    request.onsuccess = () => resolve((request.result as OfflineFile[]).sort((a, b) => a.createdAt.localeCompare(b.createdAt)));
    request.onerror = () => reject(request.error);
  });
}
export async function enqueueOfflineFile(file: File): Promise<string> {
  const id = crypto.randomUUID();
  const db = await dbOpen();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(FILE_STORE, "readwrite");
    tx.objectStore(FILE_STORE).add({ id, blob: file, name: file.name, type: file.type || "application/octet-stream", createdAt: new Date().toISOString() } satisfies OfflineFile);
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
  const init = await fetch("/api/ocr/tour-report/init", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ contentType: item.type }) });
  const initJson = await init.json().catch(() => ({})) as { storagePath?: string; error?: string };
  if (!init.ok || !initJson.storagePath) throw new Error(initJson.error ?? "Impossible de préparer l'envoi du document.");
  const { createBrowserSupabaseClient } = await import("@/lib/supabase/client");
  const supabase = createBrowserSupabaseClient();
  const file = new File([item.blob], item.name, { type: item.type });
  const uploaded = await supabase.storage.from("tour-photos").upload(initJson.storagePath, file, { contentType: item.type });
  if (uploaded.error) throw new Error(uploaded.error.message);
  await fetch("/api/ocr/tour-report/process", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ storagePath: initJson.storagePath }) }).catch(() => undefined);
  await removeOfflineFile(id);
  return initJson.storagePath;
}

export async function listOfflineMutations(): Promise<OfflineMutation[]> {
  const db = await dbOpen();
  return new Promise((resolve, reject) => {
    const request = db.transaction(STORE, "readonly").objectStore(STORE).getAll();
    request.onsuccess = () => resolve((request.result as OfflineMutation[]).sort((a, b) => a.createdAt.localeCompare(b.createdAt)));
    request.onerror = () => reject(request.error);
  });
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
    createdAt: new Date().toISOString(),
    attempts: 0,
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
export async function flushOfflineMutations(): Promise<{ synced: number; pending: number; error?: string }> {
  if (typeof navigator !== "undefined" && !navigator.onLine) return { synced: 0, pending: (await listOfflineMutations()).length };
  let synced = 0;
  const items = await listOfflineMutations();
  for (const item of items) {
    try {
      let body = item.body;
      if (body && body.includes("offline://")) {
        const matches = [...body.matchAll(/offline:\/\/([a-f0-9-]+)/g)].map((m) => m[1]!);
        for (const fileId of [...new Set(matches)]) {
          const storagePath = await uploadOfflineFile(fileId);
          body = body.split("offline://" + fileId).join(storagePath);
        }
        await updateOfflineMutation(item.id, { body });
      }
      const response = await fetch(item.url, {
        method: item.method,
        credentials: "same-origin",
        headers: item.body ? { "Content-Type": "application/json", "X-GODAC-Offline-Action": item.id } : { "X-GODAC-Offline-Action": item.id },
        body: body ?? undefined,
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({})) as { error?: unknown };
        const reason = typeof data.error === "string" ? data.error : `Réponse serveur ${response.status}`;
        await updateOfflineMutation(item.id, { attempts: item.attempts + 1, lastError: reason });
        signal();
        return { synced, pending: items.length - synced, error: reason };
      }
      await removeOfflineMutation(item.id);
      synced++;
    } catch {
      await updateOfflineMutation(item.id, { attempts: item.attempts + 1, lastError: "Connexion interrompue : nouvel essai automatique." });
      signal();
      return { synced, pending: items.length - synced, error: "Connexion interrompue." };
    }
  }
  signal();
  return { synced, pending: (await listOfflineMutations()).length };
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
