// Limitation de débit des endpoints publics. Logique pure (sans base, sans
// requête), testée dans lib/http/__tests__ ; le branchement serveur est dans
// lib/http/limiteur-serveur.ts (table rate_limits, repli en mémoire).
import { createHash } from "node:crypto";

export interface RegleLimite {
  /** Nom de la route, première partie de la clé de comptage. */
  nom: string;
  /** Requêtes autorisées par fenêtre et par adresse IP. */
  max: number;
  /** Durée de la fenêtre glissante, en secondes. */
  fenetreS: number;
}

/** Limites par route publique et par IP. Les valeurs laissent passer un usage normal (plusieurs chauffeurs derrière la même box 4G). */
export const REGLES_LIMITE = {
  connexionPin: { nom: "connexion-pin", max: 30, fenetreS: 600 },
  passkeyOptions: { nom: "passkey-options", max: 30, fenetreS: 60 },
  passkeyVerify: { nom: "passkey-verify", max: 30, fenetreS: 60 },
  // Devinette du code de secours ou du code d'activation d'un badge : très peu d'essais légitimes par heure et par IP.
  recuperationPin: { nom: "recuperation-pin", max: 10, fenetreS: 3600 },
  inscriptionChauffeur: { nom: "inscription-chauffeur", max: 10, fenetreS: 3600 },
  demandeDemo: { nom: "demande-demo", max: 10, fenetreS: 3600 },
  erreursClient: { nom: "erreurs-client", max: 20, fenetreS: 60 },
} as const satisfies Record<string, RegleLimite>;

export interface DecisionLimite {
  autorise: boolean;
  /** Secondes à attendre avant de réessayer (0 si autorisé). */
  retryApresS: number;
}

/**
 * Estimation de la fenêtre glissante à partir de deux fenêtres fixes : la
 * fenêtre précédente compte au prorata de ce qui reste d'elle. Même formule
 * que la fonction SQL consommer_limite.
 */
export function estimerFenetreGlissante(courant: number, precedent: number, ecouleS: number, fenetreS: number): number {
  return courant + precedent * (1 - Math.min(Math.max(ecouleS, 0), fenetreS) / fenetreS);
}

export function decisionLimite(estime: number, max: number, ecouleS: number, fenetreS: number): DecisionLimite {
  if (estime <= max) return { autorise: true, retryApresS: 0 };
  return { autorise: false, retryApresS: Math.max(1, Math.ceil(fenetreS - ecouleS)) };
}

/**
 * Repli quand la table rate_limits est indisponible : journal glissant exact
 * en mémoire de l'instance (chaque instance serverless compte à part, donc
 * la limite est plus souple, jamais plus stricte).
 */
export class LimiteurMemoire {
  private readonly passages = new Map<string, number[]>();

  constructor(private readonly clesMax = 5000) {}

  consommer(cle: string, regle: RegleLimite, maintenantMs: number = Date.now()): DecisionLimite {
    const debut = maintenantMs - regle.fenetreS * 1000;
    const recents = (this.passages.get(cle) ?? []).filter((t) => t > debut);
    if (recents.length >= regle.max) {
      this.passages.set(cle, recents);
      const plusAncien = recents[0] ?? maintenantMs;
      return { autorise: false, retryApresS: Math.max(1, Math.ceil((plusAncien + regle.fenetreS * 1000 - maintenantMs) / 1000)) };
    }
    recents.push(maintenantMs);
    this.passages.set(cle, recents);
    if (this.passages.size > this.clesMax) {
      // Mémoire bornée : on retire la clé la plus ancienne.
      const premiere = this.passages.keys().next().value;
      if (premiere !== undefined && premiere !== cle) this.passages.delete(premiere);
    }
    return { autorise: true, retryApresS: 0 };
  }
}

/** Adresse IP du client d'après les en-têtes posés par l'hébergeur ; "inconnue" sinon. */
export function ipDepuisEntetes(entetes: Pick<Headers, "get">): string {
  return entetes.get("x-forwarded-for")?.split(",")[0]?.trim() || entetes.get("x-real-ip")?.trim() || "inconnue";
}

/** Empreinte de l'IP : jamais stockée en clair. */
export function empreinteIp(ip: string): string {
  return createHash("sha256").update(`godac-limite:${ip}`).digest("hex").slice(0, 32);
}
