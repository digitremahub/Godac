import "server-only";
import { randomUUID } from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { estSchemaManquant } from "@/lib/rattachement/tolerance";

/**
 * Échanges (explication + photos) sur une amende ou une contestation —
 * table case_comments (migration 20261026000003). Écriture par le client
 * service après contrôle d'accès dans la route ; lecture avec le client de
 * l'utilisateur (RLS : périmètre de la fiche).
 */

export type TypeFiche = "fine" | "dispute";
export const BUCKET_FICHE: Record<TypeFiche, string> = { fine: "fine-photos", dispute: "dispute-docs" };
const COLONNE: Record<TypeFiche, "fine_id" | "dispute_id"> = { fine: "fine_id", dispute: "dispute_id" };

export interface Commentaire {
  id: string;
  ficheId: string;
  auteurId: string | null;
  auteur: string;
  texte: string;
  photos: number;
  creeLe: string;
}

export const TYPES_PIECE: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/heic": "heic", "application/pdf": "pdf" };
export const TAILLE_MAX_PIECE = 8 * 1024 * 1024;

export async function lireCommentaires(supabase: SupabaseClient, type: TypeFiche, ids: string[]): Promise<Map<string, Commentaire[]>> {
  const out = new Map<string, Commentaire[]>();
  if (ids.length === 0) return out;
  const col = COLONNE[type];
  const { data, error } = await supabase
    .from("case_comments")
    .select(`id, ${col}, author_id, body, photo_paths, created_at, author:users!case_comments_author_id_fkey(full_name)`)
    .in(col, ids)
    .order("created_at")
    .limit(1000);
  if (error) return out; // Migration absente : pas d'échanges.
  for (const r of (data ?? []) as unknown as Record<string, unknown>[]) {
    const ficheId = r[col] as string;
    const liste = out.get(ficheId) ?? [];
    liste.push({
      id: r.id as string,
      ficheId,
      auteurId: (r.author_id as string | null) ?? null,
      auteur: (r.author as { full_name?: string } | null)?.full_name ?? "—",
      texte: (r.body as string) ?? "",
      photos: Array.isArray(r.photo_paths) ? (r.photo_paths as string[]).length : 0,
      creeLe: r.created_at as string,
    });
    out.set(ficheId, liste);
  }
  return out;
}

/** Dépose les photos (client service) puis enregistre le commentaire. */
export async function enregistrerCommentaire(
  admin: SupabaseClient,
  p: { type: TypeFiche; ficheId: string; organizationId: string; auteurId: string; texte: string; fichiers: File[] },
): Promise<{ ok: true; id: string } | { ok: false; status: number; error: string }> {
  const chemins: string[] = [];
  for (const f of p.fichiers) {
    const ext = TYPES_PIECE[f.type];
    if (!ext) return { ok: false, status: 400, error: "Format de pièce non accepté (photo JPEG, PNG, WebP ou PDF)." };
    if (f.size > TAILLE_MAX_PIECE) return { ok: false, status: 400, error: "Pièce trop lourde (8 Mo maximum)." };
    const chemin = `${p.organizationId}/commentaires/${randomUUID()}.${ext}`;
    const { error } = await admin.storage.from(BUCKET_FICHE[p.type]).upload(chemin, Buffer.from(await f.arrayBuffer()), { contentType: f.type });
    if (error) return { ok: false, status: 500, error: `Envoi de la pièce impossible : ${error.message}` };
    chemins.push(chemin);
  }
  const { data, error } = await admin
    .from("case_comments")
    .insert({ organization_id: p.organizationId, [COLONNE[p.type]]: p.ficheId, author_id: p.auteurId, body: p.texte, photo_paths: chemins })
    .select("id")
    .single();
  if (error && estSchemaManquant(error)) return { ok: false, status: 503, error: "Les échanges ne sont pas encore disponibles (migration 20261026000003 à appliquer)." };
  if (error || !data) return { ok: false, status: 500, error: error?.message ?? "Enregistrement impossible." };
  return { ok: true, id: (data as { id: string }).id };
}

/** Lit le formulaire d'un commentaire : texte + jusqu'à 3 pièces. */
export async function lireFormulaireCommentaire(req: Request): Promise<{ texte: string; fichiers: File[] } | null> {
  const form = await req.formData().catch(() => null);
  if (!form) return null;
  const texte = String(form.get("texte") ?? "").trim().slice(0, 4000);
  const fichiers = form.getAll("photos").filter((x): x is File => typeof x === "object" && x !== null && "arrayBuffer" in x && (x as File).size > 0).slice(0, 3);
  if (!texte && fichiers.length === 0) return null;
  return { texte, fichiers };
}

/** Chemin d'une pièce d'un commentaire, lu avec le client de l'utilisateur (RLS). */
export async function pieceCommentaire(supabase: SupabaseClient, type: TypeFiche, ficheId: string, commentaireId: string, index: number): Promise<string | null> {
  const { data } = await supabase.from("case_comments").select("photo_paths").eq("id", commentaireId).eq(COLONNE[type], ficheId).maybeSingle();
  const paths = ((data as { photo_paths?: string[] } | null)?.photo_paths ?? []).filter(Boolean);
  return paths[index] ?? null;
}
