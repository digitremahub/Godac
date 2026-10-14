/**
 * Facturation mensuelle du dépassement (« facturation à la dépense ») :
 * pour chaque entreprise cliente Stripe, unités du mois écoulé au-delà
 * du volume inclus × prix unitaire, ajoutées en lignes (Invoice Items)
 * à la prochaine facture de l'abonnement. Une seule fois par
 * (entreprise, mois, fonction) : `usage_billing_runs` est réservé avant
 * l'appel Stripe (contrainte unique) et libéré s'il échoue.
 *
 * Sans dépendance à la base ni à Stripe (injectés), donc testable :
 * lib/usage/__tests__/facturation.test.ts. Câblage réel :
 * lib/usage/facturation-serveur.ts.
 */
import { bornesMoisParis, descriptionLigneFacture, lignesDepassement, resoudreFormule } from "@/lib/usage/quotas";

export interface OrgFacturable {
  id: string;
  plan: string | null;
  plan_id: string | null;
  stripe_customer_id: string;
  stripe_subscription_id: string | null;
}

export interface DepotFacturation {
  organisations(): Promise<OrgFacturable[]>;
  quotas(): Promise<{ plan_id: string; feature: string; included_per_month: number }[]>;
  prix(): Promise<{ feature: string; unit_price_eur: number; label: string }[]>;
  totaux(organizationId: string, debut: string, fin: string): Promise<{ feature: string; units: number }[]>;
  /** Réserve la ligne ; false si elle existe déjà (déjà facturée ou en cours). */
  reserver(ligne: { organization_id: string; period: string; feature: string; units: number; amount_eur: number }): Promise<boolean>;
  confirmer(organizationId: string, periode: string, feature: string, stripeInvoiceItemId: string): Promise<void>;
  liberer(organizationId: string, periode: string, feature: string): Promise<void>;
}

export interface ParametresLigneStripe {
  customer: string;
  currency: "eur";
  amount: number;
  description: string;
  subscription?: string;
  metadata: Record<string, string>;
}

export type CreerLigneStripe = (params: ParametresLigneStripe, idempotencyKey: string) => Promise<{ id: string }>;

export interface ResultatFacturation {
  periode: string;
  lignes: { organizationId: string; feature: string; unites: number; montantCentimes: number; stripeInvoiceItemId: string }[];
  ignorees: number;
  erreurs: { organizationId: string; feature: string; message: string }[];
}

export async function facturerDepassements(depot: DepotFacturation, creerLigne: CreerLigneStripe, instant: Date = new Date()): Promise<ResultatFacturation> {
  const { periode, debut, fin } = bornesMoisParis(instant, -1);
  const [orgs, quotas, prix] = await Promise.all([depot.organisations(), depot.quotas(), depot.prix()]);
  const prixParFonction = Object.fromEntries(prix.map((p) => [p.feature, Number(p.unit_price_eur)]));
  const libelles = Object.fromEntries(prix.map((p) => [p.feature, p.label]));

  const resultat: ResultatFacturation = { periode, lignes: [], ignorees: 0, erreurs: [] };
  for (const org of orgs) {
    const formule = resoudreFormule(org.plan, org.plan_id);
    const inclus = Object.fromEntries(quotas.filter((q) => q.plan_id === formule).map((q) => [q.feature, Number(q.included_per_month)]));
    const totaux = await depot.totaux(org.id, debut, fin);
    for (const ligne of lignesDepassement(totaux, inclus, prixParFonction)) {
      const reservee = await depot.reserver({
        organization_id: org.id,
        period: periode,
        feature: ligne.feature,
        units: ligne.unites,
        amount_eur: ligne.montantCentimes / 100,
      });
      if (!reservee) {
        resultat.ignorees++;
        continue;
      }
      try {
        const item = await creerLigne(
          {
            customer: org.stripe_customer_id,
            currency: "eur",
            amount: ligne.montantCentimes,
            description: descriptionLigneFacture(libelles[ligne.feature] ?? ligne.feature, ligne.unites, periode),
            ...(org.stripe_subscription_id ? { subscription: org.stripe_subscription_id } : {}),
            metadata: { godac_organization_id: org.id, godac_usage_period: periode, godac_usage_feature: ligne.feature },
          },
          `godac-usage-${org.id}-${periode}-${ligne.feature}`,
        );
        await depot.confirmer(org.id, periode, ligne.feature, item.id);
        resultat.lignes.push({ organizationId: org.id, feature: ligne.feature, unites: ligne.unites, montantCentimes: ligne.montantCentimes, stripeInvoiceItemId: item.id });
      } catch (e) {
        await depot.liberer(org.id, periode, ligne.feature);
        resultat.erreurs.push({ organizationId: org.id, feature: ligne.feature, message: e instanceof Error ? e.message : String(e) });
      }
    }
  }
  return resultat;
}
