/**
 * Conventions collectives (IDCC) et règles que GODAC en déduit pour une
 * entreprise. Le moteur de paie (lib/paie) est écrit pour la
 * convention des transports routiers, IDCC 16 : régimes grand routier /
 * courte distance / sédentaire, durées d'équivalence, frais de
 * déplacement conventionnels. Une autre convention n'est pas
 * « traduite » automatiquement : GODAC le dit clairement et renvoie
 * vers l'expert-comptable plutôt que d'appliquer de fausses règles.
 */
import { HEURES_EQUIVALENCE } from "@/lib/paie/calcul";
import { FRAIS_CONVENTIONNELS } from "@/lib/paie/parametres";
import type { Pays } from "@/lib/pays/pays";

export const IDCC_TRANSPORTS_ROUTIERS = "0016";

/** « 16 », « 0016 », « IDCC 16 » → « 0016 » ; null si ce n'est pas un IDCC. */
export function normaliserIdcc(value: string | null | undefined): string | null {
  if (!value) return null;
  const d = value.replace(/\D/g, "");
  if (!d || d.length > 4 || Number(d) === 0) return null;
  return d.padStart(4, "0");
}

/** Libellés des conventions les plus fréquentes autour du transport (liste non exhaustive). */
export const CONVENTIONS: Record<string, string> = {
  "0016": "Transports routiers et activités auxiliaires du transport",
  "1424": "Réseaux de transports publics urbains de voyageurs",
  "0275": "Transport aérien — personnel au sol",
  "3217": "Branche ferroviaire",
  "1090": "Services de l'automobile",
  "1486": "Bureaux d'études techniques (Syntec)",
  "2216": "Commerce de détail et de gros à prédominance alimentaire",
  "0573": "Commerces de gros",
  "1979": "Hôtels, cafés, restaurants",
  "1596": "Bâtiment — ouvriers (jusqu'à 10 salariés)",
  "1597": "Bâtiment — ouvriers (plus de 10 salariés)",
  "3248": "Métallurgie",
  "3043": "Entreprises de propreté",
  "2098": "Personnel des prestataires de services du secteur tertiaire",
};

export function libelleConvention(idcc: string): string {
  const n = normaliserIdcc(idcc) ?? idcc;
  const nom = CONVENTIONS[n];
  return nom ? `${nom} (IDCC ${Number(n)})` : `Convention IDCC ${Number(n)}`;
}

/** Texte enregistré dans organizations.convention_collective (fiche employeur du bulletin). */
export function texteConventionCollective(idcc: string[]): string | null {
  if (idcc.length === 0) return null;
  return idcc.map(libelleConvention).join(" ; ");
}

export interface ReglesConvention {
  /** IDCC 16 parmi les conventions déclarées : règles transport de lib/paie applicables. */
  transport: boolean;
  /** Conventions déclarées que le moteur de paie GODAC ne couvre pas. */
  autres: string[];
}

export function reglesConvention(idcc: string[]): ReglesConvention {
  const liste = idcc.map((i) => normaliserIdcc(i)).filter((i): i is string => i !== null);
  return {
    transport: liste.includes(IDCC_TRANSPORTS_ROUTIERS),
    autres: liste.filter((i) => i !== IDCC_TRANSPORTS_ROUTIERS),
  };
}

export interface LigneMiseEnPlace {
  titre: string;
  detail: string;
  /** "ok" : appliqué par GODAC ; "attention" : à voir avec l'expert-comptable. */
  ton: "ok" | "attention";
}

const euros = (n: number) => `${n.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;
const heures = (n: number) => `${n.toLocaleString("fr-FR", { maximumFractionDigits: 2 })} h`;

/**
 * Récapitulatif « Ce que GODAC a mis en place » après la lecture du
 * SIRET : convention, règles de paie, durées d'équivalence, frais,
 * effectif, et règles du pays (protection des données, temps de
 * conduite). Fonction pure, affichée par components/organization/MiseEnPlaceCard.
 */
export function miseEnPlace(params: { idcc: string[]; pays: Pays; libelleEffectif?: string | null; effectif?: number | null }): LigneMiseEnPlace[] {
  const { transport, autres } = reglesConvention(params.idcc);
  const lignes: LigneMiseEnPlace[] = [];

  if (params.idcc.length === 0) {
    lignes.push({
      titre: "Convention collective",
      detail:
        "Aucune convention déclarée pour cette entreprise dans le répertoire public. Le moteur de paie GODAC suit la convention des transports routiers (IDCC 16) : vérifiez avec votre expert-comptable qu'elle est bien la vôtre.",
      ton: "attention",
    });
  } else {
    lignes.push({ titre: "Convention collective", detail: params.idcc.map(libelleConvention).join(" ; "), ton: transport ? "ok" : "attention" });
  }

  if (transport && params.pays.paie.moteur) {
    lignes.push({
      titre: "Règles de paie du transport routier",
      detail:
        "Régimes grand routier, courte distance et sédentaire proposés sur chaque fiche de paie ; heures au-delà de 35 h majorées à 25 %, au-delà de 43 h à 50 %.",
      ton: "ok",
    });
    lignes.push({
      titre: "Durées d'équivalence",
      detail: `Grand routier ${heures(HEURES_EQUIVALENCE.grand_routier)}/mois (43 h/semaine), courte distance ${heures(HEURES_EQUIVALENCE.courte_distance)}/mois (39 h/semaine), sédentaire ${heures(HEURES_EQUIVALENCE.sedentaire)}/mois.`,
      ton: "ok",
    });
    lignes.push({
      titre: "Frais de déplacement conventionnels",
      detail: `Repas ${euros(FRAIS_CONVENTIONNELS.repas)}, repas unique ${euros(FRAIS_CONVENTIONNELS.repasUnique)}, casse-croûte ${euros(FRAIS_CONVENTIONNELS.cassecroute)}, grand déplacement (repas + découcher) ${euros(FRAIS_CONVENTIONNELS.grandDeplacement)} — modifiables dans Paie › Paramètres.`,
      ton: "ok",
    });
  }
  if (autres.length > 0 || (params.idcc.length > 0 && !transport)) {
    lignes.push({
      titre: "Autre convention à paramétrer",
      detail: `Le moteur de paie GODAC est réglé pour la convention des transports routiers (IDCC 16). ${autres.map(libelleConvention).join(", ")} : ses minima, primes et durées propres sont à paramétrer avec votre expert-comptable — GODAC ne les applique pas automatiquement.`,
      ton: "attention",
    });
  }

  if (params.libelleEffectif) {
    lignes.push({
      titre: "Effectif",
      detail: `${params.libelleEffectif} d'après le répertoire SIRENE${params.effectif ? ` — effectif de paie prérempli à ${params.effectif} (seuils FNAL, formation professionnelle…), à ajuster dans Paie › Paramètres` : ""}.`,
      ton: "ok",
    });
  }

  lignes.push({ titre: "Protection des données", detail: `${params.pays.donnees.loi} — autorité : ${params.pays.donnees.autorite}. Les textes RGPD de GODAC (confidentialité, DPA) s'y réfèrent.`, ton: "ok" });
  lignes.push({ titre: "Temps de conduite", detail: params.pays.tempsConduite, ton: "ok" });
  if (!params.pays.paie.moteur) {
    lignes.push({ titre: "Paie", detail: `Pas de bulletin calculé pour ce pays : GODAC fournit heures, absences et frais à votre gestionnaire (${params.pays.paie.organismes}).`, ton: "attention" });
  }
  return lignes;
}
