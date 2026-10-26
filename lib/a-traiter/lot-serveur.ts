import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { POST as traiterEcart } from "@/app/api/fuel-entries/[id]/ecart/route";
import { PATCH as decideConge } from "@/app/api/leaves/[id]/route";
import { PATCH as decideEntretien } from "@/app/api/vehicle-interventions/[id]/route";
import { PATCH as decideArret } from "@/app/api/arrets/[id]/route";
import { PATCH as decideAmende } from "@/app/api/fines/[id]/route";
import {
  cleLot,
  repartitionParType,
  requeteIndividuelle,
  resultatDepuisReponse,
  resultatRefuse,
  resumer,
  type ActionLot,
  type ElementLot,
  type ResultatElement,
  type ResumeLot,
  type TypeLot,
} from "@/lib/a-traiter/lot";
import { journaliser } from "@/lib/audit/journal";
import { estSchemaManquant } from "@/lib/rattachement/tolerance";

/**
 * Traitement groupé : pour CHAQUE élément, la route individuelle existante
 * est appelée (mêmes gardes de rôle et de module, même règle de
 * hiérarchie, mêmes notifications, même journal d'audit). Aucune logique
 * de décision n'est recopiée ici : un élément refusé n'annule pas les
 * autres, chaque réponse devient un résultat par élément.
 */

type Route = (req: Request, ctx: { params: Promise<{ id: string }> }) => Promise<Response>;

const ROUTES: Record<TypeLot, { route: Route; chemin: (id: string) => string }> = {
  ecart_carburant: { route: traiterEcart as Route, chemin: (id) => `/api/fuel-entries/${id}/ecart` },
  amende: { route: decideAmende as Route, chemin: (id) => `/api/fines/${id}` },
  entretien: { route: decideEntretien as Route, chemin: (id) => `/api/vehicle-interventions/${id}` },
  conge: { route: decideConge as Route, chemin: (id) => `/api/leaves/${id}` },
  arret: { route: decideArret as Route, chemin: (id) => `/api/arrets/${id}` },
};

/** État « en attente » de chaque type (l'écart carburant est vérifié par sa propre route). */
const ETAT_EN_ATTENTE: Partial<Record<TypeLot, { table: string; colonne: string; valeur: string }>> = {
  amende: { table: "fines", colonne: "status", valeur: "pending_identification" },
  entretien: { table: "vehicle_interventions", colonne: "status", valeur: "scheduled" },
  conge: { table: "leave_requests", colonne: "status", valeur: "pending" },
  arret: { table: "work_stoppages", colonne: "status", valeur: "recu" },
};

const SIMULTANES = 5;

/**
 * Éléments qui ne sont plus en attente (déjà traités par quelqu'un d'autre
 * depuis l'affichage) ou introuvables sous la RLS : une requête par type.
 * Lecture impossible (table ou colonne absente) : pas de pré-contrôle, la
 * route individuelle reste l'autorité.
 */
async function nonEnAttente(supabase: SupabaseClient, elements: readonly ElementLot[]): Promise<Set<string>> {
  const absents = new Set<string>();
  for (const [type, etat] of Object.entries(ETAT_EN_ATTENTE) as [TypeLot, NonNullable<(typeof ETAT_EN_ATTENTE)[TypeLot]>][]) {
    const ids = elements.filter((e) => e.type === type).map((e) => e.id);
    if (ids.length === 0) continue;
    const { data, error } = await supabase.from(etat.table).select(`id, ${etat.colonne}`).in("id", ids);
    if (error) {
      if (!estSchemaManquant(error)) console.error("traitement groupé : pré-contrôle", type, error.message);
      continue;
    }
    const enAttente = new Set(((data ?? []) as unknown as Record<string, unknown>[]).filter((l) => l[etat.colonne] === etat.valeur).map((l) => String(l.id)));
    for (const id of ids) if (!enAttente.has(id)) absents.add(cleLot({ type, id }));
  }
  return absents;
}

async function traiterUn(el: ElementLot, action: ActionLot, commentaire: string | null): Promise<ResultatElement> {
  const requete = requeteIndividuelle(el.type, action, commentaire);
  if (!requete) return resultatRefuse(el, "Cette action n'est pas disponible en groupe pour ce type d'élément.");
  const { route, chemin } = ROUTES[el.type];
  try {
    const req = new Request(`http://interne${chemin(el.id)}`, {
      method: requete.methode,
      headers: { "content-type": "application/json" },
      body: JSON.stringify(requete.corps),
    });
    const res = await route(req, { params: Promise.resolve({ id: el.id }) });
    const corps = await res.json().catch(() => null);
    return resultatDepuisReponse(el, res.status, corps);
  } catch (e) {
    console.error("traitement groupé", el.type, e instanceof Error ? e.message : e);
    return resultatRefuse(el, "Le traitement a échoué.");
  }
}

export interface ResultatLot {
  resultats: ResultatElement[];
  resume: ResumeLot;
}

/** Traite le lot (déjà validé : taille, doublons, commentaire) et trace UNE action d'audit. */
export async function traiterLot(p: {
  supabase: SupabaseClient;
  utilisateur: { id: string; organization_id: string };
  action: ActionLot;
  commentaire: string | null;
  elements: readonly ElementLot[];
  /** Motif de refus d'un élément hors du périmètre du rôle (null : autorisé). Jamais de requête pour un élément refusé. */
  refus?: (el: ElementLot) => string | null;
}): Promise<ResultatLot> {
  const interdits = new Map<string, string>();
  for (const el of p.elements) {
    const motif = p.refus?.(el) ?? null;
    if (motif) interdits.set(cleLot(el), motif);
  }
  const perimes = await nonEnAttente(p.supabase, p.elements.filter((el) => !interdits.has(cleLot(el))));
  const resultats: ResultatElement[] = new Array(p.elements.length);

  // Par petits groupes : la base n'est pas inondée et l'ordre des résultats reste celui de la sélection.
  for (let i = 0; i < p.elements.length; i += SIMULTANES) {
    const groupe = p.elements.slice(i, i + SIMULTANES);
    const sortie = await Promise.all(
      groupe.map((el) => (interdits.has(cleLot(el)) ? Promise.resolve(resultatRefuse(el, interdits.get(cleLot(el))!)) : perimes.has(cleLot(el)) ? Promise.resolve(resultatRefuse(el, "Cet élément n'est plus en attente (déjà traité) ou n'est plus dans votre périmètre.")) : traiterUn(el, p.action, p.commentaire))),
    );
    sortie.forEach((r, j) => {
      resultats[i + j] = r;
    });
  }

  const resume = resumer(resultats);
  // Une seule ligne d'audit pour le lot : nombres et répartition par type, jamais de nom ni de commentaire.
  // (Chaque décision individuelle reste tracée par sa propre route.)
  await journaliser({
    organizationId: p.utilisateur.organization_id,
    userId: p.utilisateur.id,
    action: "traitement_groupe",
    details: { action: p.action, elements: resume.total, traites: resume.reussis, refuses: resume.refuses, par_type: repartitionParType(p.elements) },
  });
  return { resultats, resume };
}
