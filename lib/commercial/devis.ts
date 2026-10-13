import { priceFor, type ModuleCatalogEntry, type ModulePlanPrice, type Plan, type PlanId } from "@/lib/organization/catalog-types";

/**
 * Chiffrage d'un bon de commande à partir du catalogue (mêmes tables que
 * le simulateur et la facturation), avec l'offre Fondateur réservée aux
 * dix premiers clients (remise sur la mise en service).
 */
export const REMISE_FONDATEUR: Partial<Record<PlanId, number>> = { pro: 3000, business: 4000 };
export const TVA = 0.2;

export interface LigneDevis {
  libelle: string;
  detail: string | null;
  mensuel: number;
  miseEnService: number;
  inclus: boolean;
}

export interface Devis {
  plan: Plan;
  lignes: LigneDevis[];
  mensuelHT: number;
  miseEnServiceHT: number;
  remiseFondateur: number;
  miseEnServiceNetHT: number;
}

export function calculerDevis(
  plan: Plan,
  modules: ModuleCatalogEntry[],
  prices: ModulePlanPrice[],
  choisis: string[],
  fondateur = false,
): Devis {
  const lignes: LigneDevis[] = [
    {
      libelle: `Formule ${plan.name}`,
      detail: `${plan.vehicle_min} à ${plan.vehicle_max ?? "∞"} véhicules · utilisateurs illimités · socle inclus`,
      mensuel: Number(plan.monthly_base_price),
      miseEnService: Number(plan.setup_price),
      inclus: false,
    },
  ];
  const voulus = new Set(choisis);
  for (const m of modules) {
    if (m.wave === "v3") continue;
    const p = priceFor(prices, m.key, plan.id);
    if (!p) continue;
    if (p.included) {
      lignes.push({ libelle: m.name, detail: "Inclus dans la formule", mensuel: 0, miseEnService: 0, inclus: true });
    } else if (voulus.has(m.key)) {
      lignes.push({ libelle: m.name, detail: null, mensuel: Number(p.monthly_price), miseEnService: Number(p.setup_price), inclus: false });
    }
  }
  const mensuelHT = arrondi(lignes.reduce((t, l) => t + l.mensuel, 0));
  const miseEnServiceHT = arrondi(lignes.reduce((t, l) => t + l.miseEnService, 0));
  const remiseFondateur = fondateur ? Math.min(REMISE_FONDATEUR[plan.id] ?? 0, miseEnServiceHT) : 0;
  return { plan, lignes, mensuelHT, miseEnServiceHT, remiseFondateur, miseEnServiceNetHT: arrondi(miseEnServiceHT - remiseFondateur) };
}

const arrondi = (n: number) => Math.round(n * 100) / 100;

export const euros = (n: number) => n.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).replace(/[  ]/g, " ") + " €";
