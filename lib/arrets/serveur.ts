import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { addDays, parisWallTimeToUtcISOString } from "@/lib/planning/dates";
import { estSchemaManquant, estValeurEnumInconnue } from "@/lib/rattachement/tolerance";
import { affectationsTouchees, type AffectationPlanning, type StatutArret } from "@/lib/arrets/declaration";

/**
 * Accès aux arrêts de travail (work_stoppages). Lectures avec le client
 * de l'utilisateur : la RLS reste l'autorité. Tolérant à l'absence de la
 * migration 20261030000001 : les lignes historiques (saisies par la
 * paie) sont lues comme « valide », sans document.
 */

type Db = SupabaseClient;

export const BUCKET_ARRETS = "work-stoppage-docs";

export interface LigneArret {
  id: string;
  userId: string;
  type: string;
  du: string;
  au: string;
  extensionOf: string | null;
  statut: StatutArret;
  documents: string[];
  serviceId: string | null;
  declarePar: string | null;
  validePar: string | null;
  valideLe: string | null;
  motifRefus: string | null;
  creeLe: string;
}

const COLONNES_BASE = "id, user_id, stoppage_type, start_date, end_date, extension_of, created_at";
const COLONNES = `${COLONNES_BASE}, status, document_paths, service_id, declared_by, validated_by, validated_at, refusal_reason`;

function versLigne(l: Record<string, unknown>): LigneArret {
  return {
    id: String(l.id),
    userId: String(l.user_id),
    type: String(l.stoppage_type),
    du: String(l.start_date),
    au: String(l.end_date),
    extensionOf: (l.extension_of as string | null) ?? null,
    statut: ((l.status as StatutArret | undefined) ?? "valide") as StatutArret,
    documents: (l.document_paths as string[] | null | undefined) ?? [],
    serviceId: (l.service_id as string | null | undefined) ?? null,
    declarePar: (l.declared_by as string | null | undefined) ?? null,
    validePar: (l.validated_by as string | null | undefined) ?? null,
    valideLe: (l.validated_at as string | null | undefined) ?? null,
    motifRefus: (l.refusal_reason as string | null | undefined) ?? null,
    creeLe: String(l.created_at ?? ""),
  };
}

export interface ResultatArrets {
  lignes: LigneArret[];
  /** Colonnes de la déclaration présentes (migration 20261030000001 appliquée). */
  declarationActive: boolean;
  /** Table work_stoppages présente (migration 20261026000002). */
  tableActive: boolean;
}

/** Arrêts lisibles (RLS), filtrés par salarié et par période (chevauchement). */
export async function lireArrets(supabase: Db, filtre: { id?: string; userId?: string; userIds?: string[]; du?: string; au?: string; limite?: number } = {}): Promise<ResultatArrets> {
  const requete = (colonnes: string) => {
    let q = supabase.from("work_stoppages").select(colonnes).order("start_date", { ascending: false }).limit(filtre.limite ?? 300);
    if (filtre.id) q = q.eq("id", filtre.id);
    if (filtre.userId) q = q.eq("user_id", filtre.userId);
    if (filtre.userIds) q = q.in("user_id", filtre.userIds.length ? filtre.userIds : ["00000000-0000-0000-0000-000000000000"]);
    if (filtre.au) q = q.lte("start_date", filtre.au);
    if (filtre.du) q = q.gte("end_date", filtre.du);
    return q;
  };
  const r = await requete(COLONNES);
  if (!r.error) return { lignes: ((r.data ?? []) as unknown as Record<string, unknown>[]).map(versLigne), declarationActive: true, tableActive: true };
  if (!estSchemaManquant(r.error)) {
    console.error("arrêts : lecture impossible", r.error.message);
    return { lignes: [], declarationActive: true, tableActive: true };
  }
  const repli = await requete(COLONNES_BASE);
  if (repli.error) return { lignes: [], declarationActive: false, tableActive: false };
  return { lignes: ((repli.data ?? []) as unknown as Record<string, unknown>[]).map(versLigne), declarationActive: false, tableActive: true };
}

export interface AffectationTouchee extends AffectationPlanning {
  tour_number: string | null;
  service_id: string | null;
}

/** Affectations du planning du salarié pendant l'arrêt, encore à faire. */
export async function affectationsPendantArret(db: Db, organizationId: string, userId: string, du: string, au: string): Promise<AffectationTouchee[]> {
  const { data, error } = await db
    .from("planning_entries")
    .select("id, start_at, status, tour_number, driver_id, service_id")
    .eq("organization_id", organizationId)
    .eq("driver_id", userId)
    .in("status", ["planned", "in_progress"])
    .gte("start_at", parisWallTimeToUtcISOString(du, "00:00"))
    .lt("start_at", parisWallTimeToUtcISOString(addDays(au, 1), "00:00"))
    .order("start_at");
  if (error) return [];
  return affectationsTouchees((data ?? []) as AffectationTouchee[], { du, au });
}

/** Service où ranger l'arrêt : un service du salarié, de préférence dans `preferes`. */
export async function serviceDuSalarie(db: Db, userId: string, preferes: readonly string[] = []): Promise<string | null> {
  const { data } = await db.from("user_services").select("service_id").eq("user_id", userId);
  const ids = ((data ?? []) as { service_id: string }[]).map((s) => s.service_id).sort();
  return ids.find((s) => preferes.includes(s)) ?? ids[0] ?? null;
}

/**
 * Alerte (relayée en push / e-mail par le webhook des alertes), par le
 * client service : la RLS d'alerts n'autorise pas l'insertion par un
 * utilisateur. Type « work_stoppage » absent (migration non appliquée) :
 * repli sur un type existant, sans lien vers l'arrêt.
 */
export async function notifierArret(
  admin: Db,
  a: { organizationId: string; message: string; arretId: string; severity?: "info" | "warning"; recipientUserId?: string | null; serviceId?: string | null },
): Promise<void> {
  const ligne: Record<string, unknown> = {
    organization_id: a.organizationId,
    type: "work_stoppage",
    severity: a.severity ?? "warning",
    message: a.message,
    related_table: "work_stoppages",
    related_id: a.arretId,
    ...(a.recipientUserId ? { recipient_user_id: a.recipientUserId } : { recipient_roles: ["manager", "exploitation", "direction"] }),
    ...(a.serviceId && !a.recipientUserId ? { service_id: a.serviceId } : {}),
  };
  let { error } = await admin.from("alerts").insert(ligne);
  if (error && estValeurEnumInconnue(error)) {
    ({ error } = await admin.from("alerts").insert({ ...ligne, type: a.recipientUserId ? "planning_validated" : "planning_conflict", related_table: null, related_id: null }));
  }
  if (error) console.error("arrêts : alerte non créée", error.message);
}

/** Liens signés (1 h) vers les volets de l'avis, lisibles selon la RLS du stockage. */
export async function liensDocuments(supabase: Db, chemins: readonly string[]): Promise<Map<string, string>> {
  const uniques = [...new Set(chemins.filter(Boolean))];
  if (!uniques.length) return new Map();
  const { data } = await supabase.storage.from(BUCKET_ARRETS).createSignedUrls(uniques, 3600);
  return new Map((data ?? []).filter((d) => d.signedUrl && d.path).map((d) => [d.path!, d.signedUrl as string]));
}
