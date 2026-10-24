"use client";

import { Fragment, useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { Wordmark } from "@/components/brand/Wordmark";
import { IconPointRelais, IconCheck, IconMapPin, IconQrCode, IconRamasse, IconMessage, IconNavigation, IconPhone, IconRefresh, IconX } from "@/components/layout/icons";
import { ALERTE_SANS_TELEPHONE, arretsSansTelephone, lienSms, lienTel, normaliserTelephone } from "@/lib/colis/telephone";
import { BoutonGoFlottant } from "@/components/colis/BoutonGoFlottant";
import { RetourDepot, type DestinationRetour, type InfoGasoil } from "@/components/colis/RetourDepot";
import { FicheEdition } from "@/components/colis/FicheEdition";
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
import { api, gmaps, waze, SMS_ARRIVEE, type Liste, type Run, type RunResume, type Stop } from "@/components/colis/commun";
import { compteurs, grouperParListe, nomGroupe } from "@/lib/colis/listes";
import type { Itineraire } from "@/lib/colis/itineraire";
import { estimerAvancement, heureFin } from "@/lib/colis/estimation";
import { LancementTournee } from "@/components/colis/LancementTournee";
import { BadgeHoraires, HorairesSheet, useHoraires, type ResumeOptimisation } from "@/components/colis/HorairesSheet";
import { useTraceGps } from "@/components/colis/useTraceGps";
import { ArretTriable, BoutonPoignee, ZoneTri, type Poignee } from "@/components/colis/Triable";
import { appliquerChangements, cibleDepuisSurvol, reordonner, type CibleDepot } from "@/lib/colis/reordonner";
import { TourneeColis } from "@/components/colis/TourneeColis";
import { OptimiserSheet, choixDeRun, libellesExtremites, lirePositionGps, memoriserChoix } from "@/components/colis/OptimiserSheet";
import { pointFinTournee, type Arrivee, type Depart } from "@/lib/colis/extremites";
import { confirmer } from "@/lib/ui/confirmation";
import { afficherPreparation, etapeParcours, etatsEtapes } from "@/lib/colis/parcours";
import { SortieDepotLivreur } from "@/components/time-clock/SortieDepotLivreur";
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
  const [stops, setStops] = useState<Stop[]>([]);
  const [lists, setLists] = useState<Liste[]>([]);
  /** Feuille « Départ / arrivée » du recalcul en cours de route. */
  const [feuilleOptim, setFeuilleOptim] = useState(false);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<{ ok: boolean; text: string } | null>(null);
  const [voirTermines, setVoirTermines] = useState(false);
  const [confirmationLancement, setConfirmationLancement] = useState(false);
  /** Recherche d'une adresse, d'un destinataire, d'une ville ou d'un code colis. */
  const [recherche, setRecherche] = useState("");
  const [livraison, setLivraison] = useState<Stop | null>(null);
  const [detailsStop, setDetailsStop] = useState<Stop | null>(null);
  /** Fiche en cours de modification (erreur de saisie à la base). */
  const [ficheEdition, setFicheEdition] = useState(false);
  /** Tournées pour lesquelles la proposition de retour au dépôt a été vue (fermée ou lancée). */
  const [retourVu, setRetourVu] = useState<Set<string>>(new Set());
  /** Arrêt en cours de clôture (n'importe lequel des restants, pas seulement le prochain). */
  const [cloture, setCloture] = useState<{ stop: Stop; mode: "choix" | "echec" } | null>(null);
  const [vue, setVue] = useState<Vue>(vueInitiale ?? "liste");
  const [selection, setSelection] = useState<string | null>(null);
  const [itineraire, setItineraire] = useState<Itineraire | null>(null);
  const [partage, setPartage] = useState(true);
  const [maPosition, setMaPosition] = useState<{ lat: number; lng: number } | null>(null);
  /** Arrêt dont on saisit les horaires (adresse pro / créneau du jour). */
  const [horairesStop, setHorairesStop] = useState<Stop | null>(null);
  /** Préparation ouverte à la demande pendant la livraison (« Ajouter ou modifier des colis »). */
  const [preparationDemandee, setPreparationDemandee] = useState(false);
  /** Guidage vers l'arrêt : GO Navigation (par défaut), Waze ou Google Maps (mémorisé sur le téléphone). */
  const [navPreferee, setNavPreferee] = useState<NavigationPreferee>("go");
  const preparationDemandeeRef = useRef(false);
  preparationDemandeeRef.current = preparationDemandee;
  const horaires = useHoraires(run, stops, maPosition);
  const dernierEnvoi = useRef(0);

  useEffect(() => {
    try {
      if (localStorage.getItem(MEMO_PARTAGE) === "non") setPartage(false);
    } catch {
      /* stockage indisponible */
    }
  }, []);

  // Pendant la tournée en cours : dernière position envoyée à l'exploitation
  // (au plus une fois par minute, écran ouvert), jamais en dehors.
  const runEnCours = run?.status === "in_progress" ? run.id : null;
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
        setMaPosition(pos);
        fetch("/api/colis/position", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ run_id: runEnCours, ...pos }) }).catch(() => undefined);
      },
      () => undefined,
      { enableHighAccuracy: true, maximumAge: 30_000 },
    );
    return () => navigator.geolocation.clearWatch(id);
  }, [runEnCours, partage]);

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
      setStops(data.stops);
      setLists(data.lists ?? []);
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

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(t);
  }, [toast]);

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

  /** Clôture (livré / échec avec motif) ou annulation d'un arrêt, dans n'importe quel ordre. */
  async function statut(s: Stop, status: Stop["status"], echec?: { motif: MotifEchec; precision: string | null }) {
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
    if (status !== "pending") navigator.vibrate?.(40);
    try {
      await api(`/api/colis/arrets/${s.id}`, { method: "PATCH", body: JSON.stringify({ status, run_id: run?.id, ...(echec ?? {}) }) });
    } catch (e) {
      if (isNetworkFailure(e)) {
        try {
          await enqueueOfflineMutation(`/api/colis/arrets/${s.id}`, { method: "PATCH", body: JSON.stringify({ status, run_id: run?.id, ...(echec ?? {}) }) });
          setToast({ ok: true, text: "Action enregistrée sur le téléphone. Elle sera synchronisée dès le retour du réseau." });
          return;
        } catch (queueError) {
          setToast({ ok: false, text: networkErrorMessage(queueError) });
        }
      } else setToast({ ok: false, text: networkErrorMessage(e) });
      await charger(run?.id);
    }
  }

  /** Valide les quantités physiques d'une ramasse ; livraison et point relais passent par la feuille de livraison. */
  async function terminer(s: Stop) {
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

  /** Passe temporairement cet arrêt en fin de file sans le marquer comme livré. */
  async function passerAdresseSuivante(s: Stop) {
    if (!run) return;
    const restant = arretsRestants(stops).length;
    if (restant < 2) return;
    setBusy(true);
    try {
      for (let i = 0; i < restant; i++) {
        await api(`/api/colis/arrets/${s.id}`, {
          method: "PATCH",
          body: JSON.stringify({ run_id: run.id, deplacer: "bas" }),
        });
      }
      await charger(run.id);
      setToast({ ok: true, text: "Arrêt déplacé en fin de tournée. Il reste à traiter." });
    } catch (e) {
      setToast({ ok: false, text: networkErrorMessage(e) });
      await charger(run.id);
    } finally {
      setBusy(false);
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

  /** Après confirmation (tournée + villages) : ordre global calculé si besoin, puis départ. */
  async function demarrer() {
    if (!run) return;
    setBusy(true);
    try {
      if (!run.optimized_at && stops.length > 1) await api("/api/colis/optimiser", { method: "POST", body: JSON.stringify({ run_id: run.id }) });
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
  async function reoptimiser(choix?: { depart: Depart | null; arrivee: Arrivee }, origine = "votre position", ponctuel = false): Promise<string | null> {
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
    await api(`/api/colis/tournees/${run.id}`, { method: "PATCH", body: JSON.stringify({ status: "done" }) }).catch(() => undefined);
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
    stops.map((s) => ({ status: s.status, parcel_count: s.parcel_count, lat: s.lat, lng: s.lng, done_at: s.done_at ?? null, fenetres: horaires.fenetres.get(s.id) ?? null })),
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
    <div className={`flex flex-col bg-paper ${enCarte ? "h-dvh" : "min-h-dvh"}`}>
      {/* Sortie du dépôt pointée automatiquement : surveillance dès qu'aucune tournée n'est en cours (après la clôture, écran de retour au dépôt compris). */}
      <SortieDepotLivreur actif={runs !== null && !runEnCours} flottant={enNavigation || retourOuvert} />
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
                  className="min-w-0 rounded-lg bg-white/10 px-2 py-1 text-sm font-semibold text-white"
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
              <div className={`mt-3 grid ${run.status === "in_progress" ? "grid-cols-3" : "grid-cols-2"} rounded-full bg-white/10 p-1 text-sm font-semibold`} role="tablist" aria-label="Affichage">
                {(run.status === "in_progress" ? (["liste", "carte", "navigation"] as const) : (["liste", "carte"] as const)).map((v) => (
                  <button
                    key={v}
                    type="button"
                    role="tab"
                    aria-selected={vue === v}
                    onClick={() => changerVue(v)}
                    className={`min-h-[44px] rounded-full py-1.5 ${vue === v ? "bg-teal text-on-teal" : "text-white/80"}`}
                  >
                    {v === "liste" ? "Arrêts" : v === "carte" ? "Carte" : "GO Navigation"}
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
          onFermer={() => changerVue("liste")}
          onRecharger={rechargerRun}
          onToast={setToast}
          onTerminer={terminer}
          onCloture={(s, mode) => setCloture({ stop: s, mode })}
          onTelephone={ajouterTelephone}
          onHoraires={setHorairesStop}
          onFiche={setDetailsStop}
          onPasser={passerAdresseSuivante}
          onDeposer={deposer}
          onReoptimiser={() => reoptimiser().then(() => undefined)}
          onOptimiserDepuisArret={(id) =>
            // L'adresse choisie ouvre le parcours ; l'arrivée mémorisée (ou le retour au dépôt) est conservée.
            reoptimiser({ depart: { mode: "arret", arret_id: id }, arrivee: choix.arrivee ?? (run && run.start_lat !== null && run.start_lng !== null ? { mode: "depot" } : { mode: "libre" }) }, "l'adresse choisie", true).then(() => undefined)
          }
          onReglagesOptimisation={() => setFeuilleOptim(true)}
          onItineraire={setItineraire}
          onPosition={setMaPosition}
          traceActive={traceActive}
        />
      )}

      {feuilleOptim && run && (
        <OptimiserSheet run={run} stops={stops} enLivraison={run.status === "in_progress"} initial={choix} onFermer={() => setFeuilleOptim(false)} onValider={(depart, arrivee) => reoptimiser({ depart: run.status === "in_progress" && depart?.mode === "position" ? null : depart, arrivee })} />
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
                    changerVue("navigation");
                  },
                }
          }
          onLancerGo={(d) => {
            if (!d.point) return;
            setRetourGo({ label: d.detail ? `${d.titre} — ${d.detail}` : d.titre, ...d.point });
            setRetourVu((v) => new Set(v).add(run.id));
            changerVue("navigation");
          }}
          onPlusTard={() => setRetourVu((v) => new Set(v).add(run.id))}
        />
      )}

      {/* Bouton flottant : retour dans GO Navigation depuis la liste, la carte ou une fiche. */}
      {run?.status === "in_progress" && !enNavigation && !enPreparation && pending.length > 0 && (
        <BoutonGoFlottant
          onOuvrir={() => {
            setDetailsStop(null);
            setFicheEdition(false);
            changerVue("navigation");
          }}
        />
      )}

      {toast && (
        <p role="status" className={`fixed inset-x-4 top-24 z-[70] mx-auto max-w-md rounded-xl px-4 py-3 text-sm font-semibold shadow-pop ${toast.ok ? "bg-marine text-white" : "bg-orange text-on-orange"}`}>
          {toast.text}
        </p>
      )}

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
          onEchec={async (motif, precision) => {
            const s = cloture.stop;
            setCloture(null);
            await statut(s, "failed", { motif, precision });
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
                  <p className="font-display text-lg font-bold leading-snug">{arretCarte.address}</p>
                  {arretCarte.recipient && <p className="text-sm text-navy/70">{arretCarte.recipient}</p>}
                  {arretCarte.status === "pending" && <BadgeHoraires stop={arretCarte} fenetres={horaires.fenetres.get(arretCarte.id) ?? null} passage={horaires.passages.get(arretCarte.id)} />}
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <a href={lienExterne(arretCarte)} className="btn-secondary justify-center !px-2 !py-2.5 text-sm" target="_blank" rel="noreferrer">
                    <IconNavigation className="h-4 w-4" /> Y aller
                  </a>
                  {arretCarte.phone ? (
                    <a href={lienTel(arretCarte.phone)} className="btn-secondary justify-center !px-2 !py-2.5 text-sm text-teal-ink">
                      <IconPhone className="h-4 w-4" /> Appeler
                    </a>
                  ) : (
                    <button type="button" className="btn-secondary justify-center !px-2 !py-2.5 text-sm" onClick={() => ajouterTelephone(arretCarte)}>
                      <IconPhone className="h-4 w-4" /> N°
                    </button>
                  )}
                  {arretCarte.status === "pending" ? (
                    <button type="button" className="btn-primary justify-center !px-2 !py-2.5 text-sm" onClick={() => terminer(arretCarte)}>
                      <IconCheck className="h-4 w-4" /> {libelleFait(arretCarte)}
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
        <div className="fixed inset-0 z-[85] flex items-end justify-center bg-navy/60 p-3 sm:items-center" role="dialog" aria-modal="true" aria-labelledby="fiche-arret-title">
          <section className="w-full max-w-lg rounded-2xl bg-surface p-5 shadow-pop">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 id="fiche-arret-title" className="font-display text-xl font-bold">Fiche de livraison</h2>
                <p className="mt-1 text-sm text-navy/60">{estRamasse(detailsStop) ? "Ramasse" : estPointRelais(detailsStop) ? `Point relais${detailsStop.relay_name ? ` · ${detailsStop.relay_name}` : ""}` : "Livraison"}</p>
              </div>
              <button type="button" className="btn-ghost !px-2 !py-1" onClick={() => { setDetailsStop(null); setFicheEdition(false); }} aria-label="Fermer la fiche">✕</button>
            </div>
            {ficheEdition ? (
              <FicheEdition
                stop={detailsStop}
                biais={maPosition ?? (run && run.start_lat !== null && run.start_lng !== null ? { lat: Number(run.start_lat), lng: Number(run.start_lng) } : null)}
                onFermer={() => setFicheEdition(false)}
                onEnregistre={async (texte) => {
                  setFicheEdition(false);
                  setDetailsStop(null);
                  await rechargerRun();
                  setToast({ ok: true, text: texte });
                }}
              />
            ) : (
              <>
            <p className="mt-4 break-words text-lg font-semibold">{detailsStop.address}</p>
              {detailsStop.recipient && <p className="mt-1">{detailsStop.recipient}</p>}
              {detailsStop.phone && <p className="mt-1 text-sm">{detailsStop.phone}</p>}
              {detailsStop.notes && <p className="mt-2 rounded-lg bg-navy/5 p-3 text-sm">{detailsStop.notes}</p>}
              <p className="mt-3 text-sm text-navy/65">Prévu : {detailsStop.parcel_count} colis{detailsStop.packages_picked_up != null ? ` · ${estPointRelais(detailsStop) ? "retours repris" : "récupérés"} : ${detailsStop.packages_picked_up}` : ""}{detailsStop.packages_delivered != null ? ` · déposés : ${detailsStop.packages_delivered}` : ""}</p>
              <div className="mt-4 grid grid-cols-2 gap-2">
                <a className="btn-secondary justify-center" href={waze(detailsStop)} target="_blank" rel="noreferrer"><IconNavigation className="h-4 w-4" /> Waze</a>
                <a className="btn-secondary justify-center" href={gmaps(detailsStop)} target="_blank" rel="noreferrer"><IconMapPin className="h-4 w-4" /> Google Maps</a>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <button type="button" className="btn-secondary justify-center" onClick={() => { setDetailsStop(null); void passerAdresseSuivante(detailsStop); }}>Passer plus tard</button>
                <button type="button" className="btn-primary justify-center" onClick={() => { const s = detailsStop; setDetailsStop(null); terminer(s); }}>Traiter cet arrêt</button>
              </div>
                <button type="button" className="btn-ghost mt-2 min-h-[44px] w-full justify-center text-sm" onClick={() => setFicheEdition(true)}>✏️ Modifier la fiche</button>
              </>
            )}
          </section>
        </div>
      )}

      {confirmationLancement && run && <LancementTournee runId={run.id} busy={busy} onAnnuler={() => setConfirmationLancement(false)} onConfirme={demarrer} />}

      {enPreparation && (
        <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-4 p-4 pb-[max(1.5rem,env(safe-area-inset-bottom))]">
          {preparationDemandee && run?.status === "in_progress" ? (
            <button type="button" className="btn-secondary min-h-[44px] w-full justify-center" onClick={fermerPreparation}>
              ‹ Retour à la livraison
            </button>
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
              <p className="font-display text-2xl font-bold leading-tight">{prochain.address}</p>
              {prochain.recipient && <p className="mt-1 text-base text-navy/75">{prochain.recipient}</p>}
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
                <a href={lienTel(prochain.phone)} className="btn-secondary justify-center border-teal/70 !py-3.5 text-base text-teal-ink">
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

            {run.status === "in_progress" && navPreferee === "go" && (
              <button type="button" className="btn-primary justify-center !bg-marine !py-3.5 text-base !text-white" onClick={() => changerVue("navigation")}>
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
                <button type="button" className="btn-secondary justify-center !py-3" onClick={() => changerVue("navigation")}>
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
                {estRamasse(prochain) ? <IconRamasse className="h-6 w-6" /> : estPointRelais(prochain) ? <IconPointRelais className="h-6 w-6" /> : <IconCheck className="h-6 w-6" />} {libelleFait(prochain)}
              </button>
              <button type="button" className="btn-secondary justify-center !py-4 text-orange-ink" onClick={() => setCloture({ stop: prochain, mode: "echec" })}>
                <IconX className="h-5 w-5" /> Absent
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
                      <p className="text-sm font-semibold leading-snug">{s.address}</p>
                      <p className="truncate text-xs text-navy/60">{[s.recipient, s.parcel_count > 1 && `${s.parcel_count} colis`, formatPoids(s.weight_kg)].filter(Boolean).join(" · ") || " "}</p>
                      <BadgeHoraires stop={s} fenetres={horaires.fenetres.get(s.id) ?? null} passage={horaires.passages.get(s.id)} />
                      <div className="mt-1.5 flex flex-wrap gap-2">
                        <button type="button" className="rounded-full border border-teal/40 px-3 py-1.5 text-xs font-semibold text-teal-ink hover:bg-teal/10" onClick={() => setDetailsStop(s)}>
                          Ouvrir la fiche
                        </button>
                        <button
                          type="button"
                          className="rounded-full border border-navy/15 px-3 py-1.5 text-xs font-semibold text-navy/80 hover:border-teal"
                          onClick={() => setCloture({ stop: s, mode: "choix" })}
                          aria-label={`Clôturer ${s.recipient ?? s.address}`}
                        >
                          Clôturer ›
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
                      <a href={lienTel(s.phone)} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-teal/15 text-teal-ink" aria-label={`Appeler ${s.recipient ?? s.address} (${s.phone})`}>
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
                    {run.status !== "done" && (
                      <button type="button" className="btn-ghost !px-2 !py-1 text-xs" onClick={() => statut(s, "pending")}>
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
