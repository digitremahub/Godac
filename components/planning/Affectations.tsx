"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DndContext, DragOverlay, MouseSensor, TouchSensor, useSensor, useSensors, type DragEndEvent, type DragStartEvent } from "@dnd-kit/core";
import { fetchGodac, lireRefus } from "@/lib/http/fetch-godac";
import { addDays, addMonths, parisWallTimeToUtcISOString } from "@/lib/planning/dates";
import {
  affectationsParTournee,
  cleCaseTournee,
  cleLigne,
  compteursDuJour,
  decisionsAffectation,
  estAbsent,
  estCaseVerrouillee,
  estJourPrevu,
  etatCase,
  etapesDeplacement,
  joursAffichesSemaine,
  joursDeLaLigne,
  joursDuMois,
  joursEtires,
  lignesTournees,
  nomCourt,
  texteAffectation,
  trousParJour,
  type LigneTournee,
} from "@/lib/planning/affectation";
import { chauffeursAffiches, heureDe, jourDe, JOURS_LONGS, libelleJour, preRemplir, rangJour } from "@/lib/planning/semaine";
import { compterFermees, estOuverte, ligneCorrespond, type FiltreOuverture } from "@/lib/planning/ouverture";
import { texteFermeture, texteReouverture } from "@/lib/planning/fermeture-tournee";
import { doublonsFusion, messageVerrou, type DoublonFusion, type VerrouFusion } from "@/lib/planning/fusion-verrou";
import { textePublication } from "@/lib/planning/publication";
import { confirmer } from "@/lib/ui/confirmation";
import { Avatar, Contexte, type ContexteAffectations, type DonneesAffectations, type EntreeAffectation } from "@/components/planning/AffectationElements";
import { AffectationsJour } from "@/components/planning/AffectationsJour";
import { AffectationsGrille } from "@/components/planning/AffectationsGrille";
import { CalendrierMois, SemaineMobile } from "@/components/planning/AffectationsMobile";
import { ColonneChauffeurs } from "@/components/planning/ColonneChauffeurs";
import { FeuilleAffecter, type CibleFeuille } from "@/components/planning/FeuilleAffecter";
import { FeuilleRepartir } from "@/components/planning/FeuilleRepartir";
import { BandeauDoublons, FiltreOuvertureBarre } from "@/components/planning/OuvertureFusion";
import { FeuilleHeure, type CibleHeure, type PorteeHeure } from "@/components/planning/FeuilleHeure";
import { texteChangementHeure } from "@/lib/planning/heure";
import { RecopieSemaines } from "@/components/planning/RecopieSemaines";
import { PreparerSemaine } from "@/components/planning/PreparerSemaine";
import { DupliquerSemaine, EditionAffectation, type DonneesPlanning, type Ton } from "@/components/planning/FenetresPlanning";
import { PlanningTemplatesPanel } from "@/components/planning/PlanningTemplatesPanel";
import { Fenetre } from "@/components/planning/Fenetre";
import { ChoixRegroupement, lireChoixRequis, type ChoixRegroupementData } from "@/components/colis/ChoixRegroupement";
import type { Regroupement } from "@/lib/colis/fiches-affectation";
import { IconAlertTriangle } from "@/components/layout/icons";

/** Une étape envoyée au serveur (un geste peut en enchaîner plusieurs : échange). */
type Etape =
  | { type: "placer"; ligne: LigneTournee; dates: string[]; driverId: string; /** Heure de Paris (« HH:MM ») ; défaut : celle de la tournée. */ heure?: string; /** Heure choisie à la main : les affectations existantes la prennent aussi. */ imposerHeure?: boolean }
  | { type: "retirer"; entree: EntreeAffectation }
  | { type: "supprimer"; entree: EntreeAffectation };

type ReponseAffecter = { places: number; absents: string[]; figees: number; fermees?: number; fusionnees?: number; deja: number; warning?: string | null };
type Resultat = { ok: true; texte: string | null; warning: string | null; absents: number } | { ok: false; choix: ChoixRegroupementData } | { ok: false; erreur: string };

type Fenetre =
  | { type: "feuille"; cible: CibleFeuille }
  | { type: "heure"; cible: CibleHeure }
  | { type: "edition"; entree: EntreeAffectation }
  | { type: "repartir"; entree: EntreeAffectation }
  | { type: "choix"; question: ChoixRegroupementData; reprendre: (r: Regroupement) => void; annuler: () => void }
  | { type: "dupliquer" }
  | { type: "recopie"; mode: "precedente" | "mois" }
  | { type: "preparer" }
  | null;

/**
 * Écran d'affectation de l'encadrement : tournées d'un côté, chauffeurs de
 * l'autre, en vues Jour / Semaine / Mois. Glisser-déposer (@dnd-kit) sur
 * ordinateur et tablette ; sur téléphone (< 768 px) et au clavier, « toucher
 * puis choisir » (feuille « Affecter à… », ou chauffeur choisi puis case).
 *
 * Interface optimiste : la grille change tout de suite, la requête part,
 * puis la page se recharge (router.refresh) ; en cas d'échec, retour à
 * l'état d'avant et message clair. Règles métier côté serveur :
 * app/api/planning/affecter (absences, « séparées ou reliées ? », fiche
 * colis) et PATCH /api/planning/entries/[id] (retirer, déplacer).
 */
