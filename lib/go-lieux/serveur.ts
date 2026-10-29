import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { MAX_FAVORIS_NOMMES, MAX_RECENTS, LIBELLES_FIXES, cleLieu, lieuDepuisLigne, nettoyerLibelle, type Lieu, type LieuSaisie, type TypeLieuFixe } from "@/lib/go-lieux/lieux";

const COLONNES = "id, genre, type_lieu, libelle, adresse, lat, lng, dernier_usage";

/** Table absente (migration 20261117000001 pas appliquée) : l'écran fonctionne sans favoris ni récents. */
export function tableManquante(e: { code?: string | null; message?: string | null } | null | undefined): boolean {
  return Boolean(e) && (e!.code === "42P01" || e!.code === "PGRST205" || /does not exist|could not find the table/i.test(e!.message ?? ""));
}

export type Issue<T> = { ok: true; valeur: T } | { ok: false; statut: 400 | 404 | 409 | 500 | 503; message: string };
const indisponible = { ok: false, statut: 503, message: "Favoris et récents momentanément indisponibles." } as const;
const echec = (m: string) => ({ ok: false, statut: 500, message: m }) as const;

export async function listerLieux(supabase: SupabaseClient, userId: string): Promise<{ favoris: Lieu[]; recents: Lieu[]; disponible: boolean }> {
  const { data, error } = await supabase.from("go_lieux").select(COLONNES).eq("user_id", userId).order("dernier_usage", { ascending: false }).limit(MAX_FAVORIS_NOMMES + 2 + MAX_RECENTS + 5);
  if (error) return { favoris: [], recents: [], disponible: false };
  const lieux = (data ?? []).map((l) => lieuDepuisLigne(l as Record<string, unknown>)).filter((l): l is Lieu => l !== null);
  return { favoris: lieux.filter((l) => l.genre === "favori"), recents: lieux.filter((l) => l.genre === "recent").slice(0, MAX_RECENTS), disponible: true };
}

/** Destination choisie : en tête des récents, sans doublon, 10 au plus. */
export async function enregistrerRecent(supabase: SupabaseClient, userId: string, organisationId: string, lieu: LieuSaisie): Promise<Issue<Lieu>> {
  const cle = cleLieu(lieu.adresse);
  const maintenant = new Date().toISOString();
  const { data: existant, error: e1 } = await supabase.from("go_lieux").select("id").eq("user_id", userId).eq("genre", "recent").eq("cle", cle).maybeSingle();
  if (e1) return tableManquante(e1) ? indisponible : echec(e1.message);
  let ligne: Record<string, unknown> | null = null;
  if (existant) {
    const r = await supabase.from("go_lieux").update({ dernier_usage: maintenant, libelle: nettoyerLibelle(lieu.libelle), lat: lieu.lat, lng: lieu.lng }).eq("id", existant.id).eq("user_id", userId).select(COLONNES).maybeSingle();
    if (r.error) return echec(r.error.message);
    ligne = r.data;
  } else {
    const r = await supabase.from("go_lieux").insert({ user_id: userId, organization_id: organisationId, genre: "recent", libelle: nettoyerLibelle(lieu.libelle) || nettoyerLibelle(lieu.adresse), adresse: lieu.adresse.trim(), lat: lieu.lat, lng: lieu.lng, cle, dernier_usage: maintenant }).select(COLONNES).maybeSingle();
    if (r.error) return echec(r.error.message);
    ligne = r.data;
  }
  // Plafond : les récents au-delà du dixième (les plus anciens) sont retirés.
  const { data: tous } = await supabase.from("go_lieux").select("id").eq("user_id", userId).eq("genre", "recent").order("dernier_usage", { ascending: false });
  const trop = (tous ?? []).slice(MAX_RECENTS).map((x) => x.id as string);
  if (trop.length) await supabase.from("go_lieux").delete().eq("user_id", userId).eq("genre", "recent").in("id", trop);
  const l = ligne ? lieuDepuisLigne(ligne) : null;
  return l ? { ok: true, valeur: l } : echec("Lieu non enregistré.");
}

