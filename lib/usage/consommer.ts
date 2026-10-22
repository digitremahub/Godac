import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  bornesMoisParis,
  debutJourParis,
  deciderConsommation,
  messageRefus,
  quotaEffectif,
  resoudreFormule,
  seuilsFranchis,
  LIBELLES_FONCTION,
  type UsageFeature,
} from "@/lib/usage/quotas";

export type ResultatConsommation =
  | { ok: true; eventId: string | null; unitesDepassement: number }
  | { ok: false; raison: string };

/**
 * Compteur unique des fonctions payantes (appels à un service d'IA
 * externe facturé à GODAC). À appeler AVANT l'appel externe, avec le
 * client service (`createAdminSupabaseClient()`) — `usage_events` n'a
 * aucune policy d'écriture :
 *  1. vérifie le plafond journalier de sécurité et le volume mensuel
 *     inclus dans la formule (`usage_quotas`), ou le plafond propre à
 *     l'organisation (`usage_quota_overrides`, essai GO Navigation :
 *     jamais de dépassement facturé) ;
 *  2. au-delà du volume inclus : autorise et compte le dépassement
 *     (facturé à la fin du mois, app/api/cron/usage-billing) si
 *     l'entreprise l'a accepté, sinon refuse avec un message clair ;
 *  3. enregistre l'événement et alerte la direction à 80 % et 100 %.
 *
 * Panne d'infrastructure (tables absentes, base injoignable) : laisse
 * passer et journalise, pour ne jamais bloquer la saisie à cause du
 * compteur lui-même.
 */
export async function consommer(
  admin: SupabaseClient,
  organizationId: string,
  userId: string | null,
  feature: UsageFeature,
  units = 1,
): Promise<ResultatConsommation> {
  const unites = Math.max(1, Math.floor(units));
  const maintenant = new Date();
  const mois = bornesMoisParis(maintenant);
  const jour = debutJourParis(maintenant);

  const [orgRes, prixRes, totauxRes] = await Promise.all([
    admin.from("organizations").select("plan, usage_overage_enabled").eq("id", organizationId).maybeSingle(),
    admin.from("usage_prices").select("unit_price_eur").eq("feature", feature).maybeSingle(),
    admin.rpc("usage_feature_totals", { p_org: organizationId, p_feature: feature, p_month_start: mois.debut, p_day_start: jour }),
  ]);
  if (orgRes.error || totauxRes.error || prixRes.error) {
    console.error("consommer: compteur indisponible, appel autorisé", feature, orgRes.error ?? prixRes.error ?? totauxRes.error);
    return { ok: true, eventId: null, unitesDepassement: 0 };
  }

  // Fonction pas encore déclarée en base (migration non appliquée) : on
  // laisse passer sans compter plutôt que d'appliquer un quota nul.
  if (!prixRes.data) {
    console.error("consommer: fonction absente de usage_prices, appel autorisé", feature);
    return { ok: true, eventId: null, unitesDepassement: 0 };
  }

  const formule = resoudreFormule(orgRes.data?.plan);
  const [{ data: quota }, propre] = await Promise.all([
    admin.from("usage_quotas").select("included_per_month, daily_cap").eq("plan_id", formule).eq("feature", feature).maybeSingle(),
    // Plafond propre à l'organisation (essai GO Navigation), prioritaire et
    // sans dépassement facturé. Table absente → plafond de la formule.
    admin.from("usage_quota_overrides").select("included_per_month, daily_cap").eq("organization_id", organizationId).eq("feature", feature).maybeSingle(),
  ]);

  const { inclusParMois, plafondJour, depassementAutorise } = quotaEffectif(quota, propre.error ? null : propre.data, orgRes.data?.usage_overage_enabled ?? true);
  const totaux = (Array.isArray(totauxRes.data) ? totauxRes.data[0] : totauxRes.data) as { month_units: number; day_units: number } | null;
  const utiliseMois = Number(totaux?.month_units ?? 0);
  const utiliseJour = Number(totaux?.day_units ?? 0);
  const prixUnitaire = Number(prixRes.data.unit_price_eur);

  const decision = deciderConsommation(
    { inclusParMois, plafondJour, utiliseMois, utiliseJour, depassementAutorise },
    unites,
  );
  if (!decision.ok) {
    return { ok: false, raison: messageRefus(decision.motif, feature, { inclusParMois, plafondJour, prixUnitaire, plafondPropre: Boolean(!propre.error && propre.data) }) };
  }

  const { data: event, error: insertError } = await admin
    .from("usage_events")
    .insert({
      organization_id: organizationId,
      user_id: userId,
      feature,
      units: unites,
      cost_estimate_eur: decision.unitesDepassement * prixUnitaire,
    })
    .select("id")
    .single();
  if (insertError) console.error("consommer: enregistrement impossible", feature, insertError);

  for (const pct of seuilsFranchis(inclusParMois, utiliseMois, utiliseMois + unites)) {
    const libelle = LIBELLES_FONCTION[feature];
    const message =
      pct === 100
        ? `Volume mensuel inclus atteint pour ${libelle} (${inclusParMois}). ${
            !depassementAutorise
              ? "Les prochaines utilisations sont bloquées jusqu'au mois prochain, sauf si vous autorisez le dépassement facturé."
              : "Les prochaines utilisations seront facturées à l'unité en fin de mois."
          }`
        : `80 % du volume mensuel inclus atteint pour ${libelle} (${utiliseMois + unites} sur ${inclusParMois}).`;
    const { error } = await admin.from("alerts").insert({
      organization_id: organizationId,
      type: "usage_quota",
      severity: pct === 100 ? "warning" : "info",
      message,
      related_table: "usage_events",
      related_id: event?.id ?? null,
      recipient_roles: ["direction"],
    });
    if (error) console.error("consommer: alerte de quota non créée", error);
  }

  return { ok: true, eventId: event?.id ?? null, unitesDepassement: decision.unitesDepassement };
}

/**
 * Annule une consommation enregistrée par `consommer` quand l'appel
 * externe a échoué de notre fait (service IA en erreur, réponse coupée) :
 * l'utilisateur ne paie pas une lecture qu'il n'a pas eue. Sans eventId
 * (compteur indisponible) : rien à faire. Jamais d'exception.
 */
export async function rembourser(admin: SupabaseClient, eventId: string | null): Promise<void> {
  if (!eventId) return;
  const { error } = await admin.from("usage_events").delete().eq("id", eventId);
  if (error) console.error("rembourser: consommation non annulée", eventId, error);
}
