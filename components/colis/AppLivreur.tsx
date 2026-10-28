"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { Wordmark } from "@/components/brand/Wordmark";
import { IconPointRelais, IconCheck, IconMapPin, IconQrCode, IconRamasse, IconMessage, IconNavigation, IconPhone, IconRefresh, IconX } from "@/components/layout/icons";
import { ALERTE_SANS_TELEPHONE, arretsSansTelephone, lienSms, lienTel, normaliserTelephone } from "@/lib/colis/telephone";
import { BoutonGoFlottant } from "@/components/colis/BoutonGoFlottant";
import { RetourDepot, type DestinationRetour, type InfoGasoil } from "@/components/colis/RetourDepot";
import { FenetreArret } from "@/components/colis/FenetreArret";
import { formatPoids, sommePoids } from "@/lib/colis/poids";
import { BadgeSansTelephone } from "@/components/colis/AlertesArret";
import { garderEcranAllume } from "@/lib/colis/natif";
import { networkErrorMessage } from "@/lib/utils/network-error";
import { OFFLINE_QUEUE_EVENT, enqueueOfflineMutation, isNetworkFailure, listOfflineMutations } from "@/lib/offline/outbox";
import { LivraisonSheet } from "@/components/colis/LivraisonSheet";
import { ClotureSheet } from "@/components/colis/ClotureSheet";
import { arretsRestants, libelleMotif, prochainArret, type MotifEchec } from "@/lib/colis/cloture";
import { BadgeArret, EncocheArret, bordureArret } from "@/components/colis/Ramasse";
import { estMarque, estRamasse, estPointRelais, libelleFait, libellePreuve, libelleStatut, resumeCodeQr } from "@/lib/colis/livraison";
import { api, gmaps, waze, SMS_ARRIVEE, type Liste, type Run, type RunResume, type Stop, type Toast } from "@/components/colis/commun";
import { ToastColis } from "@/components/colis/ToastColis";
import { PastillesContact } from "@/components/colis/ContactsArret";
import { InterrupteurMode } from "@/components/colis/InterrupteurMode";
import { useModeSimple } from "@/components/colis/useModeSimple";
import { useSuiviAppel } from "@/components/colis/useSuiviAppel";
import { appliquerContacts, libelleContacts, type ChampContact, type DemandeContacts } from "@/lib/colis/contacts";
import { libelleLivre, motifParDefaut } from "@/lib/colis/mode-simple";
import { DELAI_ANNULATION_MS, creerRetraitsDifferes, sansRetraits } from "@/lib/colis/retrait";
import { patchArret, retirerArret } from "@/lib/colis/envoi-arret";
import { compteurs, grouperParListe, nomGroupe } from "@/lib/colis/listes";
import type { Itineraire } from "@/lib/colis/itineraire";
import { estimerAvancement, heureFin } from "@/lib/colis/estimation";
import { serviceConnu } from "@/lib/colis/fiche-client";
import type { ModeSens } from "@/lib/colis/sens-tournee";
import { LancementTournee } from "@/components/colis/LancementTournee";
import { separerReportes } from "@/lib/colis/villages";
import { BadgeHoraires, HorairesSheet, useHoraires, type ResumeOptimisation } from "@/components/colis/HorairesSheet";
import { useTraceGps } from "@/components/colis/useTraceGps";
import { ArretTriable, BoutonPoignee, ZoneTri, type Poignee } from "@/components/colis/Triable";
import { appliquerChangements, cibleDepuisSurvol, reordonner, type CibleDepot } from "@/lib/colis/reordonner";
import { OptimiserSheet, choixDeRun, libellesExtremites, lirePositionGps, memoriserChoix } from "@/components/colis/OptimiserSheet";
import { pointFinTournee, type Arrivee, type Depart } from "@/lib/colis/extremites";
import { confirmer } from "@/lib/ui/confirmation";
import { afficherPreparation, etapeParcours, etatsEtapes } from "@/lib/colis/parcours";
import { useSortieGo } from "@/components/colis/useSortieGo";
import { ECRAN_APRES_GO, ECRAN_REPRISE_GO } from "@/lib/colis/sortie-go";
import { arretAAfficher } from "@/lib/colis/recherche-arret";
import { SortieDepotLivreur } from "@/components/time-clock/SortieDepotLivreur";
import type { FixGps } from "@/components/time-clock/useSortieDepot";
import { RecommanderEmployeur } from "@/components/recommandation/RecommanderEmployeur";
import { CLE_NAVIGATION_PREFEREE, NAVIGATIONS, libelleNavigation, lireNavigationPreferee, type NavigationPreferee } from "@/lib/colis/navigation-preferee";

// La carte (MapLibre) n'est chargée que si le chauffeur l'ouvre.
const CarteTournee = dynamic(() => import("@/components/colis/CarteTournee").then((m) => m.CarteTournee), {
  ssr: false,
  loading: () => <p className="p-6 text-center text-sm text-navy/60">Chargement de la carte…</p>,
});
// GO Navigation : carte plein écran, trajet suivi et toute la tournée dans une feuille glissable.
const GoNavigation = dynamic(() => import("@/components/colis/GoNavigation").then((m) => m.GoNavigation), {
  ssr: false,
  loading: () => <p className="fixed inset-0 z-40 grid place-items-center bg-paper text-sm text-navy/60">Chargement de GO Navigation…</p>,
});
// Préparation de la tournée (scanner, import de bordereau…) : chargée seulement à cette étape.
const TourneeColis = dynamic(() => import("@/components/colis/TourneeColis").then((m) => m.TourneeColis), {
  loading: () => <p className="p-6 text-center text-sm text-navy/60">Chargement de la préparation…</p>,
});
type Vue = "liste" | "carte" | "navigation";
const MEMO_VUE = "godac-livreur-vue";
const MEMO_PARTAGE = "godac-partage-position";
/** Fréquence d'envoi de la position à l'exploitation pendant la tournée. */
const ENVOI_POSITION_MS = 60_000;

const MEMO = "godac-tournee-colis";

/**
 * « Ma tournée colis » : point d'entrée unique du conducteur, qui enchaîne
 * Préparer (scan, photo d'étiquette, bordereau, adresse avec créneau,
 * ramasses, points relais) → Démarrer (vérification des villages) →
 * Livrer (arrêt en cours en grand, GO Navigation, carte) → Clôturer. La
 * préparation réutilise l'écran de la tournée colis (<TourneeColis
 * integre>) ; l'étape courante vient de lib/colis/parcours.ts. L'écran
 * reste allumé pendant la tournée quand le téléphone le permet.
 */