/** Favori : Domicile / Travail (remplace l'existant) ou favori nommé (20 au plus, sans doublon). */
export async function enregistrerFavori(supabase: SupabaseClient, userId: string, organisationId: string, lieu: LieuSaisie, type: TypeLieuFixe | null): Promise<Issue<Lieu>> {
  const cle = cleLieu(lieu.adresse);
  const libelle = type ? LIBELLES_FIXES[type] : nettoyerLibelle(lieu.libelle);
  if (!libelle) return { ok: false, statut: 400, message: "Donnez un nom au lieu." };
  const maintenant = new Date().toISOString();
  const champs = { libelle, adresse: lieu.adresse.trim(), lat: lieu.lat, lng: lieu.lng, cle, dernier_usage: maintenant };
  if (type) {
    const { data: ancien, error } = await supabase.from("go_lieux").select("id").eq("user_id", userId).eq("genre", "favori").eq("type_lieu", type).maybeSingle();
    if (error) return tableManquante(error) ? indisponible : echec(error.message);
    const r = ancien
      ? await supabase.from("go_lieux").update(champs).eq("id", ancien.id).eq("user_id", userId).select(COLONNES).maybeSingle()
      : await supabase.from("go_lieux").insert({ ...champs, user_id: userId, organization_id: organisationId, genre: "favori", type_lieu: type }).select(COLONNES).maybeSingle();
    if (r.error) return echec(r.error.message);
    const l = r.data ? lieuDepuisLigne(r.data) : null;
    return l ? { ok: true, valeur: l } : echec("Lieu non enregistré.");
  }
  const { data: nommes, error } = await supabase.from("go_lieux").select("id, cle").eq("user_id", userId).eq("genre", "favori").is("type_lieu", null);
  if (error) return tableManquante(error) ? indisponible : echec(error.message);
  if ((nommes ?? []).some((n) => n.cle === cle)) return { ok: false, statut: 409, message: "Ce lieu est déjà dans vos favoris." };
  if ((nommes ?? []).length >= MAX_FAVORIS_NOMMES) return { ok: false, statut: 409, message: `Vous avez déjà ${MAX_FAVORIS_NOMMES} favoris : supprimez-en un pour en ajouter.` };
  const r = await supabase.from("go_lieux").insert({ ...champs, user_id: userId, organization_id: organisationId, genre: "favori", type_lieu: null }).select(COLONNES).maybeSingle();
  if (r.error) return echec(r.error.message);
  const l = r.data ? lieuDepuisLigne(r.data) : null;
  return l ? { ok: true, valeur: l } : echec("Lieu non enregistré.");
}

export async function renommerLieu(supabase: SupabaseClient, userId: string, id: string, libelle: string): Promise<Issue<Lieu>> {
  const propre = nettoyerLibelle(libelle);
  if (!propre) return { ok: false, statut: 400, message: "Donnez un nom au lieu." };
  const r = await supabase.from("go_lieux").update({ libelle: propre }).eq("id", id).eq("user_id", userId).is("type_lieu", null).select(COLONNES).maybeSingle();
  if (r.error) return tableManquante(r.error) ? indisponible : echec(r.error.message);
  const l = r.data ? lieuDepuisLigne(r.data) : null;
  return l ? { ok: true, valeur: l } : { ok: false, statut: 404, message: "Lieu introuvable (Domicile et Travail ne se renomment pas)." };
}

export async function supprimerLieu(supabase: SupabaseClient, userId: string, id: string): Promise<Issue<true>> {
  const r = await supabase.from("go_lieux").delete({ count: "exact" }).eq("id", id).eq("user_id", userId);
  if (r.error) return tableManquante(r.error) ? indisponible : echec(r.error.message);
  return r.count ? { ok: true, valeur: true } : { ok: false, statut: 404, message: "Lieu introuvable." };
}

/** « Tout effacer l'historique » : tous les récents de l'utilisateur. */
export async function effacerHistorique(supabase: SupabaseClient, userId: string): Promise<Issue<number>> {
  const r = await supabase.from("go_lieux").delete({ count: "exact" }).eq("user_id", userId).eq("genre", "recent");
  if (r.error) return tableManquante(r.error) ? indisponible : echec(r.error.message);
  return { ok: true, valeur: r.count ?? 0 };
}
