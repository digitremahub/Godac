import "server-only";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { RECHERCHE_ENTREPRISES_URL, lireReponseRechercheEntreprises, type InfosEntreprise } from "@/lib/organization/recherche-entreprises";
import { analyserIdentifiant } from "@/lib/organization/siret";
import { CLES_FICHE, champsAEcrire, comparerFiche, valeursFiche, type CleFiche } from "@/lib/organization/fiche-entreprise";
import { reglesConvention } from "@/lib/organization/idcc";
import { FRAIS_CONVENTIONNELS } from "@/lib/paie/parametres";
import { geocodeAddress } from "@/lib/geo/geocode";

export type ResultatRecherche = { ok: true; info: InfosEntreprise } | { ok: false; erreur: string; status: number };

/**
 * Interroge l'API publique recherche-entreprises (sans clé). Délai
 * court : si l'API ne répond pas, la saisie manuelle reste possible —
 * l'échec n'est jamais bloquant pour l'utilisateur.
 */
export async function rechercherEntreprise(saisie: string): Promise<ResultatRecherche> {
  const id = analyserIdentifiant(saisie);
  if (id.type === "invalide") return { ok: false, erreur: id.raison, status: 400 };
  try {
    const res = await fetch(`${RECHERCHE_ENTREPRISES_URL}?q=${id.valeur}&page=1&per_page=1`, {
      headers: { Accept: "application/json", "User-Agent": "GODAC (https://godac.app; contact@godac.fr)" },
      signal: AbortSignal.timeout(8000),
      cache: "no-store",
    });
    if (res.status === 429) return { ok: false, erreur: "Le répertoire des entreprises est très sollicité — réessayez dans une minute ou saisissez les informations à la main.", status: 503 };
    if (!res.ok) return { ok: false, erreur: "Le répertoire des entreprises ne répond pas pour le moment — vous pouvez saisir les informations à la main.", status: 502 };
    const info = lireReponseRechercheEntreprises(await res.json(), id.valeur);
    if (!info || info.siren !== id.siren) {
      return { ok: false, erreur: "Aucune entreprise trouvée pour ce numéro dans le répertoire SIRENE (entreprise non diffusible ou trop récente ?).", status: 404 };
    }
    return { ok: true, info };
  } catch {
    return { ok: false, erreur: "Le répertoire des entreprises est injoignable — vous pouvez saisir les informations à la main.", status: 502 };
  }
}

const texte = z.string().trim().max(500).nullable();
/** Fiche renvoyée au navigateur par /api/entreprise/recherche puis renvoyée telle quelle pour l'enregistrer. */
export const infosEntrepriseSchema: z.ZodType<InfosEntreprise> = z.object({
  siren: z.string().regex(/^\d{9}$/),
  siret: z.string().regex(/^\d{14}$/).nullable(),
  nom: z.string().trim().min(1).max(500),
  raisonSociale: texte,
  codeNaf: z.string().regex(/^\d{4}[A-Z]$/).nullable(),
  libelleNaf: texte,
  formeJuridique: texte,
  natureJuridique: texte,
  adresseSiege: texte,
  adresse: texte,
  codePostal: texte,
  ville: texte,
  latitude: z.number().min(-90).max(90).nullable(),
  longitude: z.number().min(-180).max(180).nullable(),
  trancheEffectif: z.string().max(4).nullable(),
  libelleEffectif: texte,
  effectifEstime: z.number().int().min(0).max(1_000_000).nullable(),
  idcc: z.array(z.string().regex(/^\d{4}$/)).max(20),
  dateCreation: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  cessee: z.boolean(),
});

export interface BilanApplication {
  ecrits: CleFiche[];
  /** Champs déjà renseignés autrement, laissés tels quels faute de confirmation. */
  conserves: CleFiche[];
  paie: string[];
}

/**
 * Écrit la fiche SIRENE sur l'organisation (champs vides, ou confirmés
 * dans `remplacer`) et met en place les réglages de paie qui en
 * découlent. Les réglages de paie existants ne sont jamais écrasés :
 * seuls les montants encore vides sont remplis, et l'effectif
 * seulement quand l'entreprise n'a pas encore de réglages.
 *
 * `supabase` : client de la session (direction, RLS) dans
 * Organisation, client service à l'onboarding.
 */
export async function appliquerInfosEntreprise(
  supabase: SupabaseClient,
  organizationId: string,
  info: InfosEntreprise,
  remplacer: readonly string[],
): Promise<BilanApplication> {
  const { data: org, error: orgError } = await supabase.from("organizations").select(CLES_FICHE.join(", ")).eq("id", organizationId).single();
  if (orgError || !org) throw new Error(orgError?.message ?? "Organisation introuvable");

  const champs = comparerFiche(org as unknown as Partial<Record<CleFiche, unknown>>, info);
  const ecrits = champsAEcrire(champs, remplacer);
  const valeurs = valeursFiche(info);
  const update: Record<string, unknown> = { siret_checked_at: new Date().toISOString() };
  for (const cle of ecrits) update[cle] = valeurs[cle];
  if (ecrits.includes("depot_address") && info.adresse) {
    // Position de l'établissement donnée par SIRENE, sinon géocodage de l'adresse.
    const pos =
      info.latitude !== null && info.longitude !== null ? { lat: info.latitude, lng: info.longitude } : await geocodeAddress(info.adresse, "FR");
    update.depot_lat = pos?.lat ?? null;
    update.depot_lng = pos?.lng ?? null;
  }
  const { error } = await supabase.from("organizations").update(update).eq("id", organizationId);
  if (error) throw new Error(error.message);

  const paie: string[] = [];
  const { data: reglages } = await supabase.from("payroll_settings").select("*").eq("organization_id", organizationId).maybeSingle();
  const transport = reglesConvention(info.idcc).transport;
  const frais = {
    meal_allowance: FRAIS_CONVENTIONNELS.repas,
    single_meal_allowance: FRAIS_CONVENTIONNELS.repasUnique,
    snack_allowance: FRAIS_CONVENTIONNELS.cassecroute,
    overnight_allowance: FRAIS_CONVENTIONNELS.grandDeplacement,
  };
  if (!reglages) {
    const row: Record<string, unknown> = { organization_id: organizationId, headcount: Math.max(1, info.effectifEstime ?? 1) };
    if (transport) Object.assign(row, frais);
    const { error: e } = await supabase.from("payroll_settings").insert(row);
    if (!e) {
      if (info.effectifEstime) paie.push(`Effectif de paie : ${row.headcount}`);
      if (transport) paie.push("Frais de déplacement conventionnels du transport routier");
    }
  } else if (transport) {
    const manquants = Object.fromEntries(Object.entries(frais).filter(([k]) => reglages[k] === null || reglages[k] === undefined));
    if (Object.keys(manquants).length > 0) {
      const { error: e } = await supabase
        .from("payroll_settings")
        .update({ ...manquants, updated_at: new Date().toISOString() })
        .eq("organization_id", organizationId);
      if (!e) paie.push("Frais de déplacement conventionnels encore vides");
    }
  }

  return { ecrits, conserves: champs.filter((c) => c.etat === "different" && !ecrits.includes(c.cle)).map((c) => c.cle), paie };
}
