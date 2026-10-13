import { priceFor, type ModuleCatalogEntry, type ModulePlanPrice, type Plan } from "@/lib/organization/catalog-types";

/**
 * Chiffrage d'un bon de commande à partir du catalogue (mêmes tables que
 * le simulateur et la facturation), avec l'offre Fondateur réservée aux
 * dix premiers clients : mise en service offerte.
 */
export const OFFRE_FONDATEUR = "Offre Fondateur (10 premiers clients) — mise en service offerte";
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
  /** Mise en service de la formule payable en N mensualités (modules : à la commande). */
  echeances: number;
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
  const remiseFondateur = fondateur ? miseEnServiceHT : 0;
  const miseEnServiceNetHT = arrondi(miseEnServiceHT - remiseFondateur);
  return { plan, lignes, mensuelHT, miseEnServiceHT, remiseFondateur, miseEnServiceNetHT, echeances: miseEnServiceNetHT > 0 ? Math.max(1, plan.setup_installments ?? 1) : 1 };
}

const arrondi = (n: number) => Math.round(n * 100) / 100;

export const euros = (n: number) => n.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).replace(/[  ]/g, " ") + " €";