export function Affectations({ donnees }: { donnees: DonneesAffectations }) {
  const router = useRouter();
  const petitEcran = usePetitEcran();
  const aujourdhui = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris" }).format(new Date());

  const [local, setLocal] = useState<EntreeAffectation[]>(donnees.affectations);
  const localRef = useRef(local);
  localRef.current = local;
  // Données fraîches du serveur : les changements optimistes sont absorbés.
  useEffect(() => setLocal(donnees.affectations), [donnees.affectations]);

  const [fenetre, setFenetre] = useState<Fenetre>(null);
  const [message, setMessage] = useState<{ texte: string; ton: Ton } | null>(null);
  const [occupe, setOccupe] = useState(false);
  const [arme, setArme] = useState<{ id: string; full_name: string } | null>(null);
  const [etirement, setEtirement] = useState<{ cle: string; source: string; jusqua: string } | null>(null);
  const [glisse, setGlisse] = useState<{ id: string; nom: string } | null>(null);
  const [modelesOuverts, setModelesOuverts] = useState(false);
  const [chauffeursOuverts, setChauffeursOuverts] = useState(false);
  const [publication, setPublication] = useState(false);
  const [filtreOuverture, setFiltreOuverture] = useState<FiltreOuverture>("toutes");
  const maj = useRef(false);

  // Jours affichés. Le dimanche : s'il sert (le serveur l'a mis dans la période),
  // ou à la demande (« + dimanche »), ou toujours sur téléphone (calendrier à 7 colonnes).
  const [dimancheDemande, setDimancheDemande] = useState(false);
  const dimancheUtilise = useMemo(() => donnees.vue !== "jour" && donnees.jours.some((d) => rangJour(d) === 6), [donnees.vue, donnees.jours]);
  const dimancheAffiche = dimancheUtilise || dimancheDemande || petitEcran;
  const jours = useMemo(() => {
    if (donnees.vue === "jour") return donnees.jours;
    return donnees.vue === "semaine" ? joursAffichesSemaine(donnees.lundi, dimancheAffiche) : joursDuMois(donnees.mois, dimancheAffiche);
  }, [donnees.vue, donnees.jours, donnees.lundi, donnees.mois, dimancheAffiche]);

  const services = useMemo(() => new Set(donnees.serviceIds), [donnees.serviceIds]);
  const visibles = useMemo(() => new Set(jours), [jours]);
  const affichees = useMemo(() => local.filter((a) => services.has(a.service_id) && visibles.has(jourDe(a.start_at))), [local, services, visibles]);
  const lignes = useMemo(
    () => lignesTournees({ routes: donnees.routes, modeles: donnees.modeles, affectations: affichees, serviceIds: donnees.serviceIds, serviceParDefaut: donnees.selectedService || null }),
    [donnees.routes, donnees.modeles, affichees, donnees.serviceIds, donnees.selectedService],
  );
  const parCase = useMemo(() => affectationsParTournee(affichees), [affichees]);
  // Cases verrouillées par une fusion (tournées d'origine) et affectations qui y subsistent (doublons).
  const verrous = useMemo(() => new Map(donnees.verrous.map((v) => [v.cle, v])), [donnees.verrous]);
  const doublons = useMemo(() => doublonsFusion(affichees, verrous), [affichees, verrous]);
  // Filtre Ouvertes / Fermées : une ligne reste si une de ses affectations de la période correspond (la vue Jour filtre ses cartes elle-même).
  const lignesVisibles = useMemo(
    () => (filtreOuverture === "toutes" ? lignes : lignes.filter((l) => ligneCorrespond(filtreOuverture, jours.flatMap((d) => parCase.get(cleCaseTournee(l.cle, d)) ?? [])))),
    [filtreOuverture, lignes, jours, parCase],
  );
  const nbFermees = useMemo(() => compterFermees(affichees), [affichees]);
  const noms = useMemo(() => new Map(donnees.chauffeurs.map((c) => [c.id, c.full_name])), [donnees.chauffeurs]);
  const nomChauffeur = useCallback((id: string | null) => (id ? (noms.get(id) ?? "Chauffeur") : "Sans chauffeur"), [noms]);
  const glisser = !petitEcran && donnees.peutModifier && !occupe;

  // Maj enfoncée au lâcher : déplacer au lieu de copier (Semaine, Mois).
  useEffect(() => {
    const suivre = (e: KeyboardEvent | PointerEvent) => {
      maj.current = e.shiftKey;
    };
    const echap = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !fenetre) {
        setArme(null);
        setEtirement(null);
      }
    };
    window.addEventListener("keydown", suivre);
    window.addEventListener("keyup", suivre);
    window.addEventListener("pointermove", suivre);
    window.addEventListener("keydown", echap);
    return () => {
      window.removeEventListener("keydown", suivre);
      window.removeEventListener("keyup", suivre);
      window.removeEventListener("pointermove", suivre);
      window.removeEventListener("keydown", echap);
    };
  }, [fenetre]);

  // --- Changements optimistes ------------------------------------------
  const absent = useCallback((id: string, d: string) => estAbsent(id, d, donnees.conges, donnees.arrets), [donnees.conges, donnees.arrets]);

  function appliquer(liste: EntreeAffectation[], e: Etape): EntreeAffectation[] {
    if (e.type === "retirer") return liste.map((a) => (a.id === e.entree.id ? { ...a, driver_id: null, users: null } : a));
    if (e.type === "supprimer") return liste.filter((a) => a.id !== e.entree.id);
    const { ligne, driverId } = e;
    const existantes = liste.filter((a) => cleLigne(a.service_id, a.tour_number) === ligne.cle);
    const decisions = decisionsAffectation({ dates: e.dates, driverId, heure: e.heure ?? ligne.heure, imposerHeure: e.imposerHeure, existantes, absent, versUtc: parisWallTimeToUtcISOString });
    let out = liste;
    const users = { full_name: nomChauffeur(driverId), phone: null, email: null };
    for (const d of decisions) {
      if (d.type === "changer") out = out.map((a) => (a.id === d.entreeId ? { ...a, driver_id: driverId, users, ...(d.startAt ? { start_at: d.startAt } : {}) } : a));
      if (d.type === "creer") {
        out = [
          ...out,
          { id: `tmp:${ligne.cle}@${d.date}`, service_id: ligne.serviceId, tour_number: ligne.tourNumber, driver_id: d.driverId, vehicle_id: null, start_at: d.startAt, status: "planned", vehicles: null, users: d.driverId ? users : null },
        ];
      }
    }
    return out;
  }

  // --- Appels au serveur -------------------------------------------------
  async function appeler(e: Etape, regroupement?: Regroupement): Promise<Resultat> {
    if (e.type === "placer") {
      const p = preRemplir({ driverId: e.driverId, serviceId: e.ligne.serviceId, tourNumber: e.ligne.tourNumber, date: e.dates[0]! }, { historique: donnees.historique, modeles: donnees.modeles, vehicules: donnees.vehicules });
      let res: Response;
      try {
        res = await fetch("/api/planning/affecter", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ service_id: e.ligne.serviceId, tour_number: e.ligne.tourNumber, driver_id: e.driverId, dates: e.dates, heure: e.heure ?? e.ligne.heure, ...(e.imposerHeure ? { imposer_heure: true } : {}), ...(p.vehiculeId ? { vehicle_id: p.vehiculeId } : {}), regroupement }),
        });
      } catch {
        return { ok: false, erreur: "Connexion impossible. Vérifiez le réseau puis réessayez." };
      }
      const corps: any = await res.json().catch(() => null);
      const question = lireChoixRequis(res.status, corps);
      if (question) return { ok: false, choix: question };
      if (!res.ok) return { ok: false, erreur: lireRefus(res.status, corps).message };
      const r = corps as ReponseAffecter;
      return { ok: true, texte: texteAffectation({ places: r.places, absents: r.absents ?? [], figees: r.figees ?? 0, fermees: r.fermees ?? 0, fusionnees: r.fusionnees ?? 0, deja: r.deja ?? 0 }, libelleJour), warning: r.warning ?? null, absents: (r.absents ?? []).length };
    }
    if (e.entree.id.startsWith("tmp:")) return { ok: false, erreur: "Enregistrement en cours : réessayez dans un instant." };
    if (e.type === "retirer") {
      const r = await fetchGodac<{ warning?: string | null }>(`/api/planning/entries/${e.entree.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ driver_id: null }) });
      return r.ok ? { ok: true, texte: null, warning: r.data.warning ?? null, absents: 0 } : { ok: false, erreur: r.refus.message };
    }
    const r = await fetchGodac(`/api/planning/entries/${e.entree.id}`, { method: "DELETE" });
    return r.ok ? { ok: true, texte: null, warning: null, absents: 0 } : { ok: false, erreur: r.refus.message };
  }

  /**
   * Exécute les étapes dans l'ordre. Question « séparées ou reliées ? » :
   * on s'arrête, on demande, puis on reprend à l'étape qui l'a posée.
   * Échec : retour à l'état d'avant (et rechargement si une étape est passée).
   */
  async function executer(etapes: Etape[], resume: string, avant: EntreeAffectation[] = localRef.current, regroupement?: Regroupement, dejaFaites = 0) {
    if (!etapes.length) return;
    if (dejaFaites === 0 && !regroupement) setLocal(etapes.reduce(appliquer, localRef.current));
    setOccupe(true);
    setFenetre(null);
    setArme(null);
    const avertissements: string[] = [];
    const details: string[] = [];
    let absents = 0;
    for (let i = 0; i < etapes.length; i++) {
      const r = await appeler(etapes[i]!, i === 0 ? regroupement : undefined);
      if (!r.ok && "choix" in r) {
        setOccupe(false);
        setFenetre({
          type: "choix",
          question: r.choix,
          reprendre: (reg) => void executer(etapes.slice(i), resume, avant, reg, dejaFaites + i),
          annuler: () => {
            setFenetre(null);
            setLocal(avant);
            if (dejaFaites + i > 0) router.refresh();
            setMessage({ texte: "Affectation annulée.", ton: "attention" });
          },
        });
        return;
      }
      if (!r.ok) {
        setLocal(avant);
        setOccupe(false);
        setMessage({ texte: `${resume} : impossible. ${"erreur" in r ? r.erreur : ""}${dejaFaites + i > 0 ? " Le planning a été rechargé." : ""}`, ton: "erreur" });
        if (dejaFaites + i > 0) router.refresh();
        return;
      }
      if (r.texte && etapes.length === 1) details.push(r.texte);
      if (r.warning) avertissements.push(r.warning);
      absents += r.absents;
    }
    setOccupe(false);
    const texte = [`${resume}.`, ...details.map((d) => `${d}.`), ...new Set(avertissements)].join(" ");
    setMessage({ texte, ton: avertissements.length || absents ? "attention" : "ok" });
    router.refresh();
  }

  // --- Gestes -------------------------------------------------------------
  const ligneDe = (cle: string) => lignes.find((l) => l.cle === cle);

  function placer(ligne: LigneTournee, datesDemandees: string[], chauffeur: { id: string; full_name: string }, heure?: { valeur: string; imposee?: boolean }) {
    let dates = datesDemandees;
    if (!dates.length) return setMessage({ texte: "Aucun jour à remplir.", ton: "attention" });
    // Tournée d'origine d'une fusion : case verrouillée, jamais affectée (le serveur le refuse aussi).
    const fusionnees = dates.filter((d) => estCaseVerrouillee(verrous, ligne, d));
    if (fusionnees.length === dates.length) return setMessage({ texte: messageVerrou(verrous.get(cleCaseTournee(ligne.cle, fusionnees[0]!))!), ton: "attention" });
    if (fusionnees.length) dates = dates.filter((d) => !fusionnees.includes(d));
    // Tournée fermée sans chauffeur : pas d'affectation tant qu'elle n'est pas rouverte (les jours mêlés sont triés par le serveur).
    const fermees = dates.filter((d) => etatCase(parCase.get(cleCaseTournee(ligne.cle, d)) ?? [], estJourPrevu(ligne, d)) === "fermee");
    if (fermees.length === dates.length) {
      return setMessage({ texte: `${ligne.tourNumber} est fermée ${fermees.length === 1 ? `le ${libelleJour(fermees[0]!)}` : "ces jours-là"} : rouvrez-la pour l'affecter.`, ton: "attention" });
    }
    // Un dimanche rempli doit se voir tout de suite.
    if (dates.some((d) => rangJour(d) === 6)) setDimancheDemande(true);
    const libelle = dates.length === 1 ? `${ligne.tourNumber} du ${libelleJour(dates[0]!)} → ${nomCourt(chauffeur.full_name)}` : `${ligne.tourNumber} → ${nomCourt(chauffeur.full_name)} (${dates.length} jours)`;
    const noteFusion = fusionnees.length ? ` (${fusionnees.length} jour${fusionnees.length > 1 ? "s" : ""} fusionné${fusionnees.length > 1 ? "s" : ""}, ignoré${fusionnees.length > 1 ? "s" : ""})` : "";
    void executer([{ type: "placer", ligne, dates, driverId: chauffeur.id, ...(heure ? { heure: heure.valeur, imposerHeure: heure.imposee } : {}) }], `${libelle}${noteFusion}`);
  }

  function retirer(entree: EntreeAffectation) {
    void executer([{ type: "retirer", entree }], `${nomCourt(nomChauffeur(entree.driver_id))} retiré de ${entree.tour_number} (${libelleJour(jourDe(entree.start_at))}), tournée à remplacer`);
  }

  async function supprimer(entree: EntreeAffectation) {
    if (!(await confirmer({ titre: `Supprimer ${entree.tour_number} du ${libelleJour(jourDe(entree.start_at))} ?`, message: "La tournée ne roulera pas ce jour-là.", action: "Supprimer", danger: true }))) return;
    void executer([{ type: "supprimer", entree }], `${entree.tour_number} supprimée du ${libelleJour(jourDe(entree.start_at))}`);
  }

  /** Jours « toute la semaine / tout le mois » d'une tournée : à partir d'aujourd'hui. */
  const joursLigne = (ligne: LigneTournee) => joursDeLaLigne(ligne, jours.filter((d) => d >= aujourdhui));

  function deposer(ev: DragEndEvent) {
    setGlisse(null);
    const actif = String(ev.active.id);
    const cible = ev.over ? String(ev.over.id) : null;
    if (!cible) return;

    if (actif.startsWith("ch:")) {
      const id = actif.slice(3);
      const chauffeur = { id, full_name: nomChauffeur(id) };
      if (cible.startsWith("case:")) {
        const [cle, date] = cible.slice(5).split("@") as [string, string];
        const ligne = ligneDe(cle);
        if (!ligne) return;
        if (estCaseVerrouillee(verrous, ligne, date)) return setMessage({ texte: messageVerrou(verrous.get(cleCaseTournee(cle, date))!), ton: "attention" });
        if (absent(id, date)) return setMessage({ texte: `${nomCourt(chauffeur.full_name)} est absent le ${libelleJour(date)} (congé ou arrêt) : choisissez quelqu'un d'autre.`, ton: "attention" });
        return placer(ligne, [date], chauffeur);
      }
      if (cible.startsWith("ligne:")) {
        const ligne = ligneDe(cible.slice(6));
        if (ligne) placer(ligne, joursLigne(ligne), chauffeur);
      }
      return;
    }

    if (actif.startsWith("af:")) {
      const entree = localRef.current.find((a) => a.id === actif.slice(3));
      if (!entree?.driver_id) return;
      const source = { entreeId: entree.id, driverId: entree.driver_id, cle: cleLigne(entree.service_id, entree.tour_number), date: jourDe(entree.start_at) };
      const nom = nomCourt(nomChauffeur(entree.driver_id));
      if (cible === "retirer") return retirer(entree);
      if (cible.startsWith("ligne:")) {
        const ligne = ligneDe(cible.slice(6));
        if (ligne) placer(ligne, joursLigne(ligne), { id: entree.driver_id, full_name: nomChauffeur(entree.driver_id) });
        return;
      }
      if (!cible.startsWith("case:")) return;
      const [cle, date] = cible.slice(5).split("@") as [string, string];
      const ligne = ligneDe(cle);
      if (!ligne || (cle === source.cle && date === source.date)) return;
      if (estCaseVerrouillee(verrous, ligne, date)) return setMessage({ texte: messageVerrou(verrous.get(cleCaseTournee(cle, date))!), ton: "attention" });
      if (absent(entree.driver_id, date)) return setMessage({ texte: `${nom} est absent le ${libelleJour(date)} (congé ou arrêt).`, ton: "attention" });
      const occupant = (parCase.get(cleCaseTournee(cle, date)) ?? []).find((a) => a.status === "planned");

      // Vue Jour : déplacer (case vide) ou échanger (case tenue).
      if (donnees.vue === "jour") {
        const etapes = etapesDeplacement({ source, cible: { cle, date, entreeId: occupant?.id ?? null, driverId: occupant?.driver_id ?? null } });
        const traduites: Etape[] = etapes.map((x) => {
          if (x.type === "retirer") return { type: "retirer", entree: localRef.current.find((a) => a.id === x.entreeId)! };
          return { type: "placer", ligne: ligneDe(x.cle)!, dates: [x.date], driverId: x.driverId };
        });
        const autre = occupant?.driver_id && occupant.driver_id !== entree.driver_id ? nomCourt(nomChauffeur(occupant.driver_id)) : null;
        return void executer(traduites, autre ? `Échange : ${nom} sur ${ligne.tourNumber}, ${autre} sur ${entree.tour_number}` : `${nom} passe de ${entree.tour_number} à ${ligne.tourNumber}`);
      }

      // Semaine, Mois : copier (Maj : déplacer).
      if (maj.current) {
        return void executer(
          [
            { type: "retirer", entree },
            { type: "placer", ligne, dates: [date], driverId: entree.driver_id, heure: heureDe(entree.start_at) },
          ],
          `${nom} déplacé : ${entree.tour_number} ${libelleJour(source.date)} → ${ligne.tourNumber} ${libelleJour(date)}`,
        );
      }
      // Copie : même heure que la case copiée.
      placer(ligne, [date], { id: entree.driver_id, full_name: nomChauffeur(entree.driver_id) }, { valeur: heureDe(entree.start_at) });
    }
  }

  function debutGlisser(ev: DragStartEvent) {
    const id = String(ev.active.id);
    if (id.startsWith("ch:")) setGlisse({ id: id.slice(3), nom: nomChauffeur(id.slice(3)) });
    else if (id.startsWith("af:")) {
      const e = localRef.current.find((a) => a.id === id.slice(3));
      if (e?.driver_id) setGlisse({ id: e.driver_id, nom: nomChauffeur(e.driver_id) });
    }
  }

  // --- Étirer une case vers la droite (pointeur) --------------------------
  const etirementRef = useRef<{ cle: string; source: string; jusqua: string; driverId: string } | null>(null);
  function commencerEtirement(cle: string, source: string, driverId: string, e: React.PointerEvent) {
    if (!glisser) return;
    e.preventDefault();
    e.stopPropagation();
    etirementRef.current = { cle, source, jusqua: source, driverId };
    setEtirement({ cle, source, jusqua: source });
    const bouger = (ev: PointerEvent) => {
      const el = (document.elementFromPoint(ev.clientX, ev.clientY) as HTMLElement | null)?.closest<HTMLElement>("[data-case]");
      const courant = etirementRef.current;
      if (!courant || !el || el.dataset.cle !== courant.cle || !el.dataset.date) return;
      if (el.dataset.date !== courant.jusqua) {
        courant.jusqua = el.dataset.date;
        setEtirement({ cle: courant.cle, source: courant.source, jusqua: courant.jusqua });
      }
    };
    const lacher = () => {
      window.removeEventListener("pointermove", bouger);
      window.removeEventListener("pointerup", lacher);
      window.removeEventListener("pointercancel", lacher);
      const fin = etirementRef.current;
      etirementRef.current = null;
      setEtirement(null);
      const ligne = fin && ligneDe(fin.cle);
      if (!fin || !ligne) return;
      const dates = joursEtires(fin.source, fin.jusqua, jours);
      const source = localRef.current.find((a) => a.driver_id === fin.driverId && cleLigne(a.service_id, a.tour_number) === fin.cle && jourDe(a.start_at) === fin.source && a.status !== "cancelled");
      if (dates.length) placer(ligne, dates, { id: fin.driverId, full_name: nomChauffeur(fin.driverId) }, source ? { valeur: heureDe(source.start_at) } : undefined);
    };
    window.addEventListener("pointermove", bouger);
    window.addEventListener("pointerup", lacher);
    window.addEventListener("pointercancel", lacher);
  }

  // --- Toucher puis choisir ----------------------------------------------
  function ouvrirCase(cle: string, date: string) {
    const ligne = ligneDe(cle);
    // Case verrouillée par une fusion : pas de choix de chauffeur, un message clair.
    const verrou = verrous.get(cleCaseTournee(cle, date));
    if (verrou) return setMessage({ texte: messageVerrou(verrou), ton: "attention" });
    if (arme && ligne && donnees.peutModifier) {
      if (absent(arme.id, date)) return setMessage({ texte: `${nomCourt(arme.full_name)} est absent le ${libelleJour(date)} (congé ou arrêt).`, ton: "attention" });
      return placer(ligne, [date], arme);
    }
    setFenetre({ type: "feuille", cible: { type: "case", cle, date } });
  }
  function ouvrirLigne(cle: string) {
    const ligne = ligneDe(cle);
    if (arme && ligne) return placer(ligne, joursLigne(ligne), arme);
    setFenetre({ type: "feuille", cible: { type: "ligne", cle } });
  }

  // --- Tournée d'origine d'une fusion ---------------------------------------
  /** Ouvre la tournée hôte du jour (feuille « Répartir » de sa ligne de planning). */
  function ouvrirHote(v: VerrouFusion) {
    const hote = localRef.current.find((a) => a.id === v.hoteEntryId);
    if (!hote) return setMessage({ texte: `La tournée ${v.hoteNumero} est introuvable sur la période affichée.`, ton: "attention" });
    setFenetre({ type: "repartir", entree: hote });
  }

  /** « Retirer l'affectation » d'un doublon : confirmation, puis la ligne est retirée (trace d'audit côté serveur). */
  async function retirerDoublon(d: DoublonFusion) {
    if (d.entryId.startsWith("tmp:")) return setMessage({ texte: "Enregistrement en cours : réessayez dans un instant.", ton: "attention" });
    const nom = nomCourt(nomChauffeur(d.driverId));
    const ok = await confirmer({
      titre: `Retirer ${nom} de la tournée ${d.tourNumber} ?`,
      message: `La tournée ${d.tourNumber} est fusionnée avec la n°${d.verrou.hoteNumero} le ${libelleJour(d.date)}. Son affectation à ${nom} est retirée (la fiche colis préparée aussi) ; l'opération est tracée dans le journal d'audit.`,
      action: "Retirer l'affectation",
      danger: true,
    });
    if (!ok) return;
    const avant = localRef.current;
    setOccupe(true);
    setLocal(avant.filter((a) => a.id !== d.entryId));
    const r = await fetchGodac<{ warning?: string | null }>(`/api/planning/entries/${d.entryId}/doublon-fusion`, { method: "DELETE" });
    setOccupe(false);
    if (!r.ok) {
      setLocal(avant);
      return setMessage({ texte: `Retrait de ${nom} impossible. ${r.refus.message}`, ton: "erreur" });
    }
    setMessage({ texte: `${nom} retiré de la tournée ${d.tourNumber} (${libelleJour(d.date)}) : le doublon est résolu.${r.data.warning ? ` ${r.data.warning}` : ""}`, ton: r.data.warning ? "attention" : "ok" });
    router.refresh();
  }

  // --- Heure de la tournée ------------------------------------------------
  function ouvrirHeure(cle: string, date: string | null) {
    if (!donnees.peutModifier) return;
    setFenetre({ type: "heure", cible: { cle, date } });
  }
  async function changerHeure(cle: string, heure: string, portee: PorteeHeure) {
    const ligne = ligneDe(cle);
    if (!ligne) return;
    setFenetre(null);
    setOccupe(true);
    const r = await fetchGodac<{ modifiees: number; prevenus: number; conflits: number; modeles: number }>("/api/planning/heure", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ service_id: ligne.serviceId, tour_number: ligne.tourNumber, heure, ...(portee.type === "modele" ? { portee: "modele" } : { portee: "periode", debut: portee.debut, fin: portee.fin }) }),
    });
    setOccupe(false);
    if (!r.ok) return setMessage({ texte: `Heure de ${ligne.tourNumber} : impossible. ${r.refus.message}`, ton: "erreur" });
    setMessage({ texte: `${ligne.tourNumber} : ${texteChangementHeure({ modifiees: r.data.modifiees, prevenus: r.data.prevenus, conflits: r.data.conflits, heure, modele: portee.type === "modele" })}.`, ton: r.data.conflits ? "attention" : "ok" });
    router.refresh();
  }

  // --- Ouvrir / fermer une tournée ----------------------------------------
  async function basculerOuverture(entree: EntreeAffectation, confirmee = false): Promise<void> {
    if (entree.id.startsWith("tmp:")) return setMessage({ texte: "Enregistrement en cours : réessayez dans un instant.", ton: "attention" });
    const fermer = estOuverte(entree);
    // Sans chauffeur : fermeture « non affectée » (rouvrir supprime la ligne vide, voir /api/planning/fermetures).
    if (!entree.driver_id && entree.status === "planned") {
      const ligne = ligneDe(cleLigne(entree.service_id, entree.tour_number));
      if (ligne) return changerFermeture(ligne, [jourDe(entree.start_at)], fermer);
    }
    const avant = localRef.current;
    const nom = `${entree.tour_number} du ${libelleJour(jourDe(entree.start_at))}`;
    setOccupe(true);
    setLocal(avant.map((a) => (a.id === entree.id ? { ...a, tour_open: !fermer, closed_at: fermer ? new Date().toISOString() : null, closed_by: null } : a)));
    let res: Response;
    try {
      res = await fetch(`/api/planning/entries/${entree.id}/ouverture`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ouverte: !fermer, ...(confirmee ? { confirmer_en_cours: true } : {}) }) });
    } catch {
      setLocal(avant);
      setOccupe(false);
      return setMessage({ texte: "Connexion impossible. Vérifiez le réseau puis réessayez.", ton: "erreur" });
    }
    const corps: any = await res.json().catch(() => null);
    setOccupe(false);
    if (!res.ok) setLocal(avant);
    // La tournée colis liée est en cours : on demande avant de fermer (rien n'est supprimé).
    if (res.status === 409 && corps?.confirmation_requise) {
      if (await confirmer({ titre: `Fermer ${nom} ?`, message: String(corps.message ?? ""), action: "Fermer quand même", danger: true })) return basculerOuverture(entree, true);
      return;
    }
    if (!res.ok) return setMessage({ texte: `${fermer ? "Fermeture" : "Réouverture"} de ${nom} : impossible. ${lireRefus(res.status, corps).message}`, ton: "erreur" });
    setMessage({ texte: fermer ? `${nom} fermée : plus de changement d'affectation, le chauffeur ne peut plus la démarrer.` : `${nom} rouverte.`, ton: "ok" });
    router.refresh();
  }

  /**
   * Ferme (fermer) ou rouvre une tournée NON AFFECTÉE les jours donnés : elle ne roule pas ce
   * jour-là, n'est plus « à pourvoir » ni surveillée, et ne s'affecte plus tant qu'elle est fermée.
   */
  async function changerFermeture(ligne: LigneTournee, dates: string[], fermer: boolean): Promise<void> {
    if (!dates.length) return setMessage({ texte: `Aucun jour sans chauffeur à ${fermer ? "fermer" : "rouvrir"} pour ${ligne.tourNumber}.`, ton: "attention" });
    const nom = dates.length === 1 ? `${ligne.tourNumber} du ${libelleJour(dates[0]!)}` : `${ligne.tourNumber} (${dates.length} jours)`;
    setOccupe(true);
    const r = await fetchGodac<{ fermees?: number; deja?: number; refusees?: string[]; rouvertes?: number }>("/api/planning/fermetures", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ouverte: !fermer, service_id: ligne.serviceId, tour_number: ligne.tourNumber, dates, heure: ligne.heure }),
    });
    setOccupe(false);
    if (!r.ok) return setMessage({ texte: `${fermer ? "Fermeture" : "Réouverture"} de ${nom} : impossible. ${r.refus.message}`, ton: "erreur" });
    const refusees = r.data.refusees ?? [];
    setMessage({
      texte: fermer
        ? `${nom} : ${texteFermeture({ fermees: r.data.fermees ?? 0, deja: r.data.deja ?? 0, refusees }, libelleJour)}. Fermée, elle n'est plus à pourvoir ni surveillée.`
        : `${nom} : ${texteReouverture(r.data.rouvertes ?? 0)}.`,
      ton: refusees.length ? "attention" : "ok",
    });
    router.refresh();
  }

  /** Ferme ou rouvre d'un coup toutes les tournées d'une ligne de la période affichée (une confirmation par tournée en cours). */
  async function basculerOuvertureLigne(entrees: EntreeAffectation[], fermer: boolean): Promise<void> {
    for (const e of entrees.filter((x) => estOuverte(x) === fermer)) await basculerOuverture(e);
  }

  // --- Publier ------------------------------------------------------------
  async function publier() {
    const premier = donnees.jours[0]!;
    const dernier = donnees.jours.at(-1)!;
    const portee = donnees.vue === "mois" ? "les semaines du mois" : "la semaine";
    if (!(await confirmer({ titre: "Publier aux chauffeurs ?", message: `Chaque chauffeur concerné reçoit UNE notification avec ses tournées de ${portee}. Ensuite, un changement pour aujourd'hui ou demain le prévient tout de suite ; les autres attendent la prochaine publication.`, action: "Publier" }))) return;
    setPublication(true);
    const r = await fetchGodac<{ sent: number }>("/api/planning/publier", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ debut: premier, fin: dernier, service_id: donnees.selectedService || undefined }) });
    setPublication(false);
    if (!r.ok) return setMessage({ texte: `Publication impossible : ${r.refus.message}`, ton: "erreur" });
    setMessage({ texte: textePublication(r.data.sent), ton: "ok" });
    router.refresh();
  }

  // --- Navigation ---------------------------------------------------------
  function aller(params: Record<string, string>) {
    const qs = new URLSearchParams({ view: donnees.vue === "jour" ? "day" : donnees.vue === "mois" ? "month" : "week", ...params });
    if (donnees.selectedService) qs.set("service", donnees.selectedService);
    router.push(`/exploitation/planning?${qs.toString()}`);
  }
  function allerJour(d: string) {
    const qs = new URLSearchParams({ view: "day", day: d });
    if (donnees.selectedService) qs.set("service", donnees.selectedService);
    router.push(`/exploitation/planning?${qs.toString()}`);
  }
  const premier = donnees.jours[0]!;
  const nav =
    donnees.vue === "jour"
      ? { prec: () => aller({ day: addDays(premier, -1) }), suiv: () => aller({ day: addDays(premier, 1) }), maintenant: () => aller({ day: aujourdhui }), estMaintenant: premier === aujourdhui, libelle: `${JOURS_LONGS[rangJour(premier)]} ${new Date(`${premier}T12:00:00Z`).toLocaleDateString("fr-FR", { day: "numeric", month: "long", timeZone: "UTC" })}`, quoi: "Jour" }
      : donnees.vue === "semaine"
        ? { prec: () => aller({ week: addDays(donnees.lundi, -7) }), suiv: () => aller({ week: addDays(donnees.lundi, 7) }), maintenant: () => aller({ week: aujourdhui }), estMaintenant: donnees.jours.includes(aujourdhui), libelle: `${Number(premier.slice(8, 10))} → ${new Date(`${addDays(donnees.lundi, 6)}T12:00:00Z`).toLocaleDateString("fr-FR", { day: "numeric", month: "long", timeZone: "UTC" })}`, quoi: "Semaine" }
        : { prec: () => aller({ month: addMonths(donnees.mois, -1) }), suiv: () => aller({ month: addMonths(donnees.mois, 1) }), maintenant: () => aller({ month: aujourdhui.slice(0, 7) }), estMaintenant: donnees.mois === aujourdhui.slice(0, 7), libelle: new Date(`${donnees.mois}-15T12:00:00Z`).toLocaleDateString("fr-FR", { month: "long", year: "numeric", timeZone: "UTC" }), quoi: "Mois" };

  const nomService = donnees.selectedService ? (donnees.services.find((s) => s.id === donnees.selectedService)?.name ?? null) : null;
  const titre = donnees.vue === "jour" ? "Affectations du jour" : donnees.vue === "semaine" ? "Planning de la semaine" : "Planning du mois";
  const astuce = !donnees.peutModifier
    ? "Lecture seule."
    : petitEcran
      ? donnees.vue === "mois"
        ? "touchez un jour pour l'ouvrir"
        : "touchez une tournée pour choisir le chauffeur"
      : donnees.vue === "jour"
        ? "glissez un chauffeur sur une tournée"
        : "glissez un chauffeur sur une case, une ligne ou plusieurs jours";

  const compteurs = donnees.vue === "jour" ? compteursDuJour({ date: premier, lignes, parCase, chauffeurs: chauffeursAffiches(donnees.chauffeurs, donnees.rattachements, donnees.serviceIds, affichees), affectations: affichees, conges: donnees.conges, arrets: donnees.arrets, verrous }) : null;
  const lundisDuMois = useMemo(() => [...new Set(jours.map((d) => addDays(d, -rangJour(d))))], [jours]);
  const trous = useMemo(() => trousParJour(lignes, jours, parCase, verrous), [lignes, jours, parCase, verrous]);
  const totalTrous = Object.values(trous).reduce((n, t) => n + t, 0);

  const capteurs = useSensors(useSensor(MouseSensor, { activationConstraint: { distance: 6 } }), useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 8 } }));

  const contexte: ContexteAffectations = {
    donnees,
    affectations: affichees,
    lignes,
    parCase,
    verrous,
    doublons,
    jours,
    aujourdhui,
    petitEcran,
    glisser,
    arme,
    etirement,
    occupe,
    ouvrirCase,
    ouvrirLigne,
    choisirChauffeur: (c) => {
      setArme(c);
      if (c) setChauffeursOuverts(false);
    },
    dimancheAffiche,
    dimancheUtilise,
    basculerDimanche: () => setDimancheDemande((v) => !v),
    allerJour,
    ouvrirHeure,
    commencerEtirement,
    nomChauffeur,
    filtreOuverture,
    lignesVisibles,
    basculerOuverture: (e) => void basculerOuverture(e),
    basculerOuvertureLigne: (es, fermer) => void basculerOuvertureLigne(es, fermer),
    changerFermeture: (ligne, dates, fermer) => void changerFermeture(ligne, dates, fermer),
    ouvrirHote: (v) => ouvrirHote(v),
    retirerDoublon: (d) => void retirerDoublon(d),
    ouvrirRepartition: (e) => (e.id.startsWith("tmp:") ? setMessage({ texte: "Enregistrement en cours : réessayez dans un instant.", ton: "attention" }) : setFenetre({ type: "repartir", entree: e })),
  };

  const donneesFenetres: DonneesPlanning = {
    services: donnees.services,
    chauffeurs: donnees.chauffeurs,
    vehicules: donnees.vehicules,
    tournees: donnees.routes.map((r) => ({ id: r.id, tourNumber: r.tourNumber, serviceId: r.serviceId })),
    affectations: local,
    historique: donnees.historique,
    modeles: donnees.modeles,
    conges: donnees.conges,
  };
  const resultat = (texte: string, ton: Ton) => {
    setMessage({ texte, ton });
    router.refresh();
  };

  return (
    <Contexte.Provider value={contexte}>
      <div className="flex flex-col gap-4 pb-16">
        {/* En-tête : titre, période, actions */}
        <div className={petitEcran ? "flex flex-col gap-3" : "flex flex-wrap items-start justify-between gap-3"}>
          <div className="min-w-0">
            <h2 className="font-display text-2xl font-extrabold leading-tight">{titre}</h2>
            <p className="mt-0.5 text-sm text-navy/65 max-md:text-[15px]">
              {nomService ? `Service ${nomService}` : "Tous vos services"} · {astuce}
            </p>
          </div>
          <div className={petitEcran ? "flex w-full flex-col gap-2" : "flex flex-wrap items-center gap-2"}>
            <div className={petitEcran ? "flex w-full items-center gap-2" : "flex items-center gap-1"}>
              <button type="button" className="btn-secondary min-h-[48px] min-w-[48px] !px-3 md:min-h-[44px] md:min-w-[44px]" onClick={nav.prec} aria-label={`${nav.quoi} précédent`}>
                ‹
              </button>
              <button type="button" className={`btn-secondary min-h-[48px] !px-3 text-sm font-semibold first-letter:uppercase ${petitEcran ? "min-w-0 flex-1 text-base" : "min-h-[44px] min-w-[10rem]"}`} onClick={nav.maintenant} disabled={nav.estMaintenant} title={nav.estMaintenant ? undefined : "Revenir à aujourd'hui"}>
                <span className="first-letter:uppercase">{nav.libelle}</span>
              </button>
              <button type="button" className="btn-secondary min-h-[48px] min-w-[48px] !px-3 md:min-h-[44px] md:min-w-[44px]" onClick={nav.suiv} aria-label={`${nav.quoi} suivant`}>
                ›
              </button>
            </div>
            {donnees.peutModifier && (
              <>
                {donnees.vue === "jour" && (
                  <button type="button" className={`btn-secondary min-h-[44px] !px-3 text-sm ${BTN_MOBILE}`} onClick={() => setFenetre({ type: "dupliquer" })}>
                    Dupliquer la semaine
                  </button>
                )}
                {donnees.vue === "semaine" && (
                  <>
                    <button type="button" className={`btn-secondary min-h-[44px] !px-3 text-sm ${BTN_MOBILE}`} onClick={() => setFenetre({ type: "recopie", mode: "precedente" })}>
                      Copier depuis la semaine précédente
                    </button>
                    <button type="button" className={`btn-secondary min-h-[44px] !px-3 text-sm ${BTN_MOBILE}`} onClick={() => setFenetre({ type: "preparer" })}>
                      Préparer une semaine…
                    </button>
                    <button type="button" className={`btn-secondary min-h-[44px] !px-3 text-sm ${BTN_MOBILE}`} aria-expanded={modelesOuverts} onClick={() => setModelesOuverts((v) => !v)}>
                      Modèles
                    </button>
                  </>
                )}
                {donnees.vue === "mois" && (
                  <button type="button" className={`btn-secondary min-h-[44px] !px-3 text-sm ${BTN_MOBILE}`} onClick={() => setFenetre({ type: "recopie", mode: "mois" })}>
                    Copier une semaine type…
                  </button>
                )}
                <button type="button" className={`btn-primary min-h-[44px] !px-4 text-sm disabled:opacity-60 ${BTN_MOBILE}`} disabled={publication || occupe} onClick={publier} title="Une notification par chauffeur concerné, avec ses tournées">
                  {publication ? "Publication…" : "Publier aux chauffeurs"}
                  {donnees.aPrevenir ? <span className="ml-1.5 rounded-full bg-white/25 px-1.5 text-xs">{donnees.aPrevenir}</span> : null}
                </button>
              </>
            )}
          </div>
        </div>

        {petitEcran && donnees.vue !== "jour" && (
          <p className={`rounded-xl px-3.5 py-2.5 text-[15px] font-semibold ${totalTrous ? "bg-orange/15 text-orange-ink" : "bg-success/10 text-success-ink"}`} aria-live="polite">
            {totalTrous === 0 ? `Tout est pourvu ${donnees.vue === "mois" ? "ce mois-ci" : "cette semaine"}.` : `${totalTrous} case${totalTrous > 1 ? "s" : ""} à pourvoir ${donnees.vue === "mois" ? "ce mois-ci" : "cette semaine"}`}
          </p>
        )}

        {petitEcran && arme && (
          <p className="flex items-center justify-between gap-2 rounded-xl bg-teal/10 p-3 text-[15px] text-teal-ink" role="status">
            <span>
              Touchez une tournée pour y placer <strong>{nomCourt(arme.full_name)}</strong>.
            </span>
            <button type="button" className="min-h-[44px] shrink-0 px-2 underline" onClick={() => setArme(null)}>
              Annuler
            </button>
          </p>
        )}

        <BandeauDoublons />

        <FiltreOuvertureBarre valeur={filtreOuverture} onChange={setFiltreOuverture} fermees={nbFermees} />

        {compteurs && (
          <ul className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1" aria-label="Résumé du jour">
            <Compteur n={compteurs.tournees} libelle={`tournée${compteurs.tournees > 1 ? "s" : ""}`} />
            <Compteur n={compteurs.affectees} libelle={`affectée${compteurs.affectees > 1 ? "s" : ""}`} />
            <Compteur n={compteurs.sansChauffeur} libelle="sans chauffeur" alerte={compteurs.sansChauffeur > 0} />
            {compteurs.fermees > 0 && <Compteur n={compteurs.fermees} libelle={`fermée${compteurs.fermees > 1 ? "s" : ""}`} />}
            {compteurs.fusionnees ? <Compteur n={compteurs.fusionnees} libelle={`fusionnée${compteurs.fusionnees > 1 ? "s" : ""}`} /> : null}
            <Compteur n={compteurs.disponibles} libelle={`chauffeur${compteurs.disponibles > 1 ? "s" : ""} disponible${compteurs.disponibles > 1 ? "s" : ""}`} />
            <Compteur n={compteurs.absents} libelle="en congé ou arrêt" />
          </ul>
        )}

        {modelesOuverts && donnees.vue === "semaine" && (
          <PlanningTemplatesPanel
            services={donnees.services}
            selectedService={donnees.selectedService}
            weekStart={donnees.lundi}
            routes={donnees.routes.map((r) => ({ id: r.id, tourNumber: r.tourNumber, serviceId: r.serviceId }))}
            vehicles={donnees.vehicules.map((v) => ({ id: v.id, registration: v.registration, serviceId: v.service_id }))}
          />
        )}

        {message && (
          <div
            role={message.ton === "erreur" ? "alert" : "status"}
            className={`flex items-start gap-2 rounded-xl p-3 text-sm ${message.ton === "erreur" ? "bg-orange/10 text-orange-ink" : message.ton === "attention" ? "bg-gold/15 text-gold-ink" : "bg-success/10 text-success-ink"}`}
          >
            {message.ton !== "ok" && <IconAlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />}
            <span className="flex-1">{message.texte}</span>
            <button type="button" className="-my-1 min-h-[32px] shrink-0 rounded px-2 text-navy/50 hover:text-navy" onClick={() => setMessage(null)} aria-label="Masquer le message">
              ×
            </button>
          </div>
        )}

        <DndContext sensors={capteurs} onDragStart={debutGlisser} onDragEnd={deposer} onDragCancel={() => setGlisse(null)}>
          <div className={`grid grid-cols-1 gap-5 ${donnees.peutModifier ? "lg:grid-cols-[minmax(0,1fr)_20rem]" : ""}`}>
            {donnees.vue === "jour" ? <AffectationsJour /> : petitEcran ? donnees.vue === "mois" ? <CalendrierMois /> : <SemaineMobile key={donnees.lundi} trous={trous} /> : <AffectationsGrille />}
            {donnees.peutModifier &&
              (petitEcran ? (
                <section aria-label="Chauffeurs" className="min-w-0">
                  <button
                    type="button"
                    aria-expanded={chauffeursOuverts}
                    onClick={() => setChauffeursOuverts((v) => !v)}
                    className="btn-secondary min-h-[48px] w-full justify-between !px-4 text-base"
                  >
                    <span>Chauffeurs · placer depuis la liste</span>
                    <span aria-hidden="true">{chauffeursOuverts ? "▴" : "▾"}</span>
                  </button>
                  {chauffeursOuverts && (
                    <div className="mt-2">
                      <ColonneChauffeurs />
                    </div>
                  )}
                </section>
              ) : (
                <ColonneChauffeurs />
              ))}
          </div>
          <DragOverlay dropAnimation={null}>
            {glisse ? (
              <div className="flex w-64 rotate-[-3deg] items-center gap-2.5 rounded-xl border-2 border-orange bg-surface px-2.5 py-2 shadow-pop">
                <Avatar id={glisse.id} nom={glisse.nom} />
                <span className="text-sm font-bold">{nomCourt(glisse.nom)}</span>
              </div>
            ) : null}
          </DragOverlay>
        </DndContext>

        {donnees.peutModifier && !petitEcran && (
          <p className="text-xs text-navy/55">
            {donnees.vue === "jour"
              ? "Glisser le chauffeur d'une tournée sur une autre : il change de tournée (échange si elle est prise). Vers la colonne Chauffeurs : il est retiré. Au clavier : Entrée sur une tournée, puis choisir."
              : "Sur le nom d'une tournée (⇥) : tous les jours où elle roule. Poignée à droite d'une case : étirer sur les jours suivants. Une case glissée sur une autre est copiée ; avec Maj, déplacée. Vers la colonne Chauffeurs : retirée. Au clavier : Entrée sur une case, puis choisir."}
          </p>
        )}
      </div>

      {fenetre?.type === "feuille" && (
        <FeuilleAffecter
          cible={fenetre.cible}
          onFermer={() => setFenetre(null)}
          actions={{
            placer,
            retirer,
            supprimer: (e) => void supprimer(e),
            modifier: (e) => (e.id.startsWith("tmp:") ? setMessage({ texte: "Enregistrement en cours : réessayez dans un instant.", ton: "attention" }) : setFenetre({ type: "edition", entree: e })),
          }}
        />
      )}
      {fenetre?.type === "repartir" && <FeuilleRepartir entree={fenetre.entree} onFermer={() => setFenetre(null)} onResultat={resultat} />}
      {fenetre?.type === "heure" && <FeuilleHeure cible={fenetre.cible} onValider={(c, h, p) => void changerHeure(c, h, p)} onFermer={() => setFenetre(null)} />}
      {fenetre?.type === "edition" && <EditionAffectation entree={fenetre.entree} peutModifier={donnees.peutModifier} donnees={donneesFenetres} onFermer={() => setFenetre(null)} onResultat={resultat} />}
      {fenetre?.type === "choix" && (
        <Fenetre titre="2ᵉ tournée ce jour-là" onFermer={fenetre.annuler}>
          <ChoixRegroupement choix={fenetre.question} busy={occupe} onChoisir={fenetre.reprendre} onAnnuler={fenetre.annuler} />
        </Fenetre>
      )}
      {fenetre?.type === "dupliquer" && <DupliquerSemaine lundi={donnees.lundi} serviceId={donnees.selectedService} nomService={nomService} onFermer={() => setFenetre(null)} onResultat={resultat} />}
      {fenetre?.type === "preparer" && (
        <PreparerSemaine services={donnees.services.filter((s) => services.has(s.id))} serviceId={donnees.selectedService} lundiAffiche={donnees.lundi} onAller={(lundi) => aller({ view: "week", week: lundi })} onFermer={() => setFenetre(null)} />
      )}
      {fenetre?.type === "recopie" && (
        <RecopieSemaines mode={fenetre.mode} lundi={donnees.lundi} lundisDuMois={lundisDuMois} serviceId={donnees.selectedService} nomService={nomService} onFermer={() => setFenetre(null)} onResultat={resultat} />
      )}
    </Contexte.Provider>
  );
}

/** Boutons d'action du téléphone : pleine largeur, texte lisible. */
const BTN_MOBILE = "max-md:w-full max-md:min-h-[48px] max-md:text-base";

function Compteur({ n, libelle, alerte = false }: { n: number; libelle: string; alerte?: boolean }) {
  return (
    <li className={`shrink-0 rounded-xl px-4 py-2 text-sm shadow-card ${alerte ? "bg-orange/15 text-orange-ink" : "bg-surface"}`}>
      <strong className="mr-1.5 font-display text-xl tabular-nums">{n}</strong>
      {libelle}
    </li>
  );
}

/** Téléphone (< 768 px) : pas de glisser, « toucher puis choisir ». Rendu serveur : ordinateur. */
function usePetitEcran(): boolean {
  const [petit, setPetit] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 767px)");
    const maj = () => setPetit(mq.matches);
    maj();
    mq.addEventListener("change", maj);
    return () => mq.removeEventListener("change", maj);
  }, []);
  return petit;
}