export function AppLivreur({
  prenom,
  pays = "FR",
  vueInitiale,
  lectureEtiquette = true,
  recommander = false,
}: {
  prenom: string | null;
  pays?: string;
  vueInitiale?: Vue;
  lectureEtiquette?: boolean;
  /** Compte GO Navigation : propose « Recommander GODAC à mon employeur » en bas de l'écran. */
  recommander?: boolean;
}) {
  const [recoOuverte, setRecoOuverte] = useState(false);
  const [runs, setRuns] = useState<RunResume[] | null>(null);
  const [run, setRun] = useState<Run | null>(null);
  const [stopsBruts, setStops] = useState<Stop[]>([]);
  /** Adresses retirées dont la suppression attend la fin du délai d'annulation. */
  const [retires, setRetires] = useState<Set<string>>(new Set());
  const stops = useMemo(() => sansRetraits(stopsBruts, retires), [stopsBruts, retires]);
  const retraits = useRef(creerRetraitsDifferes());
  const [lists, setLists] = useState<Liste[]>([]);
  /** Feuille « Départ / arrivée » du recalcul en cours de route. */
  const [feuilleOptim, setFeuilleOptim] = useState(false);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<Toast | null>(null);
  const fermerToast = useCallback(() => setToast(null), []);
  const [voirTermines, setVoirTermines] = useState(false);
  const [confirmationLancement, setConfirmationLancement] = useState(false);
  /** Recherche d'une adresse, d'un destinataire, d'une ville ou d'un code colis. */
  const [recherche, setRecherche] = useState("");
  const [livraison, setLivraison] = useState<Stop | null>(null);
  const [detailsStop, setDetailsStop] = useState<Stop | null>(null);
  /** Fiche en cours de modification (erreur de saisie à la base). */
  /** Tournées pour lesquelles la proposition de retour au dépôt a été vue (fermée ou lancée). */
  const [retourVu, setRetourVu] = useState<Set<string>>(new Set());
  /** Arrêt en cours de clôture (n'importe lequel des restants, pas seulement le prochain). */
  const [cloture, setCloture] = useState<{ stop: Stop; mode: "choix" | "echec" } | null>(null);
  const [vue, setVue] = useState<Vue>(vueInitiale ?? "liste");
  const [selection, setSelection] = useState<string | null>(null);
  const [itineraire, setItineraire] = useState<Itineraire | null>(null);
  const [partage, setPartage] = useState(true);
  const [maPosition, setMaPosition] = useState<{ lat: number; lng: number } | null>(null);
  /** Dernier point GPS avec sa précision : transmis au pointage (présence au dépôt, sortie). */
  const [fixGps, setFixGps] = useState<FixGps | null>(null);
  const memoriserFix = useCallback((pos: { lat: number; lng: number }, precision?: number) => {
    setMaPosition(pos);
    setFixGps({ ...pos, precision: precision ?? null });
  }, []);
  /** Une tournée a été en cours dans cette session : la sortie du dépôt attend alors d'avoir revu le chauffeur au dépôt. */
  const tourneeVueEnCours = useRef(false);
  /** Arrêt dont on saisit les horaires (adresse pro / créneau du jour). */
  const [horairesStop, setHorairesStop] = useState<Stop | null>(null);
  /** Préparation ouverte à la demande pendant la livraison (« Ajouter ou modifier des colis »). */
  const [preparationDemandee, setPreparationDemandee] = useState(false);
  /** Guidage vers l'arrêt : GO Navigation (par défaut), Waze ou Google Maps (mémorisé sur le téléphone). */
  const [navPreferee, setNavPreferee] = useState<NavigationPreferee>("go");
  const preparationDemandeeRef = useRef(false);
  preparationDemandeeRef.current = preparationDemandee;
  const horaires = useHoraires(run, stops, maPosition);
  const { simple, basculer: basculerMode } = useModeSimple(run, setToast);
  const { lancerAppel, proposition: propositionAppel } = useSuiviAppel(stops, (s) => void basculerContact(s, "contact_phone", true));
  const dernierEnvoi = useRef(0);

  useEffect(() => {
    try {
      if (localStorage.getItem(MEMO_PARTAGE) === "non") setPartage(false);
    } catch {
      /* stockage indisponible */
    }
  }, []);

  // Pendant la tournée en cours : dernière position envoyée à l'exploitation
  // avec le lot de trace GPS (toutes les 30 s environ, écran ouvert), jamais en dehors.
  const runEnCours = run?.status === "in_progress" ? run.id : null;
  if (runEnCours) tourneeVueEnCours.current = true;
  // Trajet réellement emprunté (historique), même règle : tournée en cours, partage non mis en pause.
  const traceActive = useTraceGps(runEnCours, partage);
  useEffect(() => {
    if (!runEnCours || !partage || !navigator.geolocation) return;
    const id = navigator.geolocation.watchPosition(
      (p) => {
        const pos = { lat: p.coords.latitude, lng: p.coords.longitude };
        const maintenant = Date.now();
        if (maintenant - dernierEnvoi.current < ENVOI_POSITION_MS) return;
        dernierEnvoi.current = maintenant;
        memoriserFix(pos, p.coords.accuracy);
        // La position part avec le lot de la trace GPS (useTraceGps) : plus d'appel séparé.
      },
      () => undefined,
      { enableHighAccuracy: true, maximumAge: 30_000 },
    );
    return () => navigator.geolocation.clearWatch(id);
  }, [runEnCours, partage, memoriserFix]);

  function basculerPartage() {
    const suivant = !partage;
    setPartage(suivant);
    dernierEnvoi.current = 0;
    try {
      localStorage.setItem(MEMO_PARTAGE, suivant ? "oui" : "non");
    } catch {
      /* stockage indisponible */
    }
    if (!suivant && runEnCours) {
      fetch("/api/colis/position", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ run_id: runEnCours, masquer: true }) }).catch(() => undefined);
    }
  }

  useEffect(() => {
    // Ouverture par /livreur/navigation : la vue demandée l'emporte.
    let nav: NavigationPreferee = "go";
    try {
      nav = lireNavigationPreferee(localStorage.getItem(CLE_NAVIGATION_PREFEREE));
    } catch {
      /* stockage indisponible */
    }
    setNavPreferee(nav);
    if (vueInitiale) return;
    try {
      const vueMemorisee = localStorage.getItem(MEMO_VUE);
      // Waze ou Google Maps préféré : on revient sur l'écran de livraison GODAC, pas sur GO Navigation.
      if (vueMemorisee === "carte" || (vueMemorisee === "navigation" && nav === "go")) setVue(vueMemorisee);
    } catch {
      /* stockage indisponible */
    }
  }, [vueInitiale]);
  function choisirNavigation(n: NavigationPreferee) {
    setNavPreferee(n);
    try {
      localStorage.setItem(CLE_NAVIGATION_PREFEREE, n);
    } catch {
      /* stockage indisponible */
    }
  }
  /** Lien de l'app externe choisie (Waze par défaut quand GO est préféré). */
  const lienExterne = (s: Stop) => (navPreferee === "gmaps" ? gmaps(s) : waze(s));
  function changerVue(v: Vue) {
    setVue(v);
    try {
      localStorage.setItem(MEMO_VUE, v);
    } catch {
      /* stockage indisponible */
    }
  }
  const choisirArret = useCallback((id: string) => setSelection(id), []);

  const charger = useCallback(async (prefere?: string | null) => {
    try {
      const { tournees } = await api<{ tournees: RunResume[] }>("/api/colis/tournees");
      setRuns(tournees);
      let memo: string | null = null;
      try {
        memo = localStorage.getItem(MEMO);
      } catch {
        /* stockage indisponible */
      }
      const actives = tournees.filter((t) => t.status !== "done");
      const choix =
        [prefere, memo].find((id) => id && actives.some((t) => t.id === id)) ??
        actives.find((t) => t.status === "in_progress")?.id ??
        actives[0]?.id ??
        null;
      if (!choix) {
        setRun(null);
        setStops([]);
        return;
      }
      const data = await api<{ run: Run; stops: Stop[]; lists?: Liste[] }>(`/api/colis/tournees/${choix}`);
      setRun(data.run);
      // Adresses reportées au lancement (villages décochés) : conservées, hors de la tournée en cours.
      const { actifs, listes } = separerReportes(data.stops, data.lists ?? []);
      setStops(actifs);
      setLists(listes);
    } catch (e) {
      setToast({ ok: false, text: networkErrorMessage(e) });
      setRuns((r) => r ?? []);
    }
  }, []);

  useEffect(() => {
    charger();
  }, [charger]);

  /**
   * L'écran de préparation intégré signale la tournée colis qu'il affiche :
   * l'étape du parcours la suit. Une tournée démarrée bascule sur la
   * livraison (rechargée avec ses listes), sauf préparation demandée.
   */
  const surEtatPreparation = useCallback(
    (r: Run | null, s: Stop[]) => {
      if (r?.status === "in_progress" && !preparationDemandeeRef.current) {
        void charger(r.id);
        return;
      }
      setRun(r);
      setStops(s);
    },
    [charger],
  );

  /** Supprime la tournée démarrée (créée par erreur, en double…) ; une tournée clôturée, elle, reste à l'historique. */
  async function supprimerTournee() {
    if (!run || run.status === "done") return;
    const faits = stops.filter((s) => s.status !== "pending").length;
    const ok = await confirmer({
      titre: "Supprimer la tournée colis ?",
      message: `« ${run.name ?? "Tournée colis"} » et ses ${stops.length} arrêt(s)${faits ? `, dont ${faits} déjà traité(s),` : ""} seront supprimés. C'est définitif.`,
      action: "Supprimer",
      danger: true,
    });
    if (!ok) return;
    try {
      await api(`/api/colis/tournees/${run.id}`, { method: "DELETE" });
      setPreparationDemandee(false);
      setRun(null);
      setStops([]);
      await charger(null);
      setToast({ ok: true, text: "Tournée supprimée." });
    } catch (e) {
      setToast({ ok: false, text: networkErrorMessage(e) });
    }
  }

  function fermerPreparation() {
    setPreparationDemandee(false);
    void charger(run?.id);
  }

  // Retraits en attente d'annulation : envoyés tout de suite si l'écran se ferme ou passe en arrière-plan.
  useEffect(() => {
    const envoyer = () => void retraits.current.vider();
    window.addEventListener("pagehide", envoyer);
    const r = retraits.current;
    return () => {
      window.removeEventListener("pagehide", envoyer);
      void r.vider();
    };
  }, []);

  // Écran toujours allumé pendant la livraison (Android / iOS récents).
  useEffect(() => {
    if (run?.status !== "in_progress") return;
    let lock: { release: () => Promise<void> } | null = null;
    let relacherNatif: (() => void) | null = null;
    garderEcranAllume().then((f) => (relacherNatif = f));
    const nav = navigator as unknown as { wakeLock?: { request: (t: "screen") => Promise<{ release: () => Promise<void> }> } };
    const demander = () => nav.wakeLock?.request("screen").then((l) => (lock = l)).catch(() => undefined);
    demander();
    const visible = () => document.visibilityState === "visible" && demander();
    document.addEventListener("visibilitychange", visible);
    return () => {
      document.removeEventListener("visibilitychange", visible);
      lock?.release().catch(() => undefined);
      relacherNatif?.();
    };
  }, [run?.status]);

  function choisir(id: string) {
    try {
      localStorage.setItem(MEMO, id);
    } catch {
      /* stockage indisponible */
    }
    charger(id);
  }

  /** Clôture (livré / non livré avec motif) ou annulation d'un arrêt, dans n'importe quel ordre. */
  async function statut(s: Stop, status: Stop["status"], echec?: { motif: MotifEchec; precision: string | null; contacts?: DemandeContacts }, annulable = false) {
    setStops((all) =>
      all.map((x) =>
        x.id === s.id
          ? {
              ...x,
              status,
              done_at: status === "pending" ? null : new Date().toISOString(),
              failure_reason: status === "failed" ? (echec?.motif ?? "absent") : null,
              ...(status !== "delivered" ? { delivered_place: null, proof_code: null } : {}),
            }
          : x,
      ),
    );
    if (echec?.contacts) setStops((all) => appliquerContacts(all, s.id, echec.contacts!));
    if (status !== "pending") navigator.vibrate?.(40);
    const corps = JSON.stringify({ status, run_id: run?.id, ...(echec ? { motif: echec.motif, precision: echec.precision, ...echec.contacts } : {}) });
    try {
      await api(`/api/colis/arrets/${s.id}`, { method: "PATCH", body: corps });
      // Livré / Non livré en 1 clic (mode simple) : « Annuler » reste à portée pendant quelques secondes.
      if (annulable) {
        setToast({
          ok: true,
          text: status === "delivered" ? "Livré" : "Non livré (absent)",
          dureeMs: DELAI_ANNULATION_MS,
          actions: [
            { label: "Annuler", onClick: () => void statut({ ...s, status }, "pending") },
            ...(status === "failed" ? [{ label: "Préciser", onClick: () => setCloture({ stop: { ...s, status: "failed", failure_reason: echec?.motif ?? "absent" }, mode: "echec" }) }] : []),
          ],
        });
      }
    } catch (e) {
      if (isNetworkFailure(e)) {
        try {
          await enqueueOfflineMutation(`/api/colis/arrets/${s.id}`, { method: "PATCH", body: corps });
          setToast({ ok: true, text: "Action enregistrée sur le téléphone. Elle sera synchronisée dès le retour du réseau." });
          return;
        } catch (queueError) {
          setToast({ ok: false, text: networkErrorMessage(queueError) });
        }
      } else setToast({ ok: false, text: networkErrorMessage(e) });
      await charger(run?.id);
    }
  }

  /** « Non livré » en 1 clic (mode simple) : motif par défaut selon le type d'arrêt, précision facultative ensuite. */
  const nonLivreRapide = (s: Stop) => statut(s, "failed", { motif: motifParDefaut(s.kind), precision: null }, true);

  /** « Non livré » : 1 clic en mode simple, sinon la fiche du motif. */
  function demanderNonLivre(s: Stop, mode: "choix" | "echec") {
    if (simple && mode === "echec") void nonLivreRapide(s);
    else setCloture({ stop: s, mode });
  }

  /** Motif, précision ou contacts d'un arrêt déjà « Non livré », corrigés après coup. */
  async function preciserNonLivre(s: Stop, motif: MotifEchec, precision: string | null, contacts: DemandeContacts) {
    setStops((all) => appliquerContacts(all.map((x) => (x.id === s.id ? { ...x, failure_reason: motif } : x)), s.id, contacts));
    try {
      const issue = await patchArret(s.id, { run_id: run?.id, motif, precision, ...contacts });
      setToast({ ok: true, text: issue === "en_attente" ? "Enregistré sur le téléphone, synchronisé au retour du réseau." : "Non livré mis à jour." });
    } catch (e) {
      setToast({ ok: false, text: networkErrorMessage(e) });
      await charger(run?.id);
    }
  }

  /** « Message envoyé » / « Eu au téléphone » : une coche, 1 clic, enregistrée tout de suite (file hors ligne comprise). */
  async function basculerContact(s: Stop, champ: ChampContact, valeur: boolean) {
    setStops((all) => appliquerContacts(all, s.id, { [champ]: valeur }));
    try {
      const issue = await patchArret(s.id, { run_id: run?.id, [champ]: valeur });
      if (issue === "en_attente") setToast({ ok: true, text: "Enregistré sur le téléphone, synchronisé au retour du réseau." });
    } catch (e) {
      setToast({ ok: false, text: networkErrorMessage(e) });
      await charger(run?.id);
    }
  }

  /**
   * Retire une adresse en 1 clic, sans confirmation : elle disparaît tout de
   * suite, « Annuler » la remet pendant quelques secondes, puis la suppression
   * est envoyée (file hors ligne comprise).
   */
  function retirerAdresse(s: Stop) {
    setRetires((r) => new Set(r).add(s.id));
    const libere = () =>
      setRetires((r) => {
        const n = new Set(r);
        n.delete(s.id);
        return n;
      });
    retraits.current.planifier(s.id, async () => {
      try {
        await retirerArret(s.id, document.visibilityState === "hidden");
        setStops((all) => all.filter((x) => x.id !== s.id));
      } catch (e) {
        setToast({ ok: false, text: networkErrorMessage(e) });
      } finally {
        libere();
      }
    });
    setToast({
      ok: true,
      text: "Adresse retirée",
      dureeMs: DELAI_ANNULATION_MS,
      actions: [{ label: "Annuler", onClick: () => retraits.current.annuler(s.id) && libere() }],
    });
  }

  /** Valide les quantités physiques d'une ramasse ; livraison et point relais passent par la feuille de livraison. */
  async function terminer(s: Stop) {
    // Mode simple : « Livré » clôt tout de suite, sans lieu, preuve ni quantité.
    if (simple) return void (await statut(s, "delivered", undefined, true));
    if (estRamasse(s)) {
      const valeur = prompt(`Nombre de colis récupérés — ${s.recipient ?? s.address}`, String(s.packages_picked_up ?? s.parcel_count ?? 1));
      if (valeur === null) return;
      const quantite = Number(valeur);
      if (!Number.isInteger(quantite) || quantite < 0 || quantite > 500) {
        setToast({ ok: false, text: "Saisissez un nombre entier de colis entre 0 et 500." });
        return;
      }
      try {
        const { stop: maj } = await api<{ stop: Stop }>(`/api/colis/arrets/${s.id}`, {
          method: "PATCH",
          body: JSON.stringify({ run_id: run?.id, packages_picked_up: quantite, status: "delivered" }),
        });
        setStops((all) => all.map((x) => x.id === s.id ? maj : x));
        setToast({ ok: true, text: `${quantite} colis récupéré(s) enregistré(s).` });
      } catch (e) {
        setToast({ ok: false, text: networkErrorMessage(e) });
        await charger(run?.id);
      }
      return;
    }
    // Point relais : la feuille de dépôt demande colis déposés, retours repris et preuve (photo ou code du relais).
    setLivraison(s);
  }

  async function ajouterTelephone(s: Stop) {
    const saisi = prompt(`Téléphone du client — ${s.recipient ?? s.address}`, s.phone ?? "");
    if (saisi === null) return;
    const tel = normaliserTelephone(saisi, pays);
    if (saisi.trim() && !tel) return setToast({ ok: false, text: "Numéro non reconnu." });
    try {
      await api(`/api/colis/arrets/${s.id}`, { method: "PATCH", body: JSON.stringify({ telephone: tel }) });
      setStops((all) => all.map((x) => (x.id === s.id ? { ...x, phone: tel } : x)));
    } catch (e) {
      setToast({ ok: false, text: networkErrorMessage(e) });
    }
  }

  /** Passe cet arrêt en fin de sa liste sans le marquer comme livré : 1 clic, « Annuler » le remet à sa place. */
  async function passerAdresseSuivante(s: Stop) {
    if (!run) return;
    const liste = s.list_id ?? null;
    const apres = stops.slice(stops.indexOf(s) + 1).find((x) => (x.list_id ?? null) === liste);
    const changements = reordonner(stops, s.id, { list_id: liste, avant_id: null });
    if (changements.length === 0) return void setToast({ ok: true, text: "Cet arrêt est déjà le dernier de sa liste." });
    setStops((all) => appliquerChangements(all, changements));
    try {
      await patchArret(s.id, { run_id: run.id, deposer: { list_id: liste, avant_id: null } });
      setToast({
        ok: true,
        text: "Arrêt passé en fin de liste : il reste à traiter.",
        dureeMs: DELAI_ANNULATION_MS,
        actions: apres ? [{ label: "Annuler", onClick: () => void deposer(s.id, { list_id: liste, avant_id: apres.id }) }] : undefined,
      });
    } catch (e) {
      setToast({ ok: false, text: networkErrorMessage(e) });
      await charger(run.id);
    }
  }

  /**
   * Glisser-déposer (appui long sur la poignée) ou boutons ↑/↓ : ordre local
   * tout de suite, puis enregistrement (événement « reordered ») et
   * rechargement (prochain arrêt, heures estimées et suivi recalculés).
   */
  async function deposer(id: string, cible: CibleDepot) {
    if (!run) return;
    const changements = reordonner(stops, id, cible);
    if (changements.length === 0) return;
    setStops((all) => appliquerChangements(all, changements));
    try {
      await api(`/api/colis/arrets/${id}`, { method: "PATCH", body: JSON.stringify({ run_id: run.id, deposer: cible }) });
    } catch (e) {
      setToast({ ok: false, text: networkErrorMessage(e) });
    }
    await charger(run.id);
  }

  function demanderDemarrage() {
    setConfirmationLancement(true);
  }

  /** Après confirmation (tournée + villages) : ordre global calculé si besoin (ou si des villages ont été mis de côté), puis départ. */
  async function demarrer(modifie = false) {
    if (!run) return;
    setBusy(true);
    try {
      if ((modifie || !run.optimized_at) && stops.length > 1) await api("/api/colis/optimiser", { method: "POST", body: JSON.stringify({ run_id: run.id }) });
      await api(`/api/colis/tournees/${run.id}`, { method: "PATCH", body: JSON.stringify({ status: "in_progress" }) });
      setConfirmationLancement(false);
      await charger(run.id);
    } catch (e) {
      setToast({ ok: false, text: networkErrorMessage(e) });
    } finally {
      setBusy(false);
    }
  }

  /**
   * Recalcul depuis la position actuelle : on relit le GPS (à défaut la dernière
   * position connue), puis les arrêts restants s'enchaînent de la prochaine
   * adresse la plus proche à la suivante, jusqu'à l'arrivée choisie.
   */
  async function reoptimiser(choix?: { depart: Depart | null; arrivee: Arrivee; sens?: ModeSens }, origine = "votre position", ponctuel = false): Promise<string | null> {
    if (!run) return null;
    setBusy(true);
    try {
      const depuis = await lirePositionGps(maPosition);
      setMaPosition(depuis);
      if (choix && !ponctuel) setRun(await memoriserChoix(run, choix.depart, choix.arrivee));
      const r = await api<ResumeOptimisation>("/api/colis/optimiser", {
        method: "POST",
        body: JSON.stringify({
          run_id: run.id,
          depuis,
          strategie: "proche",
          // Ponctuel (depuis ma position / une adresse choisie) : le choix mémorisé de la tournée n'est pas modifié.
          ...(choix ? { depart: choix.depart, arrivee: choix.arrivee } : { depart: { mode: "position" } }),
          ...(choix?.sens ? { sens: choix.sens } : {}),
          ...(ponctuel || !choix ? { memoriser: false } : {}),
        }),
      });
      await charger(run.id);
      const hors = r.horsHoraires.length + r.impossibles.length;
      setToast({
        ok: !hors && !r.fermes.length,
        text: `Ordre recalculé depuis ${origine} : ≈ ${r.kmApres} km${r.extremites ? ` jusqu'à ${r.extremites.arrivee}` : ""}${r.finEstimee ? ` · fin vers ${heureFin(r.finEstimee)}` : ""}${r.distanceRoutiere === false ? " · estimation, moteur routier indisponible" : " · distances routières"}${hors ? ` · ${hors} adresse(s) hors horaires` : ""}${r.fermes.length ? ` · ${r.fermes.length} fermée(s) aujourd'hui, en fin de liste` : ""}.`,
      });
      return null;
    } catch (e) {
      const message = networkErrorMessage(e);
      setToast({ ok: false, text: message });
      return message;
    } finally {
      setBusy(false);
    }
  }

  async function cloturer() {
    if (!run) return;
    const corps = JSON.stringify({ status: "done" });
    try {
      await api(`/api/colis/tournees/${run.id}`, { method: "PATCH", body: corps });
    } catch (e) {
      // Sans réseau la clôture part en file d'attente : une tournée restée « en cours » bloquerait la sortie du dépôt.
      if (isNetworkFailure(e)) {
        await enqueueOfflineMutation(`/api/colis/tournees/${run.id}`, { method: "PATCH", body: corps }).catch(() => undefined);
        setToast({ ok: true, text: "Clôture enregistrée sur le téléphone. Elle sera synchronisée dès le retour du réseau." });
      } else setToast({ ok: false, text: networkErrorMessage(e) });
    }
    await charger(null);
  }

  const pending = arretsRestants(stops);
  const termines = stops.filter((s) => s.status !== "pending");
  // Premier arrêt non clôturé dans l'ordre, même si d'autres ont été clôturés avant leur tour.
  const prochain = prochainArret(stops) ?? undefined;
  const terme = recherche.trim().toLocaleLowerCase("fr-FR");
  const correspond = (st: Stop) =>
    [st.address, st.recipient ?? "", st.phone ?? "", st.parcel_code ?? "", st.relay_name ?? "", st.business_name ?? "", lists.find((l) => l.id === st.list_id)?.name ?? ""].some((v) =>
      v.toLocaleLowerCase("fr-FR").includes(terme),
    );
  // Recherche : tous les arrêts restants qui correspondent (prochain compris) ; sinon les suivants.
  const suivants = terme ? pending.filter(correspond) : pending.slice(1);
  const sansTelephone = arretsSansTelephone(suivants).length;
  const poidsRestant = formatPoids(sommePoids(pending));
  // Plusieurs listes : séparateurs avec le nom et les arrêts restants de chaque liste.
  const groupes = grouperParListe(stops, lists);
  const multi = groupes.length > 1 || groupes[0]?.liste != null;
  // Glisser-déposer des adresses suivantes (le prochain arrêt reste en tête
  // tant qu'il n'est pas déplacé depuis la liste) ; pas pendant une recherche.
  const triActif = Boolean(run && run.status !== "done" && !terme && suivants.length > 1);
  const ordreTri = suivants.map((s) => ({ id: s.id, list_id: s.list_id ?? null }));
  /** Repli clavier / sans glisser : échange avec l'adresse voisine affichée. */
  function deplacerRang(s: Stop, sens: -1 | 1) {
    const i = suivants.indexOf(s);
    const voisin = suivants[i + sens];
    if (!voisin) return;
    const cible = cibleDepuisSurvol(ordreTri, s.id, voisin.id);
    if (cible) void deposer(s.id, cible);
  }
  const groupeDe = (s: Stop) => groupes.find((g) => g.arrets.includes(s)) ?? groupes[0]!;
  const separateur = (s: Stop) => {
    const g = groupeDe(s);
    const r = compteurs(g.arrets).restants;
    return `${nomGroupe(g)} · ${r} restant${r > 1 ? "s" : ""}`;
  };
  const actives = (runs ?? []).filter((t) => t.status !== "done");
  const progression = stops.length ? Math.round((termines.length / stops.length) * 100) : 0;
  const choix = choixDeRun(run);
  const extremites = run ? libellesExtremites(run, stops, choix) : { depart: "", arrivee: "" };
  const avancement = estimerAvancement(
    stops.map((s) => ({ status: s.status, parcel_count: s.parcel_count, lat: s.lat, lng: s.lng, done_at: s.done_at ?? null, fenetres: horaires.fenetres.get(s.id) ?? null, service_min: serviceConnu(s.horaire) })),
    {
      position: maPosition,
      depot: run && run.start_lat !== null && run.start_lng !== null ? { lat: Number(run.start_lat), lng: Number(run.start_lng) } : null,
      retourDepot: run?.return_to_start,
      arrivee: choix.arrivee && run ? pointFinTournee(choix.arrivee, choix.depart, run.start_lat !== null && run.start_lng !== null ? { lat: Number(run.start_lat), lng: Number(run.start_lng) } : null, stops, run.return_to_start) : undefined,
      minutesItineraire: itineraire && !itineraire.approx ? itineraire.dureeMin : null,
    },
  );
  const etape = etapeParcours({ statut: run?.status ?? null, arrets: stops.length, restants: pending.length });
  const enPreparation = runs !== null && afficherPreparation(etape, preparationDemandee);
  const enCarte = !enPreparation && vue === "carte" && run !== null && run.status !== "loading" && stops.length > 0;
  // GO Navigation : seulement tournée démarrée (une tournée clôturée n'a plus rien à suivre).
  const enNavigation = !enPreparation && vue === "navigation" && run !== null && run.status === "in_progress";
  // Fermer GO (« ‹ », fin de tournée, retour du navigateur ou d'Android) ramène à « Ma tournée colis » sur PRÉPARER, jamais au tableau de bord.
  const fermerGo = useSortieGo(enNavigation, () => {
    setPreparationDemandee(ECRAN_APRES_GO.preparationDemandee);
    changerVue(ECRAN_APRES_GO.vue);
  });
  /** « Reprendre GO » depuis la préparation (ou ouverture de GO depuis la livraison) : un clic. */
  function ouvrirGo() {
    setDetailsStop(null);
    setPreparationDemandee(ECRAN_REPRISE_GO.preparationDemandee);
    changerVue(ECRAN_REPRISE_GO.vue);
  }
  // Recherche dans la liste : un seul résultat (ou Entrée) l'affiche directement sur la carte, avec son numéro.
  const idsTrouves = terme ? pending.filter(correspond).map((s) => s.id) : [];
  const cleTrouves = idsTrouves.join(",");
  function montrerSurCarte(id: string) {
    setSelection(id);
    setRecherche("");
    changerVue("carte");
  }
  useEffect(() => {
    const id = arretAAfficher(idsTrouves, terme);
    if (!id || run?.status !== "in_progress") return;
    const t = setTimeout(() => montrerSurCarte(id), 700);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [terme, cleTrouves]);
  // Retour de fin de tournée : dépôt de la tournée et/ou siège de l'entreprise.
  const [siege, setSiege] = useState<{ adresse: string; lat: number | null; lng: number | null } | null>(null);
  /** Retour de fin de tournée lancé dans GO (dépôt ou siège). */
  const [retourGo, setRetourGo] = useState<{ label: string; lat: number; lng: number; etape?: "gasoil" } | null>(null);
  /** Option « passer au gasoil » du retour : recherche de station et consommation estimée. */
  const [gasoil, setGasoil] = useState<{ info: InfoGasoil | null; chargement: boolean; erreur: boolean; fait: boolean }>({ info: null, chargement: false, erreur: false, fait: false });
  const finDeTournee = run?.status === "in_progress" && stops.length > 0 && pending.length === 0;
  useEffect(() => {
    if (!finDeTournee) return;
    api<{ adresse: string | null; lat: number | null; lng: number | null }>("/api/colis/siege")
      .then((r) => setSiege(r.adresse ? { adresse: r.adresse, lat: r.lat, lng: r.lng } : null))
      .catch(() => setSiege(null));
  }, [finDeTournee]);
  async function demanderGasoil() {
    const vers = destinationsRetour.find((d) => d.point)?.point;
    const ici = maPosition;
    if (!run || !vers || !ici) return setGasoil((g) => ({ ...g, erreur: true }));
    setGasoil((g) => ({ ...g, chargement: true, erreur: false }));
    try {
      const info = await api<InfoGasoil>(`/api/colis/gasoil?run_id=${run.id}&lat=${ici.lat}&lng=${ici.lng}&vers_lat=${vers.lat}&vers_lng=${vers.lng}`);
      setGasoil((g) => ({ ...g, info, chargement: false }));
    } catch {
      setGasoil((g) => ({ ...g, chargement: false, erreur: true }));
    }
  }
  const destinationsRetour: DestinationRetour[] = [];
  // Le niveau estimé du réservoir s'affiche dès l'ouverture de la fenêtre de fin de tournée.
  const retourOuvert = Boolean(finDeTournee && run && !retourVu.has(run.id));
  useEffect(() => {
    if (retourOuvert && maPosition && !gasoil.info && !gasoil.chargement && !gasoil.erreur && !gasoil.fait) void demanderGasoil();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [retourOuvert, maPosition]);
  if (run && run.start_lat !== null && run.start_lng !== null) {
    destinationsRetour.push({
      cle: "depot",
      titre: "Retour au dépôt",
      detail: run.start_label,
      lien: lienExterne({ lat: Number(run.start_lat), lng: Number(run.start_lng), address: run.start_label ?? "dépôt" } as Stop),
      point: { lat: Number(run.start_lat), lng: Number(run.start_lng) },
    });
  }
  if (siege) destinationsRetour.push({ cle: "siege", titre: "Retour au siège", detail: siege.adresse, lien: lienExterne({ lat: siege.lat, lng: siege.lng, address: siege.adresse } as Stop), point: siege.lat !== null && siege.lng !== null ? { lat: siege.lat, lng: siege.lng } : null });
  const rechargerRun = useCallback(() => charger(run?.id), [charger, run?.id]);
  // Adresses ajoutées sans réseau : dès que la file se vide (réseau revenu), la tournée se recharge.
  const fileAvant = useRef(0);
  useEffect(() => {
    async function surveiller() {
      const n = await listOfflineMutations().then((l) => l.length).catch(() => 0);
      if (fileAvant.current > 0 && n === 0) void rechargerRun();
      fileAvant.current = n;
    }
    void surveiller();
    window.addEventListener(OFFLINE_QUEUE_EVENT, surveiller);
    return () => window.removeEventListener(OFFLINE_QUEUE_EVENT, surveiller);
  }, [rechargerRun]);
  const arretCarte = stops.find((s) => s.id === selection) ?? prochain ?? null;

  return (
    <div className={`flex flex-col overflow-x-clip bg-paper ${enCarte ? "h-dvh" : "min-h-dvh"}`}>
      {/* Sortie du dépôt pointée automatiquement : surveillance dès qu'aucune tournée n'est en cours (après la clôture, écran de retour au dépôt compris). */}
      <SortieDepotLivreur actif={runs !== null && !runEnCours} flottant={enNavigation || retourOuvert} fix={fixGps} apresCloture={tourneeVueEnCours.current} />
      {!enNavigation && (
      <header className="sticky top-0 z-30 bg-marine px-4 pb-3 pt-[max(0.75rem,env(safe-area-inset-top))] text-white shadow-pop">
        <div className="flex items-center justify-between gap-3">
          <Link href="/dashboard" className="flex min-h-[44px] items-center gap-2 text-sm text-white/75" aria-label="Retour à l'accueil GODAC">
            <span aria-hidden="true" className="text-lg leading-none">‹</span>
            <Wordmark inverted height={22} />
          </Link>
          <h1 className="min-w-0 truncate font-display text-base font-bold">Ma tournée colis</h1>
          <button type="button" className="flex h-11 w-11 items-center justify-center rounded-full text-white/80 hover:bg-white/10" onClick={() => charger(run?.id)} aria-label="Actualiser">
            <IconRefresh className="h-5 w-5" />
          </button>
        </div>
        {runs !== null && (
          <ol className="mt-2 grid grid-cols-4 gap-1 text-center text-[11px] font-semibold" aria-label="Étapes de la tournée colis">
            {etatsEtapes(etape).map((x, i) => (
              <li
                key={x.id}
                aria-current={x.etat === "en_cours" ? "step" : undefined}
                className={`rounded-full px-1 py-1 ${x.etat === "en_cours" ? "bg-teal text-on-teal" : x.etat === "faite" ? "bg-white/15 text-white" : "text-white/55"}`}
              >
                {x.etat === "faite" ? "✓" : `${i + 1}.`} {x.libelle}
                {x.etat === "en_cours" && <span className="sr-only"> (étape en cours)</span>}
              </li>
            ))}
          </ol>
        )}
        {run && !enPreparation && (
          <div className="mt-2">
            <div className="flex items-baseline justify-between gap-2">
              {actives.length > 1 ? (
                <select
                  className="min-w-0 max-w-full truncate rounded-lg bg-white/10 px-2 py-1 text-sm font-semibold text-white"
                  value={run.id}
                  onChange={(e) => choisir(e.target.value)}
                  aria-label="Choisir la tournée"
                >
                  {actives.map((t) => (
                    <option key={t.id} value={t.id} className="text-navy">
                      {/* Plusieurs fiches le même jour (une par affectation) : l'heure prévue les distingue. */}
                      {t.name ?? "Tournée"}{t.planned_start ? ` · ${String(t.planned_start).slice(0, 5)}` : ""}
                    </option>
                  ))}
                </select>
              ) : (
                <p className="truncate text-sm font-semibold">{run.name ?? "Tournée"}</p>
              )}
              <p className="shrink-0 text-sm tabular-nums text-white/80">
                {termines.length}/{stops.length} arrêts
              </p>
            </div>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/15" role="progressbar" aria-valuenow={progression} aria-valuemin={0} aria-valuemax={100} aria-label="Avancement">
              <div className="h-full rounded-full bg-teal transition-all" style={{ width: `${progression}%` }} />
            </div>
            {run.status === "in_progress" && avancement.adressesRestantes > 0 && (
              <p className="mt-2 text-xs text-white/80">
                <strong className="text-white">{avancement.adressesRestantes}</strong> adresse{avancement.adressesRestantes > 1 ? "s" : ""} ·{" "}
                <strong className="text-white">{avancement.colisRestants}</strong> colis restant{avancement.colisRestants > 1 ? "s" : ""}
                {poidsRestant && ` (≈ ${poidsRestant})`}
                {avancement.finEstimee && (
                  <>
                    {" "}
                    · fin ≈ <strong className="text-teal">{heureFin(avancement.finEstimee)}</strong>
                  </>
                )}
              </p>
            )}
            {run.status === "in_progress" && (
              <button type="button" onClick={basculerPartage} className="mt-1 text-left text-[11px] text-white/60 underline-offset-2 hover:underline">
                {partage
                  ? `📍 Position partagée avec l'exploitation pendant la tournée${traceActive ? " · trajet enregistré (historique, 1 an)" : ""} — masquer (pause)`
                  : "📍 Position masquée, trajet non enregistré — la partager à nouveau"}
              </button>
            )}
            {run.status !== "loading" && stops.length > 0 && (
              // Plus d'onglet « Arrêts » : la liste complète (recherche, actions) est dans la feuille de GO. Un second appui sur l'onglet actif revient à l'arrêt en cours.
              <div className={`mt-3 grid ${run.status === "in_progress" ? "grid-cols-2" : "grid-cols-1"} rounded-full bg-white/10 p-1 text-sm font-semibold`} role="tablist" aria-label="Affichage">
                {(run.status === "in_progress" ? (["carte", "navigation"] as const) : (["carte"] as const)).map((v) => (
                  <button
                    key={v}
                    type="button"
                    role="tab"
                    aria-selected={vue === v}
                    onClick={() => (v === "navigation" ? ouvrirGo() : changerVue(vue === v ? "liste" : v))}
                    className={`min-h-[44px] rounded-full py-1.5 ${vue === v ? "bg-teal text-on-teal" : "text-white/80"}`}
                  >
                    {v === "carte" ? "Carte" : "GO Navigation"}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </header>
      )}

      {enNavigation && run && (
        <GoNavigation
          retour={pending.length === 0 ? retourGo : null}
          onRetourSuivant={() => {
            // Plein fait : on repropose le dépôt / le siège.
            setRetourGo(null);
            setRetourVu((v) => {
              const n = new Set(v);
              n.delete(run.id);
              return n;
            });
          }}
          run={run}
          stops={stops}
          lists={lists}
          horaires={horaires}
          avancement={avancement}
          busy={busy}
          onFermer={fermerGo}
          onRecharger={rechargerRun}
          onToast={setToast}
          onTerminer={terminer}
          onCloture={demanderNonLivre}
          modeSimple={simple}
          onModeSimple={basculerMode}
          onContact={basculerContact}
          onRetirer={retirerAdresse}
          onAppel={lancerAppel}
          onTelephone={ajouterTelephone}
          onHoraires={setHorairesStop}
          onPasser={passerAdresseSuivante}
          onDeposer={deposer}
          onReoptimiser={() => reoptimiser().then(() => undefined)}
          onOptimiserDepuisArret={(id) =>
            // L'adresse choisie ouvre le parcours ; l'arrivée mémorisée (ou le retour au dépôt) est conservée.
            reoptimiser({ depart: { mode: "arret", arret_id: id }, arrivee: choix.arrivee ?? (run && run.start_lat !== null && run.start_lng !== null ? { mode: "depot" } : { mode: "libre" }) }, "l'adresse choisie", true).then(() => undefined)
          }
          onReglagesOptimisation={() => setFeuilleOptim(true)}
          onItineraire={setItineraire}
          onPosition={memoriserFix}
          traceActive={traceActive}
        />
      )}

      {feuilleOptim && run && (
        <OptimiserSheet run={run} stops={stops} enLivraison={run.status === "in_progress"} initial={choix} onFermer={() => setFeuilleOptim(false)} onValider={(depart, arrivee, sens) => reoptimiser({ depart: run.status === "in_progress" && depart?.mode === "position" ? null : depart, arrivee, sens })} />
      )}

      {run?.status === "in_progress" && stops.length > 0 && pending.length === 0 && destinationsRetour.length > 0 && !retourVu.has(run.id) && (
        <RetourDepot
          destinations={destinationsRetour}
          nomNavigation={libelleNavigation(navPreferee === "go" ? "waze" : navPreferee)}
          gasoil={
            gasoil.fait
              ? null
              : {
                  ...gasoil,
                  onDemander: demanderGasoil,
                  onLancer: (st) => {
                    setRetourGo({ label: `⛽ ${st.nom}`, lat: st.lat, lng: st.lng, etape: "gasoil" });
                    setGasoil((g) => ({ ...g, fait: true }));
                    setRetourVu((v) => new Set(v).add(run.id));
                    ouvrirGo();
                  },
                }
          }
          onLancerGo={(d) => {
            if (!d.point) return;
            setRetourGo({ label: d.detail ? `${d.titre} — ${d.detail}` : d.titre, ...d.point });
            setRetourVu((v) => new Set(v).add(run.id));
            ouvrirGo();
          }}
          onPlusTard={() => setRetourVu((v) => new Set(v).add(run.id))}
        />
      )}

      {/* Bouton flottant : retour dans GO Navigation depuis la liste, la carte ou une fiche. */}
      {run?.status === "in_progress" && !enNavigation && (!enPreparation || preparationDemandee) && pending.length > 0 && <BoutonGoFlottant onOuvrir={ouvrirGo} />}

      <ToastColis toast={toast} onFermer={fermerToast} />
      {propositionAppel}

      {cloture && (
        <ClotureSheet
          stop={cloture.stop}
          numero={stops.indexOf(cloture.stop) + 1}
          horsOrdre={cloture.stop.id !== prochain?.id}
          mode={cloture.mode}
          onClose={() => setCloture(null)}
          onLivrer={() => {
            const s = cloture.stop;
            setCloture(null);
            terminer(s);
          }}
          onEchec={async (motif, precision, contacts) => {
            const s = cloture.stop;
            setCloture(null);
            if (s.status === "failed") await preciserNonLivre(s, motif, precision, contacts);
            else await statut(s, "failed", { motif, precision, contacts });
          }}
        />
      )}

      {livraison && (
        <LivraisonSheet
          stop={livraison}
          onClose={() => setLivraison(null)}
          onLivre={(maj) => {
            setStops((all) => all.map((x) => (x.id === maj.id ? maj : x)));
            setLivraison(null);
          }}
        />
      )}

      {horairesStop && (
        <HorairesSheet
          stop={horairesStop}
          jour={horaires.jour}
          onClose={() => setHorairesStop(null)}
          onSaved={async (texte) => {
            setHorairesStop(null);
            setToast({ ok: true, text: texte });
            await charger(run?.id);
          }}
        />
      )}

      {enCarte && run && (
        <section className="relative min-h-0 flex-1" aria-label="Carte de la tournée">
          <CarteTournee run={run} stops={stops} selection={arretCarte?.id ?? null} onSelection={choisirArret} onItineraire={setItineraire} />
          <div className="pointer-events-none absolute inset-x-0 bottom-0 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
            {itineraire && itineraire.distanceKm > 0 && (
              <p className="pointer-events-auto mx-auto mb-2 w-fit rounded-full bg-marine px-3 py-1 text-xs font-semibold text-white shadow-pop">
                Reste ≈ {itineraire.distanceKm} km
                {itineraire.dureeMin !== null && ` · ${itineraire.dureeMin >= 60 ? `${Math.floor(itineraire.dureeMin / 60)} h ${String(itineraire.dureeMin % 60).padStart(2, "0")}` : `${itineraire.dureeMin} min`} de route`}
                {itineraire.approx && " (estimation)"}
                {` · 🏁 ${extremites.arrivee}`}
              </p>
            )}
            {arretCarte ? (
              <div className="pointer-events-auto relative mx-auto flex max-w-xl flex-col gap-3 overflow-hidden rounded-2xl bg-surface p-4 shadow-pop">
                <EncocheArret stop={arretCarte} large />
                <div>
                  <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs font-semibold uppercase tracking-wide text-teal-ink">
                    <BadgeArret stop={arretCarte} />
                    <span>
                      Arrêt {stops.indexOf(arretCarte) + 1} / {stops.length}
                      {arretCarte.parcel_count > 1 && ` · ${arretCarte.parcel_count} colis`}
                      {formatPoids(arretCarte.weight_kg) && ` · ${formatPoids(arretCarte.weight_kg)}`}
                      {arretCarte.status !== "pending" ? ` · ${libelleStatut(arretCarte).toLowerCase()}` : arretCarte.id === prochain?.id ? " · prochain" : ""}
                    </span>
                  </p>
                  <p className="break-words font-display text-lg font-bold leading-snug">{arretCarte.address}</p>
                  {arretCarte.recipient && <p className="break-words text-sm text-navy/70">{arretCarte.recipient}</p>}
                  {arretCarte.status === "pending" && <BadgeHoraires stop={arretCarte} fenetres={horaires.fenetres.get(arretCarte.id) ?? null} passage={horaires.passages.get(arretCarte.id)} />}
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <a href={lienExterne(arretCarte)} className="btn-secondary justify-center !px-2 !py-2.5 text-sm" target="_blank" rel="noreferrer">
                    <IconNavigation className="h-4 w-4" /> Y aller
                  </a>
                  {arretCarte.phone ? (
                    <a href={lienTel(arretCarte.phone)} onClick={() => lancerAppel(arretCarte)} className="btn-secondary justify-center !px-2 !py-2.5 text-sm text-teal-ink">
                      <IconPhone className="h-4 w-4" /> Appeler
                    </a>
                  ) : (
                    <button type="button" className="btn-secondary justify-center !px-2 !py-2.5 text-sm" onClick={() => ajouterTelephone(arretCarte)}>
                      <IconPhone className="h-4 w-4" /> N°
                    </button>
                  )}
                  {arretCarte.status === "pending" ? (
                    <button type="button" className="btn-primary justify-center !px-2 !py-2.5 text-sm" onClick={() => terminer(arretCarte)}>
                      <IconCheck className="h-4 w-4" /> {libelleLivre(simple, arretCarte)}
                    </button>
                  ) : run.status !== "done" && (
                    <button type="button" className="btn-ghost justify-center !px-2 !py-2.5 text-sm" onClick={() => statut(arretCarte, "pending")}>
                      Annuler
                    </button>
                  )}
                </div>
              </div>
            ) : (
              <p className="pointer-events-auto mx-auto w-fit rounded-xl bg-surface px-4 py-3 text-sm font-semibold shadow-pop">Tournée terminée 🎉</p>
            )}
          </div>
        </section>
      )}


      {detailsStop && (
        <FenetreArret
          stop={stops.find((x) => x.id === detailsStop.id) ?? detailsStop}
          numero={stops.findIndex((x) => x.id === detailsStop.id) + 1}
          modeSimple={simple}
          peutPasser={pending.length > 1}
          lecture={run?.status === "done"}
          horaires={horaires}
          biais={maPosition ?? (run && run.start_lat !== null && run.start_lng !== null ? { lat: Number(run.start_lat), lng: Number(run.start_lng) } : null)}
          onFermer={() => setDetailsStop(null)}
          onAppel={lancerAppel}
          onTelephone={ajouterTelephone}
          onHoraires={setHorairesStop}
          onLivre={terminer}
          onNonLivre={(x) => demanderNonLivre(x, "echec")}
          onRetirer={retirerAdresse}
          onPasser={passerAdresseSuivante}
          onContact={basculerContact}
          onModifie={async (texte) => {
            await rechargerRun();
            setToast({ ok: true, text: texte });
          }}
        />
      )}

      {confirmationLancement && run && <LancementTournee runId={run.id} busy={busy} onAnnuler={() => setConfirmationLancement(false)} onConfirme={demarrer} />}

      {enPreparation && (
        <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-4 p-4 pb-[max(1.5rem,env(safe-area-inset-bottom))]">
          {preparationDemandee && run?.status === "in_progress" ? (
            <div className="grid gap-2">
              <button type="button" className="btn-primary min-h-[52px] w-full justify-center !bg-marine text-base !text-white" onClick={ouvrirGo}>
                <IconNavigation className="h-5 w-5 text-teal" /> Reprendre GO
              </button>
              <button type="button" className="btn-secondary min-h-[44px] w-full justify-center" onClick={fermerPreparation}>
                ‹ Retour à la livraison
              </button>
            </div>
          ) : (
            etape !== "terminee" && (
              <p className="text-sm text-navy/70">
                {prenom ? `Bonjour ${prenom}. ` : ""}
                {etape === "preparer"
                  ? "Ajoutez vos colis : scan, photo d'étiquette, bordereau ou adresse. GODAC calcule ensuite l'ordre de passage."
                  : `${stops.length} arrêt${stops.length > 1 ? "s" : ""} chargé${stops.length > 1 ? "s" : ""}. Ajoutez-en d'autres ou démarrez la tournée colis.`}
              </p>
            )
          )}
          <TourneeColis
            integre
            conduit
            lectureEtiquette={lectureEtiquette}
            pays={pays}
            runInitial={run?.id ?? null}
            onEtat={surEtatPreparation}
            onDemarrer={(id) => {
              setPreparationDemandee(false);
              void charger(id).then(demanderDemarrage);
            }}
          />
        </main>
      )}

      <main className={`mx-auto w-full max-w-xl flex-1 flex-col gap-4 p-4 pb-[max(1.5rem,env(safe-area-inset-bottom))] ${enCarte || enNavigation || enPreparation ? "hidden" : "flex"}`}>
        {runs === null ? (
          <p className="py-10 text-center text-sm text-navy/60">Chargement de la tournée colis…</p>
        ) : !run || run.status === "loading" ? null : prochain ? (
          <section
            className={`relative flex flex-col gap-4 overflow-hidden rounded-2xl border-2 bg-surface p-5 shadow-card ${bordureArret(prochain, "border-teal/60")}`}
            aria-label={estRamasse(prochain) ? "Ramasse en cours" : estPointRelais(prochain) ? "Dépôt au point relais en cours" : "Arrêt en cours"}
          >
            <EncocheArret stop={prochain} large />
            {multi && <p className="-mb-2 text-xs font-semibold text-navy/60">{separateur(prochain)}</p>}
            <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs font-semibold uppercase tracking-wide text-teal-ink">
              <BadgeArret stop={prochain} />
              <span>
                Arrêt {stops.indexOf(prochain) + 1} / {stops.length}
                {prochain.parcel_count > 1 && ` · ${prochain.parcel_count} colis${estRamasse(prochain) ? " à ramasser" : estPointRelais(prochain) ? " à déposer" : ""}`}
                {formatPoids(prochain.weight_kg) && ` · ${formatPoids(prochain.weight_kg)}`}
              </span>
            </p>
            <div>
              <p className="break-words font-display text-2xl font-bold leading-tight">{prochain.address}</p>
              {prochain.recipient && <p className="mt-1 break-words text-base text-navy/75">{prochain.recipient}</p>}
              {prochain.notes && <p className="mt-1 text-sm text-navy/65">{prochain.notes}</p>}
              {prochain.lat === null && <p className="mt-1 text-xs font-semibold text-orange-ink">Adresse non localisée : vérifiez-la dans la navigation.</p>}
              <div className="flex flex-wrap items-center gap-2">
                <BadgeHoraires stop={prochain} fenetres={horaires.fenetres.get(prochain.id) ?? null} passage={horaires.passages.get(prochain.id)} />
                <button type="button" className="btn-ghost mt-1 !px-2 !py-0.5 text-xs" onClick={() => setHorairesStop(prochain)}>
                  🕘 Horaires
                </button>
              </div>
            </div>

            {prochain.phone ? (
              <div className="grid grid-cols-[1fr_auto] gap-2">
                <a href={lienTel(prochain.phone)} onClick={() => lancerAppel(prochain)} className="btn-secondary justify-center border-teal/70 !py-3.5 text-base text-teal-ink">
                  <IconPhone className="h-5 w-5" /> Appeler · {prochain.phone}
                </a>
                <a href={lienSms(prochain.phone, SMS_ARRIVEE)} className="btn-secondary justify-center !px-4 !py-3.5" aria-label="Envoyer un SMS « j'arrive »">
                  <IconMessage className="h-5 w-5" />
                </a>
              </div>
            ) : (
              <button type="button" className="btn-secondary justify-center !py-3" onClick={() => ajouterTelephone(prochain)}>
                <IconPhone className="h-4 w-4" /> Ajouter le numéro du client
              </button>
            )}

            <div className="flex flex-wrap gap-1.5">
              <PastillesContact stop={prochain} onChange={(champ, v) => void basculerContact(prochain, champ, v)} />
            </div>
            {run.status === "in_progress" && navPreferee === "go" && (
              <button type="button" className="btn-primary justify-center !bg-marine !py-3.5 text-base !text-white" onClick={ouvrirGo}>
                <IconNavigation className="h-5 w-5 text-teal" /> Ouvrir GO Navigation
              </button>
            )}
            {navPreferee !== "go" && (
              // Waze ou Google Maps préféré : « Y aller » ouvre l'app choisie ; livraison, preuves et ordre restent ici.
              <a href={lienExterne(prochain)} className="btn-primary justify-center !bg-marine !py-3.5 text-base !text-white" target="_blank" rel="noreferrer">
                <IconNavigation className="h-5 w-5 text-teal" /> Y aller avec {libelleNavigation(navPreferee)}
              </a>
            )}
            <div className="grid grid-cols-2 gap-2">
              {navPreferee !== "waze" && (
                <a href={waze(prochain)} className="btn-secondary justify-center !py-3" target="_blank" rel="noreferrer">
                  <IconNavigation className="h-4 w-4" /> Waze
                </a>
              )}
              {navPreferee !== "gmaps" && (
                <a href={gmaps(prochain)} className="btn-secondary justify-center !py-3" target="_blank" rel="noreferrer">
                  <IconMapPin className="h-4 w-4" /> Google Maps
                </a>
              )}
              {navPreferee !== "go" && run.status === "in_progress" && (
                <button type="button" className="btn-secondary justify-center !py-3" onClick={ouvrirGo}>
                  <IconNavigation className="h-4 w-4 text-teal-ink" /> GO Navigation
                </button>
              )}
            </div>
            {run.status === "in_progress" && (
              <div className="flex flex-col gap-1.5">
                <p id="nav-preferee" className="text-xs font-semibold text-navy/60">
                  Navigation préférée (sur ce téléphone)
                </p>
                <div className="grid grid-cols-3 gap-1 rounded-full bg-navy/[0.06] p-1 text-xs font-semibold" role="radiogroup" aria-labelledby="nav-preferee">
                  {NAVIGATIONS.map((n) => (
                    <button
                      key={n.id}
                      type="button"
                      role="radio"
                      aria-checked={navPreferee === n.id}
                      onClick={() => choisirNavigation(n.id)}
                      className={`min-h-[44px] rounded-full px-1 ${navPreferee === n.id ? "bg-marine text-white shadow-card" : "text-navy/70"}`}
                    >
                      {n.id === "go" ? "GO" : n.libelle}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {pending.length > 1 && (
              <button type="button" className="btn-ghost justify-center !py-2.5 text-sm" disabled={busy} onClick={() => passerAdresseSuivante(prochain)}>
                Passer à l’adresse suivante (garder cet arrêt pour plus tard)
              </button>
            )}
            <div className="grid grid-cols-[2fr_1fr] gap-2">
              <button type="button" className="btn-primary justify-center !py-4 text-lg" onClick={() => terminer(prochain)}>
                {!simple && estRamasse(prochain) ? <IconRamasse className="h-6 w-6" /> : !simple && estPointRelais(prochain) ? <IconPointRelais className="h-6 w-6" /> : <IconCheck className="h-6 w-6" />} {libelleLivre(simple, prochain)}
              </button>
              <button type="button" className="btn-secondary justify-center !py-4 text-orange-ink" onClick={() => demanderNonLivre(prochain, "echec")}>
                <IconX className="h-5 w-5" /> Non livré
              </button>
            </div>
          </section>
        ) : (
          <section className="flex flex-col items-center gap-3 rounded-2xl bg-surface p-6 text-center shadow-card">
            <p className="font-display text-xl font-bold">Tous les arrêts sont traités 🎉</p>
            <p className="text-sm text-navy/65">
              {stops.filter((s) => s.status === "delivered" && !estRamasse(s)).length} livré(s)
              {stops.some(estRamasse) && `, ${stops.filter((s) => s.status === "delivered" && estRamasse(s)).length} ramasse(s) faite(s)`}, {stops.filter((s) => s.status === "failed").length} absent(s).
            </p>
            {run.status !== "done" && (
              <>
                <button type="button" className="btn-primary min-h-[44px] !py-3" onClick={cloturer}>
                  Clôturer la tournée colis
                </button>
                <p className="text-xs text-navy/60">Une fois clôturée, la tournée colis est verrouillée. Vous pourrez en ouvrir une autre (tournée supplémentaire).</p>
              </>
            )}
          </section>
        )}

        {run && run.status !== "done" && run.status !== "loading" && <InterrupteurMode simple={simple} onChange={(v) => void basculerMode(v)} />}
        {run?.status === "in_progress" && (
          <button type="button" className="btn-secondary min-h-[44px] justify-center" onClick={() => setPreparationDemandee(true)}>
            <IconQrCode className="h-5 w-5" /> Ajouter ou modifier des colis
          </button>
        )}
        {run?.status === "in_progress" && (
          <button type="button" className="btn-ghost min-h-[44px] justify-center text-sm text-orange-ink" onClick={supprimerTournee}>
            Supprimer cette tournée colis
          </button>
        )}

        {run && run.status !== "loading" && stops.length > 1 && (
          <label className="relative block">
            <span className="sr-only">Rechercher dans la tournée</span>
            <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-navy/45" aria-hidden="true">⌕</span>
            <input
              className="input !pl-9"
              type="search"
              value={recherche}
              onChange={(e) => setRecherche(e.target.value)}
              onKeyDown={(e) => {
                // Entrée : le premier résultat s'affiche directement sur la carte.
                const id = e.key === "Enter" && run?.status === "in_progress" ? arretAAfficher(idsTrouves, terme, true) : null;
                if (id) (e.preventDefault(), montrerSurCarte(id));
              }}
              placeholder="Adresse, destinataire, ville ou n° de colis…"
              aria-label="Rechercher une adresse, un destinataire, une ville ou un colis dans la tournée"
            />
            {recherche && (
              <button type="button" className="absolute inset-y-0 right-2 px-2 text-sm text-navy/60" onClick={() => setRecherche("")}>
                Effacer
              </button>
            )}
          </label>
        )}
        {run && run.status !== "loading" && terme && suivants.length === 0 && <p className="text-center text-sm text-navy/60">Aucun arrêt restant ne correspond à « {recherche.trim()} ».</p>}

        {run && run.status !== "loading" && suivants.length > 0 && (
          <section aria-label={terme ? "Résultats de la recherche" : "Adresses suivantes"}>
            <div className="mb-2 flex items-center justify-between">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-navy/60">
                {terme ? "Résultats" : "Ensuite"} · {suivants.length}
                {sansTelephone > 0 && (
                  <span className="ml-2 rounded-full bg-orange/15 px-2 py-0.5 text-[11px] normal-case tracking-normal text-orange-ink" title={ALERTE_SANS_TELEPHONE}>
                    {sansTelephone} sans téléphone
                  </span>
                )}
              </h2>
              <div className="flex items-center gap-1">
                <button type="button" className="btn-ghost min-h-[44px] !px-2 !py-1 text-xs" disabled={busy} onClick={() => setFeuilleOptim(true)}>
                  Départ / arrivée
                </button>
                <button type="button" className="btn-secondary min-h-[44px] !px-3 !py-1 text-xs" disabled={busy} onClick={() => void reoptimiser()}>
                  {busy ? "Calcul…" : "Recalculer depuis ma position"}
                </button>
              </div>
            </div>
            <ZoneTri ordre={ordreTri} onDeposer={deposer} actif={triActif}>
            <ol className="flex flex-col gap-2">
              {suivants.map((s, k) => (
                <Fragment key={s.id}>
                  {multi && (terme ? k === 0 || groupeDe(s) !== groupeDe(suivants[k - 1]!) : groupeDe(s) !== groupeDe(k ? suivants[k - 1]! : prochain!)) && (
                    <li className="mt-2 flex items-center gap-2 px-1 text-xs font-semibold uppercase tracking-wide text-navy/60" aria-label={`Liste ${separateur(s)}`}>
                      <span className="h-px flex-1 bg-navy/15" aria-hidden="true" />
                      {separateur(s)}
                      <span className="h-px flex-1 bg-navy/15" aria-hidden="true" />
                    </li>
                  )}
                  {(() => {
                  const rendu = (props: { ref?: (el: HTMLElement | null) => void; style?: CSSProperties } | null, poignee: Poignee | null) => (
                  <li ref={props?.ref} style={props?.style} className={`relative flex items-center gap-3 overflow-hidden rounded-xl bg-surface py-2.5 pr-3 shadow-card ${estMarque(s) ? "pl-4" : "pl-3"}`}>
                    <EncocheArret stop={s} />
                    {poignee && <BoutonPoignee poignee={poignee} libelle={s.recipient ?? s.address} />}
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-marine text-xs font-semibold tabular-nums text-teal-sur-menu">{stops.indexOf(s) + 1}</span>
                    <div className="min-w-0 flex-1">
                      {(estRamasse(s) || estPointRelais(s) || !s.phone) && (
                        <div className="mb-1 flex flex-wrap gap-1">
                          <BadgeArret stop={s} />
                          {!s.phone && <BadgeSansTelephone />}
                        </div>
                      )}
                      <p className="break-words text-sm font-semibold leading-snug">{s.address}</p>
                      <p className="truncate text-xs text-navy/60">{[s.recipient, s.parcel_count > 1 && `${s.parcel_count} colis`, formatPoids(s.weight_kg)].filter(Boolean).join(" · ") || " "}</p>
                      <BadgeHoraires stop={s} fenetres={horaires.fenetres.get(s.id) ?? null} passage={horaires.passages.get(s.id)} />
                      <div className="mt-1.5 flex flex-wrap gap-2">
                        <button type="button" className="min-h-[44px] rounded-full border border-teal/40 px-3 text-xs font-semibold text-teal-ink hover:bg-teal/10" onClick={() => setDetailsStop(s)}>
                          Ouvrir la fiche
                        </button>
                        {simple ? (
                          <>
                            <button type="button" className="btn-primary min-h-[44px] !px-4 !py-1 text-xs" onClick={() => void terminer(s)} aria-label={`Livré — ${s.recipient ?? s.address}`}>
                              <IconCheck className="h-4 w-4" /> Livré
                            </button>
                            <button type="button" className="btn-secondary min-h-[44px] !px-3 !py-1 text-xs text-orange-ink" onClick={() => demanderNonLivre(s, "echec")} aria-label={`Non livré — ${s.recipient ?? s.address}`}>
                              <IconX className="h-4 w-4" /> Non livré
                            </button>
                          </>
                        ) : (
                          <button
                            type="button"
                            className="min-h-[44px] rounded-full border border-navy/15 px-3 text-xs font-semibold text-navy/80 hover:border-teal"
                            onClick={() => setCloture({ stop: s, mode: "choix" })}
                            aria-label={`Clôturer ${s.recipient ?? s.address}`}
                          >
                            Clôturer ›
                          </button>
                        )}
                        <PastillesContact stop={s} onChange={(champ, v) => void basculerContact(s, champ, v)} />
                        <button type="button" className="min-h-[44px] rounded-full border border-navy/15 px-3 text-xs font-semibold text-orange-ink" onClick={() => retirerAdresse(s)} aria-label={`Retirer ${s.recipient ?? s.address}`}>
                          Retirer
                        </button>
                        {triActif && (
                          <>
                            <button type="button" className="rounded-full border border-navy/15 px-2.5 py-1.5 text-xs font-semibold text-navy/70" disabled={k === 0} onClick={() => deplacerRang(s, -1)} aria-label={`Monter ${s.recipient ?? s.address}`}>
                              ↑
                            </button>
                            <button type="button" className="rounded-full border border-navy/15 px-2.5 py-1.5 text-xs font-semibold text-navy/70" disabled={k === suivants.length - 1} onClick={() => deplacerRang(s, 1)} aria-label={`Descendre ${s.recipient ?? s.address}`}>
                              ↓
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                    <button
                      type="button"
                      className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-navy/[0.05] text-base"
                      onClick={() => setHorairesStop(s)}
                      aria-label={`Horaires de ${s.recipient ?? s.address}`}
                    >
                      🕘
                    </button>
                    {s.phone ? (
                      <a href={lienTel(s.phone)} onClick={() => lancerAppel(s)} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-teal/15 text-teal-ink" aria-label={`Appeler ${s.recipient ?? s.address} (${s.phone})`}>
                        <IconPhone className="h-5 w-5" />
                      </a>
                    ) : (
                      <button type="button" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-navy/[0.05] text-navy/40" onClick={() => ajouterTelephone(s)} aria-label={`Ajouter le numéro de ${s.recipient ?? s.address}`}>
                        <IconPhone className="h-5 w-5" />
                      </button>
                    )}
                    <a href={waze(s)} target="_blank" rel="noreferrer" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-navy/[0.05] text-navy/70" aria-label={`Naviguer vers ${s.address}`}>
                      <IconNavigation className="h-5 w-5" />
                    </a>
                  </li>
                  );
                  return triActif ? <ArretTriable id={s.id} rendu={rendu} /> : rendu(null, null);
                  })()}
                </Fragment>
              ))}
            </ol>
            </ZoneTri>
            {!terme && (
              <p className="mt-2 text-xs font-semibold text-navy/70">
                🏁 Arrivée : <span className="font-normal">{extremites.arrivee}</span>
                {avancement.finEstimee && <span className="font-normal"> · fin estimée vers {heureFin(avancement.finEstimee)}</span>}
              </p>
            )}
          </section>
        )}

        {run && termines.length > 0 && (
          <section aria-label="Arrêts terminés">
            <button type="button" className="btn-ghost w-full justify-between !px-1 text-sm text-navy/60" onClick={() => setVoirTermines((v) => !v)} aria-expanded={voirTermines}>
              <span>Terminés · {termines.length}</span>
              <span aria-hidden="true">{voirTermines ? "▴" : "▾"}</span>
            </button>
            {(voirTermines || terme) && (
              <ol className="mt-1 flex flex-col gap-1.5">
                {(terme ? termines.filter(correspond) : termines).map((s) => (
                  <li key={s.id} className={`relative flex items-center gap-3 overflow-hidden rounded-xl bg-surface py-2 pr-3 opacity-70 ${estMarque(s) ? "pl-4" : "pl-3"}`}>
                    <EncocheArret stop={s} />
                    <span
                      className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${s.status === "delivered" ? "bg-teal text-on-teal" : "bg-orange text-on-orange"}`}
                      title={libelleStatut(s)}
                    >
                      {s.status === "delivered" ? "✓" : "!"}
                    </span>
                    <p className="min-w-0 flex-1 truncate text-sm">
                      {estRamasse(s) && <span className="mr-1 font-semibold text-gold-ink">Ramasse ·</span>}
                      {estPointRelais(s) && <span className="mr-1 font-semibold text-relais-ink">Relais{s.relay_name ? ` ${s.relay_name}` : ""} ·</span>}
                      {s.address}
                      {s.status === "failed" && libelleMotif(s.failure_reason) && <span className="block text-xs text-orange-ink">{libelleMotif(s.failure_reason)}</span>}
                      {libelleContacts(s) && <span className="block text-xs text-navy/70">{libelleContacts(s)}</span>}
                      {s.status === "delivered" && s.delivered_place === "point_relais" && <span className="block truncate text-xs text-relais-ink">{libellePreuve(s)}</span>}
                    </p>
                    {s.proof_code && (
                      <span className="flex shrink-0 items-center gap-1 text-xs text-navy/60" title={`${s.delivered_place === "point_relais" ? "Code du relais" : "QR code"} scanné : ${s.proof_code}`} aria-label={`${s.delivered_place === "point_relais" ? "Code du relais" : "Livré avec QR code"} ${s.proof_code}`}>
                        <IconQrCode className="h-4 w-4" />
                        <span className="hidden font-mono sm:inline">{resumeCodeQr(s.proof_code, 14)}</span>
                      </span>
                    )}
                    {s.proof_photo_path && (
                      <a href={`/api/colis/arrets/${s.id}/livraison`} target="_blank" rel="noreferrer" className="btn-ghost !px-2 !py-1 text-xs" aria-label={`Photo de livraison — ${s.address}`}>
                        📷
                      </a>
                    )}
                    {s.phone && (
                      <a href={lienTel(s.phone)} className="btn-ghost !px-2 !py-1 text-teal-ink" aria-label={`Rappeler ${s.recipient ?? s.address}`}>
                        <IconPhone className="h-4 w-4" />
                      </a>
                    )}
                    {run.status !== "done" && s.status === "failed" && (
                      <button type="button" className="btn-ghost min-h-[44px] !px-2 !py-1 text-xs" onClick={() => setCloture({ stop: s, mode: "echec" })}>
                        Préciser
                      </button>
                    )}
                    {run.status !== "done" && (
                      <button type="button" className="btn-ghost min-h-[44px] !px-2 !py-1 text-xs" onClick={() => statut(s, "pending")}>
                        Annuler
                      </button>
                    )}
                  </li>
                ))}
              </ol>
            )}
          </section>
        )}
      </main>

      {recommander && !enNavigation && !enCarte && (
        <footer className="px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-2 text-center">
          <button type="button" onClick={() => setRecoOuverte(true)} className="min-h-[44px] px-3 text-sm text-navy/60 underline-offset-2 hover:underline">
            Recommander GODAC à mon employeur
          </button>
        </footer>
      )}
      {recoOuverte && <RecommanderEmployeur onFermer={() => setRecoOuverte(false)} />}
    </div>
  );
}
