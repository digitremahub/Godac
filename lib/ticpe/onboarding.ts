/**
 * Onboarding des réglages TICPE : ce qu'il manque pour que les montants soient
 * fiables, étape par étape, avec un lien d'action et un compteur. Affiché en
 * bandeau refermable sur le tableau de bord TICPE (direction, comptable,
 * exploitation). Fichier pur, testé dans lib/ticpe/__tests__/onboarding.test.ts :
 * le tableau de bord lit déjà le calcul et les points « à régler », rien de plus
 * n'est interrogé.
 */
import type { CodeRaison } from "@/lib/ticpe/eligibilite";
import type { CodeControle } from "@/lib/ticpe/controles";

export interface EtapeOnboarding {
  id: "reglages" | "bareme" | "capacite" | "poids" | "produit" | "zone" | "pays" | "justificatifs";
  titre: string;
  /** Ce qui manque, en une phrase. */
  detail: string;
  /** Nombre d'éléments à compléter (0 : étape faite). */
  restant: number;
  lien: string;
}

export interface EntreeOnboarding {
  /** Une ligne de réglages TICPE a été enregistrée au moins une fois. */
  reglagesEnregistres: boolean;
  /** Lignes du barème utilisables dont le taux est « à confirmer par l'expert-comptable ». */
  tauxAConfirmer: number;
  vehicules: readonly {
    id: string;
    registration: string;
    /** Véhicule actif et compté (ni exclu à la main, ni hors période). */
    compte: boolean;
    capaciteReservoir: number | string | null | undefined;
    raisons: readonly CodeRaison[];
  }[];
  /** Points « à régler » de la période (lib/ticpe/controles.ts). */
  points: readonly { code: CodeControle }[];
}

/** Raisons d'éligibilité qui demandent le poids (PTAC) ou la catégorie du véhicule. */
export const RAISONS_POIDS: readonly CodeRaison[] = ["ptac_inconnu", "ptac_ia", "ia_non_confirmee", "carte_grise_manquante"];
/** Raisons d'éligibilité qui demandent le produit (énergie) du véhicule. */
export const RAISONS_PRODUIT: readonly CodeRaison[] = ["energie_inconnue", "energie_ia"];

const pluriel = (n: number, s: string, p: string) => (n > 1 ? p : s);

export function etapesOnboarding(e: EntreeOnboarding): EtapeOnboarding[] {
  const comptes = e.vehicules.filter((v) => v.compte);
  const sansCapacite = comptes.filter((v) => !(Number(v.capaciteReservoir) > 0));
  const poids = comptes.filter((v) => v.raisons.some((r) => RAISONS_POIDS.includes(r)));
  const produit = comptes.filter((v) => v.raisons.some((r) => RAISONS_PRODUIT.includes(r)));
  const nbPoints = (code: CodeControle) => e.points.filter((p) => p.code === code).length;
  const zone = nbPoints("zone_a_verifier");
  const pays = nbPoints("hors_france");
  const justificatifs = nbPoints("sans_justificatif");
  const lienVehicule = (liste: typeof comptes) => (liste.length === 1 ? `/flotte/vehicules/${liste[0]!.id}` : "/carburant/ticpe/vehicules");

  return [
    {
      id: "reglages",
      titre: "Réglages TICPE",
      detail: e.reglagesEnregistres ? "Activité, régime de TVA et zone enregistrés." : "Les réglages par défaut s'appliquent (transport de marchandises, CA3 mensuelle, métropole) : vérifiez-les et enregistrez-les.",
      restant: e.reglagesEnregistres ? 0 : 1,
      lien: "/carburant/ticpe/reglages",
    },
    {
      id: "bareme",
      titre: "Barème à confirmer",
      detail: e.tauxAConfirmer > 0 ? `${e.tauxAConfirmer} taux du barème sont à confirmer par votre expert-comptable avant toute déclaration.` : "Taux du barème confirmés.",
      restant: e.tauxAConfirmer > 0 ? 1 : 0,
      lien: "/carburant/ticpe/reglages",
    },
    {
      id: "capacite",
      titre: "Capacité du réservoir",
      detail: sansCapacite.length > 0 ? `${sansCapacite.length} ${pluriel(sansCapacite.length, "véhicule n'a", "véhicules n'ont")} pas de capacité de réservoir : les pleins trop gros ne sont pas repérés.` : "Capacité renseignée sur tous les véhicules comptés.",
      restant: sansCapacite.length,
      lien: lienVehicule(sansCapacite),
    },
    {
      id: "poids",
      titre: "Catégorie et poids (PTAC)",
      detail: poids.length > 0 ? `${poids.length} ${pluriel(poids.length, "véhicule", "véhicules")} sans poids ou catégorie confirmés (carte grise à lire et à confirmer).` : "Poids et catégorie confirmés.",
      restant: poids.length,
      lien: lienVehicule(poids),
    },
    {
      id: "produit",
      titre: "Produit (énergie)",
      detail: produit.length > 0 ? `${produit.length} ${pluriel(produit.length, "véhicule", "véhicules")} dont l'énergie n'est pas reconnue comme du gazole (seul le gazole est remboursable ici).` : "Énergie reconnue sur tous les véhicules comptés.",
      restant: produit.length,
      lien: lienVehicule(produit),
    },
    {
      id: "zone",
      titre: "Zone des pleins",
      detail: zone > 0 ? `${zone} ${pluriel(zone, "plein", "pleins")} en Corse possible, zone non indiquée.` : "Zones des pleins confirmées.",
      restant: zone,
      lien: "/carburant/ticpe/controles",
    },
    {
      id: "pays",
      titre: "Pays d'achat",
      detail: pays > 0 ? `${pays} ${pluriel(pays, "plein acheté", "pleins achetés")} hors de France, non ${pluriel(pays, "compté", "comptés")} : corrigez le pays s'il s'agit d'une erreur.` : "Aucun plein hors de France à vérifier.",
      restant: pays,
      lien: "/carburant/ticpe/controles",
    },
    {
      id: "justificatifs",
      titre: "Justificatifs des pleins",
      detail: justificatifs > 0 ? `${justificatifs} ${pluriel(justificatifs, "plein", "pleins")} sans photo de ticket, relevé ni facture.` : "Tous les pleins ont un justificatif.",
      restant: justificatifs,
      lien: "/carburant/ticpe/controles",
    },
  ];
}

/** Compteur du bandeau : étapes à compléter, sur le total. */
export function compteurOnboarding(etapes: readonly EtapeOnboarding[]): { restantes: number; total: number } {
  return { restantes: etapes.filter((e) => e.restant > 0).length, total: etapes.length };
}

/** Signature des étapes en attente : le bandeau refermé ne revient que si elle change (nouveau point à régler). */
export function signatureOnboarding(etapes: readonly EtapeOnboarding[]): string {
  return etapes.filter((e) => e.restant > 0).map((e) => e.id).join(",");
}
