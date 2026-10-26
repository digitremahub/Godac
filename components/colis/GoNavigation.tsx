"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent as KeyboardEventReact, type PointerEvent as PointerEventReact } from "react";
import "maplibre-gl/dist/maplibre-gl.css";
import type { GeoJSONSource, Map as CarteMap, Marker, StyleSpecification } from "maplibre-gl";
import { IconCheck, IconMapPin, IconMessage, IconNavigation, IconPhone, IconPointRelais, IconRamasse, IconX } from "@/components/layout/icons";
import { BadgeArret, ChoixTypeArret, EncocheArret, bordureArret } from "@/components/colis/Ramasse";
import { BadgeHorsTournee, BadgeSansTelephone } from "@/components/colis/AlertesArret";
import { BadgeHoraires, type useHoraires } from "@/components/colis/HorairesSheet";
import { ArretTriable, BoutonPoignee, ZoneTri, type Poignee } from "@/components/colis/Triable";
import { AdresseInput } from "@/components/colis/AdresseInput";
import { EtapeCreneau, useHorairesOuverture } from "@/components/colis/EtapeCreneau";
import { CRENEAU_AUCUN, validerChoix, type ChoixCreneau } from "@/lib/colis/creneau";
import { dateParis } from "@/lib/colis/heure-paris";
import { pastille, marqueurVehicule, etatVehicule } from "@/components/colis/marqueurs";
import { api, gmaps, waze, SMS_ARRIVEE, type Liste, type Run, type Stop, type Toast } from "@/components/colis/commun";
import { PastillesContact } from "@/components/colis/ContactsArret";
import { InterrupteurMode } from "@/components/colis/InterrupteurMode";
import { libelleLivre } from "@/lib/colis/mode-simple";
import type { ChampContact } from "@/lib/colis/contacts";
import { attacherAppuiLong, gestesAppuiLong } from "@/lib/colis/appui-long";
import { DELAI_ANNULATION_MS } from "@/lib/colis/retrait";
import { patchArret } from "@/lib/colis/envoi-arret";
import { lienSms, lienTel } from "@/lib/colis/telephone";
import { formatPoids } from "@/lib/colis/poids";
import { estPointRelais, estRamasse, type TypeArret } from "@/lib/colis/livraison";
import { RESEAUX_RELAIS } from "@/lib/colis/relais";
import { heureFin, type Avancement } from "@/lib/colis/estimation";
import { nomGroupe, grouperParListe } from "@/lib/colis/listes";
import type { Itineraire, Point } from "@/lib/colis/itineraire";
import type { CibleDepot } from "@/lib/colis/reordonner";
import type { SuggestionAdresse } from "@/lib/colis/recherche-adresses";
import { enqueueOfflineMutation, isNetworkFailure } from "@/lib/offline/outbox";
import { networkErrorMessage } from "@/lib/utils/network-error";
import { COULEURS_CARTE, styliserGodac, type StyleCarte } from "@/lib/colis/style-carte";
import {
  ECART_MAX_M,
  RAYON_ARRIVEE_M,
  arretApresCloture,
  arretSuivi,
  distanceM,
  doitRecalculer,
  formatDistance,
  longueursCumulees,
  meilleureInsertion,
  projeterSurTrace,
  resteSurTrace,
} from "@/lib/colis/navigation";
import {
  DEPLACEMENT_CAP_M,
  PITCH_CONDUITE,
  choisirCap,
  dureeAnimation,
  interpoler,
  lisserCap,
  lisserZoom,
  margesConduite,
  vitesseEstimee,
  zoomSelonVitesse,
  type EtatCamera,
} from "@/lib/colis/conduite";
import { enDepassement, kmhDepuisMs } from "@/lib/colis/limitation-vitesse";
import { bandeauDeplie, elementsConduite, enMouvementApres } from "@/lib/colis/epure-conduite";
import { arretAAfficher, correspondA, termeRecherche } from "@/lib/colis/recherche-arret";
import { CLE_FEUILLE, FEUILLE_PAR_DEFAUT, adresseCourte, decouperTrace, lirePositionFeuille, positionApresGeste, repeteAdresse, type PositionFeuille } from "@/lib/colis/feuille";
import { etaArret, type EtaArret } from "@/lib/colis/eta";
import { formatDistanceManoeuvre, manoeuvreCourante, palierAnnonce, phraseAnnonce, pictogramme, placerManoeuvres, texteManoeuvre, type Palier, type Pictogramme } from "@/lib/colis/manoeuvres";

/** Fond vectoriel gratuit et sans clé déjà utilisé par l'app (OpenStreetMap via OpenFreeMap), recoloré aux couleurs GODAC. */
const STYLE = process.env.NEXT_PUBLIC_MAP_STYLE ?? "https://tiles.openfreemap.org/styles/liberty";
/** Envoi de la position à l'écran chauffeur (heures estimées) : au plus toutes les 30 s. */
const REMONTEE_POSITION_MS = 30_000;
const ligneGeo = (coordinates: [number, number][]) => ({ type: "Feature" as const, properties: {}, geometry: { type: "LineString" as const, coordinates } });
const VIDE = ligneGeo([]);
const SANS_MARGE = { top: 0, bottom: 0, left: 0, right: 0 };
/** Guidage vocal activé (mémorisé sur le téléphone). */
const CLE_VOIX = "godac.go-navigation.voix";

/**
 * Vue de la carte : « conduite » (3D, orientée dans le sens de la marche,
 * suit la voiture), « ensemble » (vue de dessus, nord en haut) ou « libre »
 * (le chauffeur a déplacé la carte : bouton « Recentrer »).
 */
type Vue = "conduite" | "ensemble" | "libre";

/** Annonce vocale (voix française du navigateur) ; sans effet si indisponible. */
function parler(texte: string) {
  try {
    const synthese = typeof window !== "undefined" ? window.speechSynthesis : undefined;
    if (!synthese || typeof SpeechSynthesisUtterance === "undefined") return;
    const u = new SpeechSynthesisUtterance(texte);
    u.lang = "fr-FR";
    const voixFr = synthese.getVoices().find((v) => v.lang?.toLowerCase().startsWith("fr"));
    if (voixFr) u.voice = voixFr;
    synthese.speak(u);
  } catch {
    /* synthèse vocale indisponible */
  }
}

type Horaires = ReturnType<typeof useHoraires>;
type Placement = "meilleur" | "optimiser" | "fin";

export interface GoNavigationProps {
  run: Run;
  stops: Stop[];
  lists: Liste[];
  horaires: Horaires;
  avancement: Avancement;
  busy: boolean;
  /** Retour à la liste des arrêts de l'app chauffeur. */
  onFermer: () => void;
  onRecharger: () => Promise<void>;
  onToast: (t: Toast) => void;
  /** Mode simple : « Livré » / « Non livré » seulement (ni lieu, ni preuve, ni quantités). */
  modeSimple: boolean;
  /** Interrupteur du menu : bascule en cours de tournée, effet immédiat. */
  onModeSimple: (vers: boolean) => void;
  /** « Message envoyé » / « Eu au téléphone » : une coche en 1 clic. */
  onContact: (s: Stop, champ: ChampContact, valeur: boolean) => void;
  /** Retire l'adresse sans confirmation ; le message « Annuler » est affiché par l'écran chauffeur. */
  onRetirer: (s: Stop) => void;
  /** Appel lancé depuis un bouton « Appeler » (propose « Eu au téléphone » au retour). */
  onAppel: (s: Stop) => void;
  /** Livré / ramassé / déposé au relais (feuille de livraison, saisie des quantités de ramasse). */
  onTerminer: (s: Stop) => void;
  /** Clôture : choix (fait / échec) ou directement les motifs d'échec. */
  onCloture: (s: Stop, mode: "choix" | "echec") => void;
  onTelephone: (s: Stop) => void;
  onHoraires: (s: Stop) => void;
  onFiche: (s: Stop) => void;
  onPasser: (s: Stop) => void;
  onDeposer: (id: string, cible: CibleDepot) => Promise<void>;
  onReoptimiser: () => Promise<void>;
  /** Optimise les arrêts restants en partant de l'arrêt choisi (il devient le prochain). */
  onOptimiserDepuisArret?: (stopId: string) => Promise<void>;
  /** Ouvre la feuille « Départ / arrivée » de l'optimisation. */
  onReglagesOptimisation?: () => void;
  /** Fin de tournée : retour guidé dans GO vers le dépôt ou le siège (arrêts tous traités). */
  retour?: { label: string; lat: number; lng: number; etape?: "gasoil" } | null;
  /** Après le passage au gasoil : repartir vers le dépôt / le siège. */
  onRetourSuivant?: () => void;
  /** Suite complète de la tournée (heure de fin estimée de l'app chauffeur). */
  onItineraire: (it: Itineraire | null) => void;
  /** Position GPS remontée toutes les 30 s, avec sa précision en mètres (sert aussi au pointage de présence au dépôt). */
  onPosition: (p: Point, precision?: number) => void;
  /** Trajet en cours d'enregistrement pour l'historique (indicateur discret, RGPD). */
  traceActive?: boolean;
}

/**
 * GO Navigation : carte plein écran aux couleurs GODAC, trajet routier vers
 * l'arrêt suivi (tracé teal, recalculé quand le chauffeur s'en écarte ou
 * change d'arrêt), position suivie en direct, et en bas la feuille de la
 * tournée : carte de l'arrêt en cours, arrêts suivants en cartes à faire
 * glisser, liste complète (réordonnable) quand on tire la feuille vers le
 * haut. Toutes les actions (appel, livraison, échec, ramasse, point relais,
 * horaires, ajout d'une adresse oubliée) se font sans quitter l'écran ; les
 * feuilles de clôture sont celles de l'app chauffeur (AppLivreur).
 */
export function GoNavigation(p: GoNavigationProps) {
  const { run, stops, lists, horaires, avancement } = p;
  const fige = run.status === "done";
  const [selection, setSelection] = useState<string | null>(null);
  const [feuille, setFeuilleBrute] = useState<PositionFeuille>(FEUILLE_PAR_DEFAUT);
  /** Dernière position réduite / moyenne choisie (la liste pleine n'est qu'un passage). */
  const feuilleMemo = useRef<PositionFeuille>(FEUILLE_PAR_DEFAUT);
  /** Menu « Options » : ajout d'adresse, optimisation (ma position / une adresse / départ et arrivée), vues, mode simple. */
  const [menuVues, setMenuVues] = useState(false);
  /** Sélecteur d'adresse de « Optimiser depuis une adresse choisie ». */
  const [choixDepuis, setChoixDepuis] = useState(false);
  const [position, setPosition] = useState<Point | null>(null);
  /** Vitesse réelle (km/h, GPS) et limitation indicative de la route (OpenStreetMap). */
  const [vitesseKmh, setVitesseKmh] = useState<number | null>(null);
  const [limiteKmh, setLimiteKmh] = useState<number | null>(null);
  /** En mouvement (> 5 km/h) : l'écran ne garde que ce qui sert à conduire (lib/colis/epure-conduite.ts). */
  const [mouvement, setMouvement] = useState(false);
  const derniereLimite = useRef<{ pos: Point; t: number } | null>(null);
  const [erreurGps, setErreurGps] = useState<string | null>(null);
  const [vue, setVue] = useState<Vue>("ensemble");
  const [voix, setVoix] = useState(false);
  const [trajet, setTrajet] = useState<Itineraire | null>(null);
  const [ajout, setAjout] = useState(false);
  /** Menu rapide d'un arrêt (appui long sur une ligne ou un repère de la carte). */
  const [menuArret, setMenuArret] = useState<Stop | null>(null);
  /** Arrêt dont l'adresse est en cours de correction (erreur de saisie à la base). */
  const [correction, setCorrection] = useState<Stop | null>(null);
  const [recherche, setRecherche] = useState("");
  /** Toucher du bandeau de guidage : détails dépliés ou repliés (null : automatique, dépliés à l'arrêt). */
  const [choixBandeau, setChoixBandeau] = useState<boolean | null>(null);

  const restants = useMemo(() => stops.filter((s) => s.status === "pending"), [stops]);
  const cibleArret = arretSuivi(stops, selection);
  // Tous les arrêts sont traités et le chauffeur a lancé le retour : destination guidée comme un arrêt (sans bouton « Terminé »).
  const enRetour = !cibleArret && Boolean(p.retour);
  const cible: Stop | null = cibleArret ?? (p.retour ? ({ id: ID_RETOUR, position: 0, parcel_code: null, parcel_count: 0, address: p.retour.label, lat: p.retour.lat, lng: p.retour.lng, recipient: null, phone: null, notes: null, status: "pending", delivered_place: null, proof_photo_path: null } as Stop) : null);
  // Arrêt suivi clôturé (livré, échec) : on passe tout seul au suivant dans l'ordre.
  useEffect(() => {
    if (!selection) return;
    const s = stops.find((x) => x.id === selection);
    if (s && s.status !== "pending") setSelection(arretApresCloture(stops, selection)?.id ?? null);
  }, [stops, selection]);
  const numero = (s: Stop) => stops.indexOf(s) + 1;

  // ——— Carte ———
  const conteneur = useRef<HTMLDivElement>(null);
  const carte = useRef<CarteMap | null>(null);
  const lib = useRef<typeof import("maplibre-gl") | null>(null);
  const marqueurs = useRef<Marker[]>([]);
  const moi = useRef<Marker | null>(null);
  const [prete, setPrete] = useState(false);
  /** Horloge de l'heure d'arrivée : avance même à l'arrêt (sans nouveau point GPS). */
  const [maintenant, setMaintenant] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setMaintenant(Date.now()), 20_000);
    return () => clearInterval(t);
  }, []);
  const vueRef = useRef(vue);
  vueRef.current = vue;
  const feuilleRef = useRef<HTMLDivElement>(null);
  const bandeauRef = useRef<HTMLDivElement>(null);
  const boussoleRef = useRef<HTMLSpanElement>(null);
  const trajetRef = useRef<Itineraire | null>(null);

  // Mouvements réduits (réglage du téléphone) : transitions courtes.
  const reduit = useRef(false);
  useEffect(() => {
    try {
      const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
      reduit.current = mq.matches;
      const maj = () => (reduit.current = mq.matches);
      mq.addEventListener?.("change", maj);
      return () => mq.removeEventListener?.("change", maj);
    } catch {
      return undefined;
    }
  }, []);
  const duree = (ms: number) => (reduit.current ? Math.min(ms, 150) : ms);

  useEffect(() => {
    let annule = false;
    (async () => {
      const maplibregl = await import("maplibre-gl");
      // Style recoloré aux couleurs GODAC ; à défaut (réseau), style d'origine.
      let style: StyleSpecification | string = STYLE;
      try {
        const res = await fetch(STYLE, { signal: AbortSignal.timeout(6000) });
        if (res.ok) style = styliserGodac((await res.json()) as StyleCarte) as unknown as StyleSpecification;
      } catch {
        /* style d'origine */
      }
      if (annule || !conteneur.current) return;
      lib.current = maplibregl;
      const depart = stops.find((s) => s.status === "pending" && s.lat !== null) ?? stops.find((s) => s.lat !== null);
      const centre = depart ? { lat: Number(depart.lat), lng: Number(depart.lng) } : run.start_lat !== null ? { lat: Number(run.start_lat), lng: Number(run.start_lng) } : { lat: 46.6, lng: 2.4 };
      const m = new maplibregl.Map({
        container: conteneur.current,
        style,
        center: [centre.lng, centre.lat],
        zoom: depart ? 14 : 5,
        attributionControl: { compact: true },
        pitchWithRotate: false,
        maxPitch: 60,
      });
      m.on("load", () => {
        m.addSource("suite", { type: "geojson", data: VIDE });
        m.addSource("trajet", { type: "geojson", data: VIDE });
        m.addSource("parcouru", { type: "geojson", data: VIDE });
        const rond = { "line-cap": "round", "line-join": "round" } as const;
        // Suite de la tournée : pointillés gris-orange clair, discrets.
        m.addLayer({ id: "suite", type: "line", source: "suite", paint: { "line-color": COULEURS_CARTE.suiteTournee, "line-width": 3, "line-opacity": 0.7, "line-dasharray": [1.5, 1.5] }, layout: rond });
        // Déjà parcouru (du début du tracé jusqu'au véhicule) : orange clair, semi-transparent.
        m.addLayer({ id: "parcouru", type: "line", source: "parcouru", paint: { "line-color": COULEURS_CARTE.orangeParcouru, "line-width": 7, "line-opacity": 0.55 }, layout: rond });
        // Reste à parcourir : orange foncé GODAC sur un liseré marine (contraste sur le papier et les routes blanches).
        m.addLayer({ id: "trajet-bord", type: "line", source: "trajet", paint: { "line-color": COULEURS_CARTE.marine, "line-width": 11, "line-opacity": 0.85 }, layout: rond });
        m.addLayer({ id: "trajet", type: "line", source: "trajet", paint: { "line-color": COULEURS_CARTE.orangeEncre, "line-width": 7 }, layout: rond });
        setPrete(true);
      });
      // Le chauffeur déplace, zoome ou tourne la carte : on arrête de le
      // suivre (bouton « Recentrer », comme Waze). Les mouvements de la
      // caméra lancés par le code n'ont pas d'événement d'origine.
      const quitterSuivi = (e: { originalEvent?: unknown }) => {
        if (!e.originalEvent || vueRef.current !== "conduite") return;
        vueRef.current = "libre";
        setVue("libre");
      };
      // Zoom, rotation et inclinaison à deux doigts : on reste en vue conduite, la caméra
      // suit toujours la voiture avec l'orientation / l'inclinaison / le zoom choisis.
      const debutGeste = (e: { originalEvent?: unknown }) => {
        if (e.originalEvent && vueRef.current === "conduite") gestePerso.current = true;
      };
      const poser = () => (doigtCarte.current = true);
      const lever = () => (doigtCarte.current = false);
      m.on("touchstart", poser);
      m.on("mousedown", poser);
      window.addEventListener("touchend", lever, { passive: true });
      window.addEventListener("touchcancel", lever, { passive: true });
      window.addEventListener("mouseup", lever);
      leverCarte.current = lever;
      m.on("dragstart", quitterSuivi);
      m.on("zoomstart", debutGeste);
      m.on("rotatestart", debutGeste);
      m.on("pitchstart", debutGeste);
      m.on("moveend", () => {
        if (!gestePerso.current) return;
        gestePerso.current = false;
        const e = affiche.current;
        if (!e || vueRef.current !== "conduite") return;
        let dc = m.getBearing() - e.cap;
        dc = ((((dc + 180) % 360) + 360) % 360) - 180;
        persoCamera.current = { cap: dc, pitch: Math.max(0, Math.min(60, m.getPitch())), zoom: e.zoom === null ? 0 : m.getZoom() - e.zoom };
      });
      // Boussole : le « N » pointe vers le nord de la carte.
      m.on("rotate", () => {
        if (boussoleRef.current) boussoleRef.current.style.transform = `rotate(${-m.getBearing()}deg)`;
      });
      carte.current = m;
    })();
    return () => {
      annule = true;
      if (leverCarte.current) {
        window.removeEventListener("touchend", leverCarte.current);
        window.removeEventListener("touchcancel", leverCarte.current);
        window.removeEventListener("mouseup", leverCarte.current);
      }
      cancelAnimationFrame(raf.current);
      raf.current = 0;
      carte.current?.remove();
      carte.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Hauteur de la feuille : marges de la carte (le chauffeur reste visible au-dessus) et place de l'attribution.
  const [hauteur, setHauteur] = useState(300);
  useEffect(() => {
    const el = feuilleRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => setHauteur(el.offsetHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  // Hauteur du bandeau de guidage (replié / déplié) : les marges de la caméra la suivent.
  const [hauteurBandeau, setHauteurBandeau] = useState(0);
  useEffect(() => {
    const el = bandeauRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => setHauteurBandeau(Math.round(el.offsetHeight)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const hauteurRef = useRef(hauteur);
  hauteurRef.current = hauteur;
  const hauteurFeuille = () => Math.min(hauteurRef.current, (typeof window !== "undefined" ? window.innerHeight : 800) * 0.6);
  const marges = () => ({ top: 150, bottom: hauteurFeuille() + 20, left: 40, right: 40 });
  /** Marges de la vue conduite : voiture dans le bas de la zone visible, au-dessus de la feuille. */
  const margesC = () => margesConduite(typeof window !== "undefined" ? window.innerHeight : 800, hauteurFeuille(), bandeauRef.current?.getBoundingClientRect().bottom ?? 150);

  // ——— Caméra : la voiture « avance » entre deux points GPS ———
  const affiche = useRef<EtatCamera | null>(null);
  const anim = useRef<{ de: EtatCamera; vers: EtatCamera; debut: number; duree: number } | null>(null);
  const raf = useRef(0);
  /** Pendant une transition (easeTo), la boucle d'animation ne bouge pas la caméra. */
  const transitionJusqua = useRef(0);
  /** Marges de la vue conduite, recalculées à chaque point GPS (pas à chaque image). */
  const margesCache = useRef<ReturnType<typeof margesConduite> | null>(null);

  /** Rotation / inclinaison / zoom choisis à la main en vue conduite (relatifs au cap et au zoom automatiques) : remis à zéro au recentrage. */
  const persoCamera = useRef<{ cap: number; pitch: number | null; zoom: number }>({ cap: 0, pitch: null, zoom: 0 });
  const gestePerso = useRef(false);
  /** Doigt (ou souris) posé sur la carte : la caméra de suivi ne bouge pas pendant le geste. */
  const doigtCarte = useRef(false);
  const leverCarte = useRef<(() => void) | null>(null);

  function dessiner(e: EtatCamera) {
    moi.current?.setLngLat([e.lng, e.lat]).setRotation(e.cap);
    const m = carte.current;
    if (m && vueRef.current === "conduite" && !gestePerso.current && !doigtCarte.current && performance.now() > transitionJusqua.current) {
      const c = persoCamera.current;
      m.jumpTo({ center: [e.lng, e.lat], bearing: e.cap + c.cap, zoom: e.zoom === null ? undefined : e.zoom + c.zoom, pitch: c.pitch ?? PITCH_CONDUITE, padding: (margesCache.current ??= margesC()) });
    }
  }
  function boucle(t: number) {
    const a = anim.current;
    if (!a) {
      raf.current = 0;
      return;
    }
    const k = a.duree > 0 ? (t - a.debut) / a.duree : 1;
    const e = interpoler(a.de, a.vers, k);
    affiche.current = e;
    dessiner(e);
    if (k < 1) raf.current = requestAnimationFrame(boucle);
    else {
      anim.current = null;
      raf.current = 0;
    }
  }

  /** Vue conduite : 3D, orientée selon le cap, qui suit la voiture. */
  function passerEnConduite() {
    const m = carte.current;
    const e = affiche.current;
    if (!m || !e) return;
    clearTimeout(ajustement.current);
    vueRef.current = "conduite";
    setVue("conduite");
    persoCamera.current = { cap: 0, pitch: null, zoom: 0 };
    const d = duree(800);
    transitionJusqua.current = performance.now() + d + 50;
    m.easeTo({ center: [e.lng, e.lat], bearing: e.cap, zoom: e.zoom, pitch: PITCH_CONDUITE, padding: margesC(), duration: d });
  }

  /** Vue d'ensemble : vue de dessus, nord en haut, les points donnés visibles. */
  const ajustement = useRef<ReturnType<typeof setTimeout>>();
  function vueEnsemble(pts: [number, number][], maxZoom = 16, nouvelleVue: Vue = "ensemble") {
    const m = carte.current;
    const maplibregl = lib.current;
    if (!m || !maplibregl) return;
    vueRef.current = nouvelleVue;
    setVue(nouvelleVue);
    const d = duree(450);
    // D'abord à plat, nord en haut et sans les marges de la vue conduite, puis cadrage.
    m.easeTo({ pitch: 0, bearing: 0, padding: SANS_MARGE, duration: d });
    clearTimeout(ajustement.current);
    if (!pts.length) return;
    ajustement.current = setTimeout(() => {
      if (vueRef.current === "conduite") return;
      const b = pts.reduce((bb, x) => bb.extend(x), new maplibregl.LngLatBounds(pts[0]!, pts[0]!));
      m.fitBounds(b, { padding: marges(), maxZoom, duration: d, bearing: 0, pitch: 0, linear: true });
    }, d + 30);
  }
  useEffect(() => () => clearTimeout(ajustement.current), []);

  // Arrêts numérotés (et dépôt), mêmes codes couleur que les cartes d'arrêt.
  useEffect(() => {
    const m = carte.current;
    const maplibregl = lib.current;
    if (!m || !maplibregl || !prete) return;
    marqueurs.current.forEach((mk) => mk.remove());
    marqueurs.current = [];
    if (run.start_lat !== null && run.start_lng !== null) {
      const d = document.createElement("div");
      d.textContent = "D";
      d.title = run.start_label ?? "Dépôt";
      Object.assign(d.style, { width: "24px", height: "24px", borderRadius: "6px", background: "#FFFFFF", color: COULEURS_CARTE.marine, border: `2px solid ${COULEURS_CARTE.marine}`, font: "700 11px system-ui", display: "grid", placeItems: "center" });
      marqueurs.current.push(new maplibregl.Marker({ element: d }).setLngLat([Number(run.start_lng), Number(run.start_lat)]).addTo(m));
    }
    stops.forEach((s, i) => {
      if (s.lat === null || s.lng === null) return;
      const el = pastille(String(i + 1), s.status, s.id === cible?.id, estRamasse(s), estPointRelais(s));
      if (s.status !== "pending") el.style.opacity = "0.55";
      el.setAttribute("aria-label", `${estRamasse(s) ? "Ramasse" : estPointRelais(s) ? "Point relais" : "Arrêt"} ${i + 1} — ${s.address}`);
      if (s.status === "pending") attacherAppuiLong(el, () => setMenuArret(s));
      el.addEventListener("click", (e) => {
        e.stopPropagation();
        if (s.status === "pending") {
          setSelection(s.id);
          setFeuilleBrute((f) => (f === "pleine" ? feuilleMemo.current : f));
        }
      });
      marqueurs.current.push(new maplibregl.Marker({ element: el }).setLngLat([Number(s.lng), Number(s.lat)]).addTo(m));
    });
  }, [prete, stops, cible?.id, run.start_lat, run.start_lng, run.start_label]);

  // Limitation de vitesse : relue après 100 m ou 30 s, jamais en rafale.
  useEffect(() => {
    if (!position) return;
    const d = derniereLimite.current;
    if (d && distanceM(d.pos, position) < 100 && Date.now() - d.t < 30_000) return;
    derniereLimite.current = { pos: position, t: Date.now() };
    let annule = false;
    api<{ limite: number | null }>(`/api/colis/limitation?lat=${position.lat}&lng=${position.lng}`)
      .then((r) => !annule && setLimiteKmh(r.limite))
      .catch(() => undefined);
    return () => {
      annule = true;
    };
  }, [position]);

  // Position en direct (navigator.geolocation.watchPosition).
  const derniereRemontee = useRef(0);
  const dernierFix = useRef<(Point & { t: number }) | null>(null);
  const dernierPoint = useRef<number | null>(null);
  const capLisse = useRef<number | null>(null);
  const zoomLisse = useRef<number | null>(null);
  const capConnu = useRef(false);
  /** La vue conduite s'active d'elle-même au premier point GPS (sauf choix du chauffeur). */
  const conduiteAuto = useRef(false);
  const onPosition = p.onPosition;
  useEffect(() => {
    if (!navigator.geolocation) {
      setErreurGps("Ce téléphone ne donne pas sa position : le trajet part du dépôt.");
      return;
    }
    const id = navigator.geolocation.watchPosition(
      (g) => {
        setErreurGps(null);
        const pos = { lat: g.coords.latitude, lng: g.coords.longitude };
        const t = Date.now();
        const prec = dernierFix.current;
        // Cap : GPS en mouvement, sinon entre les deux dernières positions, sinon sens du tracé ; lissé.
        const vitesse = vitesseEstimee(g.coords.speed, prec, { ...pos, t });
        const mesure = choisirCap({ capGps: g.coords.heading, vitesse, precedente: prec, actuelle: pos, ligne: trajetRef.current?.ligne ?? null });
        if (!prec || distanceM(prec, pos) >= DEPLACEMENT_CAP_M) dernierFix.current = { ...pos, t };
        if (mesure !== null) {
          capLisse.current = lisserCap(capLisse.current, mesure, 0.5);
          capConnu.current = true;
        }
        setVitesseKmh(kmhDepuisMs(vitesse));
        setMouvement((avant) => enMouvementApres(avant, kmhDepuisMs(vitesse)));
        zoomLisse.current = lisserZoom(zoomLisse.current, zoomSelonVitesse(vitesse));
        const vers: EtatCamera = { lng: pos.lng, lat: pos.lat, cap: capLisse.current ?? 0, zoom: zoomLisse.current };
        const intervalle = dernierPoint.current === null ? null : t - dernierPoint.current;
        dernierPoint.current = t;
        setPosition(pos);
        const m = carte.current;
        const maplibregl = lib.current;
        if (m && maplibregl) {
          if (!moi.current) {
            moi.current = new maplibregl.Marker({ element: marqueurVehicule(), rotationAlignment: "map", pitchAlignment: "map" }).setLngLat([pos.lng, pos.lat]).addTo(m);
          }
          etatVehicule(moi.current.getElement(), capConnu.current);
          margesCache.current = margesC();
          // Animation linéaire de la position affichée vers le nouveau point, sur la durée de l'intervalle GPS.
          const de = affiche.current;
          if (!de) {
            affiche.current = vers;
            dessiner(vers);
          } else {
            anim.current = { de: { ...de }, vers, debut: performance.now(), duree: dureeAnimation(intervalle, reduit.current) };
            if (!raf.current) raf.current = requestAnimationFrame(boucle);
          }
          if (!conduiteAuto.current) {
            conduiteAuto.current = true;
            if (vueRef.current === "ensemble") passerEnConduite();
          }
        }
        const maintenant = Date.now();
        if (maintenant - derniereRemontee.current > REMONTEE_POSITION_MS) {
          derniereRemontee.current = maintenant;
          onPosition(pos, g.coords.accuracy);
        }
      },
      (e) => setErreurGps(e.code === e.PERMISSION_DENIED ? "Localisation refusée : autorisez-la pour suivre le trajet. En attendant, le trajet part du dépôt." : "Position GPS indisponible pour le moment."),
      { enableHighAccuracy: true, maximumAge: 3000, timeout: 20000 },
    );
    return () => navigator.geolocation.clearWatch(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ——— Trajet vers l'arrêt suivi : calcul, suivi, recalcul ———
  const cibleTracee = useRef<string | null>(null);
  const traceDepuisGps = useRef(false);
  const dernierCalcul = useRef(0);
  const enCalcul = useRef(false);
  const stopsRef = useRef(stops);
  stopsRef.current = stops;
  const tracer = useCallback(
    async (versId: string, depuis: Point | null) => {
      if (enCalcul.current) return;
      enCalcul.current = true;
      dernierCalcul.current = Date.now();
      cibleTracee.current = versId;
      traceDepuisGps.current = Boolean(depuis);
      try {
        const it = await api<Itineraire>("/api/colis/itineraire", { method: "POST", body: JSON.stringify(versId === ID_RETOUR && p.retour ? { run_id: run.id, depuis, cible: ID_RETOUR, point: { lat: p.retour.lat, lng: p.retour.lng } } : (() => {
          const a = stopsRef.current.find((x) => x.id === versId);
          return { run_id: run.id, depuis, cible: versId, ...(depuis && a && a.lat !== null && a.lng !== null ? { point: { lat: Number(a.lat), lng: Number(a.lng) } } : {}) };
        })()) });
        if (cibleTracee.current !== versId) return;
        setTrajet(it);
        (carte.current?.getSource("trajet") as GeoJSONSource | undefined)?.setData(ligneGeo(it.ligne));
      } catch {
        // Réseau coupé : ligne droite vers l'arrêt, la navigation externe reste possible.
        setTrajet(null);
      } finally {
        enCalcul.current = false;
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [run.id, p.retour?.lat, p.retour?.lng],
  );

  useEffect(() => {
    if (!prete) return;
    if (!cible) {
      cibleTracee.current = null;
      setTrajet(null);
      (carte.current?.getSource("trajet") as GeoJSONSource | undefined)?.setData(VIDE);
      (carte.current?.getSource("parcouru") as GeoJSONSource | undefined)?.setData(VIDE);
      return;
    }
    const maintenant = Date.now();
    // Tracé en échec ou vide pour cet arrêt : ligne vide, nouvel essai au plus toutes les 20 s (pas de boucle).
    const ligne = cibleTracee.current === cible.id ? (trajet?.ligne ?? []) : null;
    const recalcul =
      doitRecalculer({ cible: cible.id, cibleTracee: cibleTracee.current, ligne, position, dernierCalcul: dernierCalcul.current, maintenant }) ||
      // Premier point GPS reçu après un tracé depuis le dépôt.
      (Boolean(position) && !traceDepuisGps.current && maintenant - dernierCalcul.current > 3000);
    if (recalcul) void tracer(cible.id, position);
  }, [prete, cible, position, trajet, tracer]);

  trajetRef.current = trajet;

  // Arrêt suivi qui change (clôture, carte glissée) : on le montre avec le chauffeur (hors vue conduite).
  const derniereCible = useRef<string | null>(null);
  useEffect(() => {
    if (!prete || !cible || cible.id === derniereCible.current) return;
    derniereCible.current = cible.id;
    const m = carte.current;
    const maplibregl = lib.current;
    if (!m || !maplibregl || cible.lat === null || cible.lng === null || vueRef.current === "conduite") return;
    const pts: [number, number][] = [[Number(cible.lng), Number(cible.lat)]];
    if (position) pts.push([position.lng, position.lat]);
    vueEnsemble(pts, 16, vueRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prete, cible?.id]);

  // Suite de la tournée (tous les arrêts restants) : pointillés et heure de fin.
  const cleSuite = restants.map((s) => s.id).join(",");
  const aPosition = Boolean(position);
  const onItineraire = p.onItineraire;
  const positionRef = useRef(position);
  positionRef.current = position;
  useEffect(() => {
    if (!prete) return;
    let annule = false;
    api<Itineraire>("/api/colis/itineraire", { method: "POST", body: JSON.stringify({ run_id: run.id, depuis: positionRef.current }) })
      .then((it) => {
        if (annule) return;
        (carte.current?.getSource("suite") as GeoJSONSource | undefined)?.setData(ligneGeo(it.ligne));
        onItineraire(it);
      })
      .catch(() => !annule && onItineraire(null));
    return () => {
      annule = true;
    };
  }, [prete, cleSuite, aPosition, run.id, onItineraire]);

  function recentrer() {
    conduiteAuto.current = true;
    passerEnConduite();
  }
  function toutVoir() {
    conduiteAuto.current = true;
    const pts: [number, number][] = restants.filter((s) => s.lat !== null).map((s) => [Number(s.lng), Number(s.lat)]);
    if (position) pts.push([position.lng, position.lat]);
    vueEnsemble(pts, 15);
  }
  /** Vue d'ensemble du trajet vers l'arrêt suivi (ou de la position et de l'arrêt). */
  function voirTrajet() {
    conduiteAuto.current = true;
    const pts: [number, number][] = trajet && cible && cibleTracee.current === cible.id ? [...trajet.ligne] : [];
    if (cible && cible.lat !== null && cible.lng !== null) pts.push([Number(cible.lng), Number(cible.lat)]);
    if (position) pts.push([position.lng, position.lat]);
    vueEnsemble(pts, 16);
  }

  // La feuille change de hauteur en vue conduite : la voiture reste au-dessus.
  useEffect(() => {
    const m = carte.current;
    const e = affiche.current;
    if (!m || !e || vueRef.current !== "conduite") return;
    const d = duree(300);
    transitionJusqua.current = performance.now() + d + 30;
    margesCache.current = margesC();
    m.easeTo({ center: [e.lng, e.lat], padding: margesCache.current, duration: d });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hauteur, hauteurBandeau]);

  // Taille de la carte quand la feuille change de hauteur.
  useEffect(() => {
    const t = setTimeout(() => carte.current?.resize(), 250);
    return () => clearTimeout(t);
  }, [feuille]);

  // ——— Guidage ———
  const resteM = cible && position && trajet && cibleTracee.current === cible.id ? resteSurTrace(position, trajet.ligne) : null;
  const directM = cible && position && cible.lat !== null && cible.lng !== null ? distanceM(position, { lat: Number(cible.lat), lng: Number(cible.lng) }) : null;
  const distanceAffichee = resteM ?? (trajet && cibleTracee.current === cible?.id ? trajet.distanceKm * 1000 : directM);
  const dureeAffichee =
    trajet && trajet.dureeMin !== null && trajet.distanceKm > 0 && distanceAffichee !== null ? (trajet.dureeMin * distanceAffichee) / (trajet.distanceKm * 1000) : null;
  const arrive = directM !== null && directM < RAYON_ARRIVEE_M;
  // Heure d'arrivée au prochain arrêt : depuis la position GPS et la durée OSRM déjà reçue (pas d'appel en plus).
  const eta = cible && position && !arrive && !fige ? etaArret({ maintenant, distanceM: distanceAffichee, dureeMin: dureeAffichee, approx: trajet?.approx }) : null;

  // ——— Indications de direction (manœuvres OSRM) ———
  const trajetValide = trajet && cible && cibleTracee.current === cible.id ? trajet : null;
  const placees = useMemo(() => (trajetValide?.manoeuvres?.length && trajetValide.ligne.length > 1 ? placerManoeuvres(trajetValide.ligne, trajetValide.manoeuvres) : []), [trajetValide]);
  const projection = placees.length && position && trajetValide ? projeterSurTrace(position, trajetValide.ligne) : null;
  // Hors du tracé (en attendant le recalcul) : pas d'indication trompeuse.
  const courante = projection && projection.ecartM <= ECART_MAX_M * 1.5 ? manoeuvreCourante(placees, projection.abscisseM) : null;
  const manoeuvre = courante ? placees[courante.index]! : null;
  const suivante = courante ? (placees[courante.index + 1] ?? null) : null;

  // Itinéraire découpé à la position du véhicule : parcouru en orange clair, reste en orange foncé.
  const cumulTrajet = useMemo(() => (trajetValide && trajetValide.ligne.length > 1 ? longueursCumulees(trajetValide.ligne) : null), [trajetValide]);
  useEffect(() => {
    const m = carte.current;
    if (!m || !prete) return;
    const source = (id: string) => m.getSource(id) as GeoJSONSource | undefined;
    if (!trajetValide || !cumulTrajet) {
      source("parcouru")?.setData(VIDE);
      return;
    }
    const { parcouru, restant } = decouperTrace(trajetValide.ligne, position, cumulTrajet);
    source("trajet")?.setData(ligneGeo(restant));
    source("parcouru")?.setData(ligneGeo(parcouru));
  }, [prete, trajetValide, cumulTrajet, position]);

  // ——— Guidage vocal (désactivé par défaut, mémorisé) ———
  useEffect(() => {
    try {
      setVoix(localStorage.getItem(CLE_VOIX) === "1");
    } catch {
      /* stockage indisponible */
    }
  }, []);
  function basculerVoix() {
    const v = !voix;
    setVoix(v);
    try {
      localStorage.setItem(CLE_VOIX, v ? "1" : "0");
    } catch {
      /* stockage indisponible */
    }
    if (v) parler("Guidage vocal activé");
    else {
      try {
        window.speechSynthesis?.cancel();
      } catch {
        /* rien */
      }
    }
  }
  const annonces = useRef(new Set<string>());
  const distanceManoeuvre = courante?.distanceM ?? null;
  useEffect(() => {
    if (!voix || !manoeuvre || distanceManoeuvre === null) return;
    const palier = palierAnnonce(distanceManoeuvre);
    if (!palier) return;
    const base = `${manoeuvre.lieu.join(",")}|${manoeuvre.type}|`;
    if (annonces.current.has(base + palier)) return;
    // Une seule fois chacune ; un palier proche annoncé couvre les plus lointains (tremblement GPS).
    const ordre: Palier[] = ["500", "150", "point"];
    ordre.slice(0, ordre.indexOf(palier) + 1).forEach((x) => annonces.current.add(base + x));
    if (annonces.current.size > 300) annonces.current.clear();
    parler(phraseAnnonce(manoeuvre, palier, distanceManoeuvre));
  }, [voix, manoeuvre, distanceManoeuvre]);

  // ——— Feuille : cartes à faire glisser ———
  const defile = useRef<HTMLDivElement>(null);
  const defilementAuto = useRef(0);
  /** Doigt posé sur la rangée de cartes : ni choix d'arrêt ni recentrage automatique pendant le geste. */
  const doigtCartes = useRef(false);
  /** Vue conduite : carte regardée en glissant, sans changer le guidage tant que le chauffeur n'a pas appuyé sur « Y aller ». */
  const [consulte, setConsulte] = useState<string | null>(null);
  useEffect(() => {
    if (vue !== "conduite" || cible?.id === consulte) setConsulte(null);
  }, [vue, cible?.id, consulte]);
  const indexCible = cible ? restants.indexOf(cible) : -1;
  useEffect(() => {
    const el = defile.current;
    if (!el || indexCible < 0 || feuille !== "moyenne" || doigtCartes.current) return;
    const carteEl = el.children[indexCible] as HTMLElement | undefined;
    if (!carteEl) return;
    const gauche = carteEl.offsetLeft - (el.clientWidth - carteEl.offsetWidth) / 2;
    if (Math.abs(el.scrollLeft - gauche) < 4) return;
    defilementAuto.current = Date.now();
    el.scrollTo({ left: gauche, behavior: "smooth" });
  }, [indexCible, feuille, restants.length]);
  const finDefilement = useRef<ReturnType<typeof setTimeout>>();
  function auDefilement() {
    clearTimeout(finDefilement.current);
    finDefilement.current = setTimeout(() => {
      const el = defile.current;
      if (!el || doigtCartes.current || Date.now() - defilementAuto.current < 600) return;
      const centre = el.scrollLeft + el.clientWidth / 2;
      let k = 0;
      let ecart = Infinity;
      Array.from(el.children).forEach((c, i) => {
        const h = c as HTMLElement;
        const e = Math.abs(h.offsetLeft + h.offsetWidth / 2 - centre);
        if (e < ecart) {
          ecart = e;
          k = i;
        }
      });
      const s = restants[k];
      if (!s) return;
      if (vueRef.current === "conduite") setConsulte(s.id === cible?.id ? null : s.id);
      else if (s.id !== cible?.id) setSelection(s.id);
    }, 180);
  }

  // ——— Feuille : trois positions (réduite, moyenne, pleine), mémorisée ———
  useEffect(() => {
    try {
      const v = lirePositionFeuille(localStorage.getItem(CLE_FEUILLE));
      feuilleMemo.current = v;
      setFeuilleBrute(v);
    } catch {
      /* stockage indisponible */
    }
  }, []);
  function setFeuille(v: PositionFeuille) {
    setFeuilleBrute(v);
    if (v === "pleine") return;
    feuilleMemo.current = v;
    try {
      localStorage.setItem(CLE_FEUILLE, v);
    } catch {
      /* stockage indisponible */
    }
  }
  // Le véhicule démarre ou s'arrête : le bandeau reprend son affichage automatique (compact en roulant, détaillé à l'arrêt).
  useEffect(() => setChoixBandeau(null), [mouvement]);
  // En mouvement : la feuille se replie sur sa ligne (arrêt en cours + « Livré »), les menus se ferment.
  useEffect(() => {
    if (!mouvement) return;
    setMenuVues(false);
    setFeuilleBrute("reduite");
  }, [mouvement]);
  // Poignée : tirer vers le haut ou le bas (geste), appui ou clavier pour alterner.
  const glisse = useRef<{ y: number } | null>(null);
  /** Heure du dernier geste traité : le clic qui le suit est ignoré (sinon, double changement). */
  const gesteA = useRef(0);
  const poignee = {
    onPointerDown(e: PointerEventReact<HTMLElement>) {
      glisse.current = { y: e.clientY };
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        /* capture indisponible */
      }
    },
    onPointerUp(e: PointerEventReact<HTMLElement>) {
      if (!glisse.current) return;
      const dy = e.clientY - glisse.current.y;
      glisse.current = null;
      gesteA.current = Date.now();
      setFeuille(positionApresGeste(feuille, dy, typeof window !== "undefined" ? window.innerHeight : 800));
    },
    onPointerCancel() {
      glisse.current = null;
    },
    onClick() {
      // Clic clavier (Entrée, Espace) : pas de pointeur, on alterne.
      if (Date.now() - gesteA.current < 500) return;
      setFeuille(positionApresGeste(feuille, 0));
    },
    onKeyDown(e: KeyboardEventReact<HTMLElement>) {
      if (e.key === "ArrowUp" || e.key === "ArrowDown") {
        e.preventDefault();
        setFeuille(positionApresGeste(feuille, e.key === "ArrowUp" ? -60 : 60));
      }
    },
    "aria-expanded": feuille !== "reduite",
    "aria-controls": "go-feuille-contenu",
  };
  const libellePoignee = feuille === "reduite" ? "Agrandir la feuille de la tournée" : feuille === "moyenne" ? "Feuille de la tournée : tirer vers le haut pour tous les arrêts, vers le bas pour réduire" : "Réduire la liste des arrêts";

  // ——— Liste complète (recherche, glisser-déposer) ———
  const terme = termeRecherche(recherche);
  const correspond = (st: Stop) =>
    correspondA([st.address, st.recipient, st.phone, st.parcel_code, st.relay_name, st.business_name, lists.find((l) => l.id === st.list_id)?.name], terme);
  const visibles = terme ? restants.filter(correspond) : restants;
  const idsVisibles = visibles.map((s) => s.id);
  const triActif = !fige && !terme && restants.length > 1;
  const ordreTri = restants.map((s) => ({ id: s.id, list_id: s.list_id ?? null }));
  const groupes = grouperParListe(stops, lists);
  const multi = groupes.length > 1 || groupes[0]?.liste != null;
  const nomListe = (s: Stop) => {
    const g = groupes.find((x) => x.arrets.includes(s));
    return g ? nomGroupe(g) : null;
  };
  /** Commune hors tournée de l'arrêt (sa liste est signalée hors tournée), sinon null. */
  const communeHorsTournee = (s: Stop) => {
    const g = groupes.find((x) => x.arrets.includes(s));
    return g?.liste?.is_hors_tournee ? nomGroupe(g) : null;
  };

  /** Affiche l'arrêt : carte d'arrêt ouverte (feuille moyenne), carte centrée dessus (avec son numéro) et guidage vers lui. */
  function afficherArret(s: Stop) {
    setRecherche("");
    setSelection(s.id);
    setFeuille("moyenne");
    if (s.lat === null || s.lng === null) return;
    // La vue conduite suit le véhicule : un arrêt choisi dans la liste se regarde en vue libre (« Recentrer » revient au suivi).
    derniereCible.current = s.id;
    conduiteAuto.current = true;
    const pts: [number, number][] = [[Number(s.lng), Number(s.lat)]];
    if (position) pts.push([position.lng, position.lat]);
    vueEnsemble(pts, 16, vueRef.current === "conduite" ? "libre" : vueRef.current);
  }
  const choisirDansListe = afficherArret;
  // Recherche : un seul résultat s'affiche tout seul (le temps de finir de taper), Entrée prend le premier.
  const cleVisibles = idsVisibles.join(",");
  useEffect(() => {
    const id = arretAAfficher(idsVisibles, terme);
    const s = id ? restants.find((x) => x.id === id) : undefined;
    if (!s || feuille !== "pleine") return;
    const t = setTimeout(() => afficherArret(s), 600);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [terme, cleVisibles, feuille]);
  // Adresse ajoutée : dès que la tournée est rechargée, elle s'affiche.
  const arretAjoute = useRef<string | null>(null);
  useEffect(() => {
    const s = arretAjoute.current ? stops.find((x) => x.id === arretAjoute.current) : undefined;
    if (!s) return;
    arretAjoute.current = null;
    afficherArret(s);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stops]);

  // Plein écran sur iPhone (Safari) : pas de zoom de la page au pincement (la carte zoome seule),
  // pas de défilement de la page derrière, retour au coin haut-gauche si la page avait glissé.
  useEffect(() => {
    const meta = document.querySelector<HTMLMetaElement>('meta[name="viewport"]');
    const avant = meta?.getAttribute("content") ?? null;
    meta?.setAttribute("content", "width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover");
    const html = document.documentElement;
    const body = document.body;
    const style = { html: html.style.cssText, body: body.style.cssText };
    html.style.overflow = "hidden";
    html.style.overscrollBehavior = "none";
    body.style.overflow = "hidden";
    body.style.overscrollBehavior = "none";
    window.scrollTo(0, 0);
    const recaler = () => {
      if (window.scrollX !== 0) window.scrollTo(0, window.scrollY);
    };
    window.addEventListener("scroll", recaler, { passive: true });
    return () => {
      window.removeEventListener("scroll", recaler);
      if (meta && avant !== null) meta.setAttribute("content", avant);
      html.style.cssText = style.html;
      body.style.cssText = style.body;
    };
  }, []);

  const faits = stops.length - restants.length;
  /** Lance l'action d'un menu et le referme. */
  const lancer = (action: () => void) => {
    setMenuVues(false);
    action();
  };
  const el = elementsConduite({ mouvement, vue, position, fige, enCours: run.status === "in_progress", traceActive: Boolean(p.traceActive), choixBandeau });
  const deplie = bandeauDeplie(mouvement, choixBandeau);

  return (
    <div className="fixed inset-0 z-40 flex flex-col overflow-hidden bg-paper" aria-label="GO Navigation">
      <style>{`.go-nav .maplibregl-ctrl-attrib{font-size:10px;background:rgba(246,247,251,.75)!important;color:#5A6378}.go-nav .maplibregl-ctrl-attrib a{color:#5A6378}.go-nav .maplibregl-ctrl-bottom-right{bottom:var(--go-feuille,300px);transition:bottom .3s}`}</style>
      <div className="go-nav absolute inset-0" style={{ "--go-feuille": `${hauteur}px` } as CSSProperties}>
        <div ref={conteneur} className="h-full w-full" role="region" aria-label="Carte de navigation" />
      </div>

      {/* Bandeau de guidage : compact par défaut (manœuvre, distance, rue, une ligne d'arrivée) ; les détails se déplient à l'arrêt ou au toucher */}
      <div className="pointer-events-none absolute inset-x-0 top-0 z-10 px-2.5 pt-[max(0.5rem,env(safe-area-inset-top))]">
        <div ref={bandeauRef} className="pointer-events-auto mx-auto flex max-w-xl items-stretch gap-1.5">
          {el.retour && (
            <button type="button" onClick={p.onFermer} className="flex w-11 shrink-0 items-center justify-center rounded-2xl bg-marine/85 text-2xl text-white shadow-pop backdrop-blur-sm" aria-label="Retour à la préparation de la tournée colis">
              ‹
            </button>
          )}
          <div className="min-w-0 flex-1 rounded-2xl bg-marine/85 px-3 py-1.5 text-white shadow-pop backdrop-blur-sm" aria-live="polite">
            {fige ? (
              <p className="py-1 text-sm font-semibold">Tournée clôturée : consultation seulement.</p>
            ) : cible ? (
              <button
                type="button"
                onClick={() => setChoixBandeau(!deplie)}
                aria-expanded={deplie}
                aria-label={deplie ? "Réduire les détails du guidage" : "Afficher les détails du guidage"}
                className="block min-h-[44px] w-full text-left"
              >
                {manoeuvre && courante && !arrive ? (
                  <span className="flex items-center gap-2.5">
                    <FlecheManoeuvre picto={pictogramme(manoeuvre)} sortie={manoeuvre.sortie} className="h-9 w-9 shrink-0 text-teal" />
                    <span className="shrink-0 font-display text-2xl font-bold tabular-nums leading-none text-teal">{formatDistanceManoeuvre(courante.distanceM)}</span>
                    <span className="min-w-0 flex-1 truncate text-sm font-semibold" title={texteManoeuvre(manoeuvre)}>
                      {texteManoeuvre(manoeuvre)}
                    </span>
                  </span>
                ) : arrive ? (
                  <span className="block font-display text-xl font-bold leading-tight text-teal">Arrivé</span>
                ) : (
                  <span className="flex items-baseline gap-2">
                    <span className="shrink-0 font-display text-2xl font-bold tabular-nums leading-tight text-teal">{formatDistance(distanceAffichee)}</span>
                    <span className="min-w-0 flex-1 truncate text-sm font-semibold">{cible.address}</span>
                  </span>
                )}
                {(eta || el.indicateurTrace) && (
                  // Une seule ligne fine : arrivée estimée (et trajet enregistré, RGPD, qui reste affiché en roulant).
                  <span className="mt-0.5 flex items-center gap-2 text-[11px] leading-tight text-white/80">
                    {eta && (
                      <span className="min-w-0 flex-1 truncate">
                        <span className="uppercase tracking-wide text-white/65">Arrivée</span> <strong className="font-bold tabular-nums text-white">{eta.heure}</strong> · <span className="font-semibold tabular-nums text-teal">{eta.dans}</span> · {eta.distance}
                        {eta.estimee && " (est.)"}
                      </span>
                    )}
                    {el.indicateurTrace && (
                      <span className="ml-auto shrink-0 text-white/65" title="Trajet enregistré pendant la tournée en cours pour l'historique (conservé 1 an). Mettre en pause : « masquer » sur l'écran de la tournée.">
                        <span className="mr-1 inline-block h-1.5 w-1.5 rounded-full bg-orange align-middle" aria-hidden="true" />
                        Trajet enregistré
                      </span>
                    )}
                  </span>
                )}
                {deplie && suivante && manoeuvre && !arrive && (
                  <span className="mt-0.5 flex items-center gap-1 text-[11px] leading-tight text-white/75">
                    <FlecheManoeuvre picto={pictogramme(suivante)} sortie={suivante.sortie} className="h-3.5 w-3.5 shrink-0 text-white/75" />
                    <span className="truncate">Puis : {texteManoeuvre(suivante)}</span>
                  </span>
                )}
                {el.ligneEtat && (
                  <span className="mt-0.5 block truncate text-[11px] leading-tight text-white/65">
                    {faits}/{stops.length} faits
                    {avancement.colisRestants > 0 && ` · ${avancement.colisRestants} colis restants`}
                    {avancement.finEstimee && ` · fin ≈ ${heureFin(avancement.finEstimee)}`}
                  </span>
                )}
              </button>
            ) : (
              <p className="py-1 text-sm font-semibold">Tous les arrêts sont faits 🎉</p>
            )}
          </div>
        </div>
        {erreurGps ? (
          <p className="pointer-events-auto mx-auto mt-1.5 max-w-xl rounded-xl bg-orange px-3 py-2 text-xs font-semibold text-on-orange shadow-pop">{erreurGps}</p>
        ) : (
          !position && <p className="mx-auto mt-1.5 w-fit max-w-xl rounded-full bg-surface/90 px-3 py-1 text-[11px] font-semibold text-navy/70 shadow-card">Vue d&apos;ensemble : en attente de la position GPS…</p>
        )}
        <div className="pointer-events-auto relative mx-auto mt-1.5 flex max-w-xl items-center justify-end gap-1.5">
          {el.menuOptions && (
            <>
              <button
                type="button"
                onClick={() => setMenuVues((v) => !v)}
                disabled={p.busy}
                className="min-h-[44px] rounded-full bg-surface px-4 text-xs font-semibold text-navy shadow-pop disabled:opacity-60"
                aria-haspopup="menu"
                aria-expanded={menuVues}
                aria-controls="go-menu-vues"
              >
                {p.busy ? "Calcul…" : "Options ▾"}
              </button>
              {menuVues && (
                <>
                  <div className="fixed inset-0 z-0" aria-hidden="true" onClick={() => setMenuVues(false)} />
                  <div id="go-menu-vues" role="menu" aria-label="Options de GO" className="absolute right-0 top-full z-10 mt-1.5 flex w-72 flex-col rounded-2xl bg-surface p-1.5 shadow-pop">
                    {!fige && run.status === "in_progress" && (
                      <button type="button" role="menuitem" className={ITEM_MENU} onClick={() => lancer(() => setAjout(true))}>
                        Ajouter une adresse
                      </button>
                    )}
                    {!fige && run.status === "in_progress" && restants.length > 1 && (
                      <div role="group" aria-label="Optimiser la tournée" className="mt-1 border-t border-navy/10 pt-1">
                        <p className="px-3 pb-0.5 pt-1 text-[11px] font-semibold uppercase tracking-wide text-navy/55">Optimiser la tournée</p>
                        <button type="button" role="menuitem" className={ITEM_MENU} onClick={() => lancer(() => void p.onReoptimiser())}>
                          Depuis ma position
                          <span className="block text-xs font-normal text-navy/60">Prochaine adresse la plus proche</span>
                        </button>
                        {p.onOptimiserDepuisArret && (
                          <button type="button" role="menuitem" className={ITEM_MENU} onClick={() => lancer(() => setChoixDepuis(true))}>
                            Depuis une adresse choisie…
                            <span className="block text-xs font-normal text-navy/60">L&apos;adresse devient le prochain arrêt</span>
                          </button>
                        )}
                        {p.onReglagesOptimisation && (
                          <button type="button" role="menuitem" className={ITEM_MENU} onClick={() => lancer(() => p.onReglagesOptimisation?.())}>
                            Départ et arrivée…
                          </button>
                        )}
                      </div>
                    )}
                    <div className="mt-1 border-t border-navy/10 pt-1">
                      <button type="button" role="menuitem" className={ITEM_MENU} onClick={() => lancer(toutVoir)}>
                        Toute la tournée sur la carte
                      </button>
                    </div>
                    {!fige && (
                      <div className="mt-1 border-t border-navy/10 pt-1.5">
                        <InterrupteurMode simple={p.modeSimple} onChange={p.onModeSimple} />
                      </div>
                    )}
                  </div>
                </>
              )}
            </>
          )}
        </div>
        <div className="pointer-events-auto mx-auto mt-1.5 flex max-w-xl flex-col items-end gap-1.5">
          <button
            type="button"
            onClick={basculerVoix}
            className={`flex h-11 w-11 items-center justify-center rounded-full shadow-pop ${voix ? "bg-marine text-teal-sur-menu" : "bg-surface text-navy/70"}`}
            aria-pressed={voix}
            aria-label={voix ? "Couper le guidage vocal" : "Activer le guidage vocal"}
          >
            <IconeHautParleur actif={voix} className="h-5 w-5" />
          </button>
          {el.boussole && (
            <button type="button" onClick={voirTrajet} className="flex h-11 w-11 items-center justify-center rounded-full bg-surface shadow-pop" aria-label="Nord en haut (vue d'ensemble du trajet)">
              <span ref={boussoleRef} className="flex flex-col items-center leading-none" aria-hidden="true">
                <svg viewBox="0 0 12 16" className="h-3.5 w-3">
                  <path d="M6 0 L11 9 H1 Z" fill="#FF6B35" />
                  <path d="M1 9 H11 L6 16 Z" fill="#0A0F1E" opacity=".35" />
                </svg>
                <span className="text-[9px] font-bold text-navy">N</span>
              </span>
            </button>
          )}
        </div>
      </div>

      {/* Vitesse réelle et limitation de la route (indicatif : le panneau sur place fait foi) */}
      {position && vitesseKmh !== null && (
        <div
          className="absolute right-3 z-10 flex items-end gap-2"
          style={{ bottom: `${Math.round(Math.min(hauteur, (typeof window !== "undefined" ? window.innerHeight : 800) * 0.6)) + 12}px` }}
          role="status"
          aria-label={`Vitesse ${vitesseKmh} kilomètres par heure${limiteKmh !== null ? `, limitation ${limiteKmh}` : ""}`}
        >
          {limiteKmh !== null && (
            <span className="flex h-12 w-12 items-center justify-center rounded-full border-[5px] bg-white text-base font-extrabold text-black shadow-pop" style={{ borderColor: "#d62718" }}>{limiteKmh}</span>
          )}
          <span className="flex h-14 min-w-[3.5rem] flex-col items-center justify-center rounded-2xl bg-marine px-2 text-white shadow-pop" style={enDepassement(vitesseKmh, limiteKmh) ? { backgroundColor: "#d62718" } : undefined}>
            <span className="text-xl font-extrabold leading-none tabular-nums">{vitesseKmh}</span>
            <span className="text-[10px] font-semibold leading-none opacity-80">km/h</span>
          </span>
        </div>
      )}

      {/* Recentrer : seul bouton pour reprendre le suivi (carte déplacée ou vue d'ensemble) */}
      {el.recentrer && (
        <button
          type="button"
          onClick={recentrer}
          className="absolute left-3 z-10 flex min-h-[44px] items-center gap-1.5 rounded-full bg-marine px-4 text-sm font-bold text-white shadow-pop"
          style={{ bottom: `${Math.round(Math.min(hauteur, (typeof window !== "undefined" ? window.innerHeight : 800) * 0.6)) + 12}px` }}
        >
          <IconNavigation className="h-4 w-4 text-teal" /> Recentrer
        </button>
      )}

      {/* Feuille de la tournée : réduite (une ligne), moyenne (carte de l'arrêt), pleine (liste) */}
      <div
        ref={feuilleRef}
        className={`absolute inset-x-0 bottom-0 z-20 flex flex-col rounded-t-3xl bg-paper shadow-pop transition-[max-height] duration-300 motion-reduce:transition-none ${
          feuille === "pleine" ? "max-h-[85dvh]" : feuille === "moyenne" ? "max-h-[40dvh] min-h-[220px]" : ""
        }`}
      >
        {feuille === "reduite" ? (
          <div id="go-feuille-contenu" className="relative flex items-center gap-2 px-3 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-2.5">
            <span className="absolute left-1/2 top-1 h-1 w-9 -translate-x-1/2 rounded-full bg-navy/20" aria-hidden="true" />
            <button type="button" className="flex min-h-[52px] min-w-0 flex-1 touch-none flex-col justify-center text-left" aria-label={libellePoignee} {...poignee}>
              {cible ? (
                <>
                  <span className="text-[11px] font-semibold uppercase tracking-wide text-teal-ink">
                    {enRetour ? "Retour" : `Arrêt ${numero(cible)} / ${stops.length}`}
                    {cible.parcel_count > 1 && ` · ${cible.parcel_count} colis`}
                  </span>
                  <span className="truncate text-sm font-bold leading-snug text-navy">{adresseCourte(cible.address)}</span>
                </>
              ) : (
                <span className="text-sm font-bold text-navy">Tournée terminée 🎉</span>
              )}
            </button>
            {cible && !enRetour && !fige ? (
              <button type="button" className="btn-primary min-h-[52px] shrink-0 justify-center !px-4 text-base" onClick={() => p.onTerminer(cible)}>
                {!p.modeSimple && estRamasse(cible) ? <IconRamasse className="h-5 w-5" /> : !p.modeSimple && estPointRelais(cible) ? <IconPointRelais className="h-5 w-5" /> : <IconCheck className="h-5 w-5" />} {libelleLivre(p.modeSimple, cible)}
              </button>
            ) : (
              (!cible || enRetour) &&
              (p.retour?.etape === "gasoil" ? (
                <button type="button" className="btn-primary min-h-[52px] shrink-0 !px-3 text-sm" onClick={p.onRetourSuivant}>
                  Plein fait ⛽
                </button>
              ) : (
                <button type="button" className="btn-primary min-h-[52px] shrink-0 !px-3 text-sm" onClick={p.onFermer}>
                  {fige ? "Retour à la tournée" : "Clôturer la tournée"}
                </button>
              ))
            )}
            {el.actionsArret && cible && !enRetour && (
              <button
                type="button"
                className="flex h-[52px] w-11 shrink-0 items-center justify-center rounded-xl bg-navy/[0.06] text-xl font-bold text-navy"
                onClick={() => setMenuArret(cible)}
                aria-label="Actions de l'arrêt : appeler, horaires, fiche, modifier, passer, retirer"
                aria-haspopup="dialog"
              >
                ⋯
              </button>
            )}
          </div>
        ) : (
          <>
            <button type="button" className="flex min-h-[44px] w-full touch-none flex-col items-center justify-center gap-1 pb-1 pt-1.5" aria-label={libellePoignee} {...poignee}>
              <span className="h-1.5 w-10 rounded-full bg-navy/20" aria-hidden="true" />
              {feuille === "pleine" && eta && (
                // Feuille pleine (elle peut cacher le bandeau) : l'heure d'arrivée reste lisible ici.
                <span className="flex items-baseline gap-2 text-navy">
                  <span className="font-display text-xl font-bold tabular-nums">{eta.heure}</span>
                  <span className="text-sm font-bold text-teal-ink">{eta.dans}</span>
                  <span className="text-sm font-semibold text-navy/70">{eta.distance}</span>
                </span>
              )}
              <span className="text-[11px] font-semibold uppercase tracking-wide text-navy/55">{feuille === "pleine" ? "Réduire ▾" : "Tous les arrêts ▴"}</span>
            </button>

            {feuille === "moyenne" ? (
              restants.length ? (
                <div
                  id="go-feuille-contenu"
                  ref={defile}
                  onScroll={auDefilement}
                  onTouchStart={() => (doigtCartes.current = true)}
                  onTouchEnd={() => {
                    doigtCartes.current = false;
                    auDefilement();
                  }}
                  onTouchCancel={() => {
                    doigtCartes.current = false;
                    auDefilement();
                  }}
                  className="flex min-h-0 flex-1 touch-pan-x snap-x snap-mandatory gap-3 overflow-x-auto overflow-y-hidden overscroll-x-contain px-[6%] pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-0.5 [scrollbar-width:none]"
                  aria-label="Arrêts à faire (glisser pour passer d'un arrêt à l'autre)"
                >
                  {restants.map((s) => (
                    <CarteArret
                      key={s.id}
                      stop={s}
                      numero={numero(s)}
                      total={stops.length}
                      suivi={s.id === cible?.id}
                      onAller={consulte === s.id ? () => { setSelection(s.id); setConsulte(null); } : undefined}
                      prochain={s.id === restants[0]?.id}
                      nomListe={multi ? nomListe(s) : null}
                      horsTournee={communeHorsTournee(s)}
                      horaires={horaires}
                      fige={fige}
                      onTerminer={p.onTerminer}
                      onCloture={p.onCloture}
                      onTelephone={p.onTelephone}
                      onPlus={setMenuArret}
                      modeSimple={p.modeSimple}
                      onAppel={p.onAppel}
                    />
                  ))}
                </div>
              ) : (
                <div id="go-feuille-contenu" className="flex flex-col items-center gap-3 px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-2 text-center">
                  <p className="font-display text-lg font-bold">Tournée terminée 🎉</p>
                  <button type="button" className="btn-primary !py-3" onClick={p.onFermer}>
                    {fige ? "Retour à la tournée" : "Clôturer la tournée"}
                  </button>
                </div>
              )
            ) : (
              <div id="go-feuille-contenu" className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
                <label className="relative block">
                  <span className="sr-only">Rechercher dans la tournée</span>
                  <input
                    className="input"
                    type="search"
                    value={recherche}
                    onChange={(e) => setRecherche(e.target.value)}
                    onKeyDown={(e) => {
                      // Entrée : le premier résultat s'affiche directement.
                      const id = e.key === "Enter" ? arretAAfficher(idsVisibles, terme, true) : null;
                      const s = id ? restants.find((x) => x.id === id) : undefined;
                      if (s) (e.preventDefault(), afficherArret(s));
                    }}
                    enterKeyHint="go"
                    placeholder="Adresse, client, n° de colis…"
                  />
                </label>
                {terme && visibles.length === 0 && <p className="text-center text-sm text-navy/60">Aucun arrêt restant ne correspond.</p>}
                <ZoneTri ordre={ordreTri} onDeposer={(id, c) => void p.onDeposer(id, c)} actif={triActif}>
                  <ol className="flex flex-col gap-2">
                    {visibles.map((s) => {
                      const rendu = (props: { ref?: (el: HTMLElement | null) => void; style?: CSSProperties } | null, poignee: Poignee | null) => (
                        <li
                          ref={props?.ref}
                          style={props?.style}
                          {...(fige ? {} : gestesAppuiLong(() => setMenuArret(s)))}
                          className={`relative flex items-center gap-2.5 overflow-hidden rounded-xl bg-surface py-2.5 pr-2 shadow-card ${s.id === cible?.id ? "ring-2 ring-teal" : ""} ${estRamasse(s) || estPointRelais(s) ? "pl-4" : "pl-2.5"}`}
                        >
                          <EncocheArret stop={s} />
                          {poignee && <BoutonPoignee poignee={poignee} libelle={s.recipient ?? s.address} />}
                          <button type="button" className="flex min-w-0 flex-1 items-center gap-2.5 text-left" onClick={() => choisirDansListe(s)} aria-label={`Naviguer vers l'arrêt ${numero(s)} — ${s.address}`}>
                            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-marine text-xs font-semibold tabular-nums text-teal-sur-menu">{numero(s)}</span>
                            <span className="min-w-0">
                              {(estRamasse(s) || estPointRelais(s) || !s.phone || communeHorsTournee(s)) && (
                                <span className="mb-1 flex flex-wrap gap-1">
                                  <BadgeArret stop={s} />
                                  {communeHorsTournee(s) && <BadgeHorsTournee commune={communeHorsTournee(s)} />}
                                  {!s.phone && <BadgeSansTelephone />}
                                </span>
                              )}
                              <span className="block text-sm font-semibold leading-snug">{s.address}</span>
                              <span className="block truncate text-xs text-navy/60">{[multi && nomListe(s), s.recipient, s.parcel_count > 1 && `${s.parcel_count} colis`].filter(Boolean).join(" · ") || " "}</span>
                              <BadgeHoraires stop={s} fenetres={horaires.fenetres.get(s.id) ?? null} passage={horaires.passages.get(s.id)} />
                            </span>
                          </button>
                          {!fige &&
                            (p.modeSimple ? (
                              <>
                                <button type="button" className="btn-primary min-h-[44px] shrink-0 !px-3 !py-1 text-xs" onClick={() => p.onTerminer(s)} aria-label={`Livré — ${s.recipient ?? s.address}`}>
                                  <IconCheck className="h-4 w-4" /> Livré
                                </button>
                                <button type="button" className="btn-secondary min-h-[44px] shrink-0 !px-2.5 !py-1 text-xs text-orange-ink" onClick={() => p.onCloture(s, "echec")} aria-label={`Non livré — ${s.recipient ?? s.address}`}>
                                  <IconX className="h-4 w-4" /> Non livré
                                </button>
                              </>
                            ) : (
                              <button type="button" className="min-h-[44px] shrink-0 rounded-full border border-navy/15 px-2.5 text-xs font-semibold text-navy/80" onClick={() => p.onCloture(s, "choix")} aria-label={`Clôturer ${s.recipient ?? s.address}`}>
                                Clôturer
                              </button>
                            ))}
                          {!fige && (
                            <button type="button" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-navy/[0.06] text-lg font-bold text-navy" onClick={() => setMenuArret(s)} aria-label={`Modifier, retirer ou passer ${s.recipient ?? s.address}`} aria-haspopup="dialog">
                              ⋯
                            </button>
                          )}
                          {s.phone && (
                            <a href={lienTel(s.phone)} onClick={() => p.onAppel(s)} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-teal/15 text-teal-ink" aria-label={`Appeler ${s.recipient ?? s.address}`}>
                              <IconPhone className="h-4 w-4" />
                            </a>
                          )}
                        </li>
                      );
                      return triActif ? <ArretTriable key={s.id} id={s.id} rendu={rendu} /> : <Fragment key={s.id}>{rendu(null, null)}</Fragment>;
                    })}
                  </ol>
                </ZoneTri>
              </div>
            )}
          </>
        )}
      </div>

      {choixDepuis && p.onOptimiserDepuisArret && (
        <div className="fixed inset-0 z-[75] flex items-end justify-center bg-marine/60 sm:items-center" role="dialog" aria-modal="true" aria-labelledby="optim-depuis-titre">
          <section className="flex max-h-[85dvh] w-full max-w-lg flex-col gap-3 overflow-y-auto rounded-t-3xl bg-surface p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] shadow-pop sm:rounded-3xl">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 id="optim-depuis-titre" className="font-display text-xl font-bold">
                  Optimiser depuis une adresse
                </h2>
                <p className="text-sm text-navy/60">Choisissez l&apos;adresse de départ : elle devient le prochain arrêt, les autres suivent de proche en proche.</p>
              </div>
              <button type="button" className="btn-ghost !px-2 !py-1" onClick={() => setChoixDepuis(false)} aria-label="Fermer">
                ✕
              </button>
            </div>
            <ul className="flex flex-col gap-1.5">
              {restants
                .filter((s) => s.lat !== null && s.lng !== null)
                .map((s) => (
                  <li key={s.id}>
                    <button
                      type="button"
                      className="flex min-h-[52px] w-full items-center gap-3 rounded-xl border border-navy/10 px-3 text-left hover:bg-navy/5"
                      onClick={() => {
                        setChoixDepuis(false);
                        void p.onOptimiserDepuisArret?.(s.id);
                      }}
                    >
                      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-marine text-xs font-bold text-white">{numero(s)}</span>
                      <span className="min-w-0 text-sm font-semibold leading-snug">{adresseCourte(s.address)}</span>
                    </button>
                  </li>
                ))}
            </ul>
          </section>
        </div>
      )}

      {correction && (
        <CorrectionAdresse
          stop={correction}
          position={position}
          depot={run.start_lat !== null && run.start_lng !== null ? { lat: Number(run.start_lat), lng: Number(run.start_lng) } : null}
          onRecharger={p.onRecharger}
          onFermer={() => setCorrection(null)}
          onCorrigee={async (texte, ok, annuler) => {
            setCorrection(null);
            await p.onRecharger();
            p.onToast({ ok, text: texte, ...(annuler ? { dureeMs: DELAI_ANNULATION_MS, actions: [{ label: "Annuler", onClick: annuler }] } : {}) });
          }}
        />
      )}

      {menuArret && (
        <MenuRapideArret
          stop={stops.find((x) => x.id === menuArret.id) ?? menuArret}
          numero={numero(menuArret)}
          modeSimple={p.modeSimple}
          peutPasser={restants.length > 1}
          lecture={fige}
          horaires={horaires}
          onFermer={() => setMenuArret(null)}
          onAppel={p.onAppel}
          onTelephone={p.onTelephone}
          onHoraires={p.onHoraires}
          onLivre={p.onTerminer}
          onNonLivre={(x) => p.onCloture(x, "echec")}
          onCorriger={setCorrection}
          onRetirer={p.onRetirer}
          onPasser={p.onPasser}
          onContact={p.onContact}
          onFiche={p.onFiche}
        />
      )}

      {ajout && (
        <AjoutAdresse
          run={run}
          stops={stops}
          position={position}
          onFermer={() => setAjout(false)}
          onAjoute={async (texte, ok, arretId) => {
            setAjout(false);
            arretAjoute.current = arretId ?? null;
            await p.onRecharger();
            p.onToast({ ok, text: texte });
          }}
          onReoptimiser={p.onReoptimiser}
        />
      )}
    </div>
  );
}

/** Ligne d'un menu (Options) : zone tactile de 48 px. */
const ITEM_MENU = "min-h-[48px] rounded-xl px-3 text-left text-sm font-semibold text-navy hover:bg-navy/5";

/** Identifiant de la destination « retour » (dépôt ou siège) suivie comme un arrêt. */
const ID_RETOUR = "retour";

const ANGLES: Partial<Record<Pictogramme, number>> = {
  "tout-droit": 0,
  droite: 90,
  gauche: -90,
  "legere-droite": 45,
  "legere-gauche": -45,
  "serree-droite": 135,
  "serree-gauche": -135,
};

/** Flèche de la manœuvre (tout droit, gauche, droite, légère, serrée, demi-tour, rond-point avec numéro de sortie, arrivée). */
function FlecheManoeuvre({ picto, sortie, className }: { picto: Pictogramme; sortie?: number; className?: string }) {
  let contenu: JSX.Element;
  if (picto === "demi-tour") {
    contenu = (
      <>
        <path d="M32 44 V22 a8 8 0 0 0 -16 0 V36" />
        <path d="M10 30 L16 36 L22 30" />
      </>
    );
  } else if (picto === "rond-point") {
    contenu = (
      <>
        <circle cx="24" cy="18" r="10" />
        <path d="M24 44 V28" />
        {sortie ? (
          <text x="24" y="23" textAnchor="middle" fontSize="14" fontWeight="700" fill="currentColor" stroke="none">
            {sortie}
          </text>
        ) : null}
      </>
    );
  } else if (picto === "arrivee") {
    contenu = (
      <>
        <path d="M16 44 V6" />
        <path d="M16 7 H36 L31 14 L36 21 H16" fill="currentColor" />
      </>
    );
  } else {
    const a = ((ANGLES[picto] ?? 0) * Math.PI) / 180;
    const x = 24 + 16 * Math.sin(a);
    const y = 24 - 16 * Math.cos(a);
    const pointe = (d: number) => `${(x - 10 * Math.sin(a + d)).toFixed(1)} ${(y + 10 * Math.cos(a + d)).toFixed(1)}`;
    contenu = (
      <>
        <path d={`M24 44 V24 L${x.toFixed(1)} ${y.toFixed(1)}`} />
        <path d={`M${pointe(0.65)} L${x.toFixed(1)} ${y.toFixed(1)} L${pointe(-0.65)}`} />
      </>
    );
  }
  return (
    <svg viewBox="0 0 48 48" className={className} fill="none" stroke="currentColor" strokeWidth={5} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {contenu}
    </svg>
  );
}

/** Haut-parleur (barré quand le guidage vocal est coupé). */
function IconeHautParleur({ actif, className }: { actif: boolean; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 9 H8 L13 5 V19 L8 15 H4 Z" fill="currentColor" />
      {actif ? (
        <>
          <path d="M16.5 8.5 a5 5 0 0 1 0 7" />
          <path d="M19 6 a8.5 8.5 0 0 1 0 12" />
        </>
      ) : (
        <path d="M16 9 L22 15 M22 9 L16 15" />
      )}
    </svg>
  );
}

/**
 * Carte d'un arrêt dans la feuille (position moyenne), épurée : adresse, client,
 * livré / non livré, puis appel et « ⋯ Plus » (menu de l'arrêt : horaires, fiche,
 * contacts, modifier, passer, retirer, SMS, Waze, Google Maps).
 */
function CarteArret({
  stop: s,
  numero,
  total,
  suivi,
  onAller,
  prochain,
  nomListe,
  horsTournee,
  horaires,
  fige,
  onTerminer,
  onCloture,
  onTelephone,
  onPlus,
  modeSimple,
  onAppel,
}: {
  stop: Stop;
  numero: number;
  total: number;
  suivi: boolean;
  /** Vue conduite : carte consultée sans être suivie ; appuyer pour y guider. */
  onAller?: () => void;
  prochain: boolean;
  nomListe: string | null;
  /** Commune hors tournée de l'arrêt (badge « Hors tournée »), sinon null. */
  horsTournee: string | null;
  horaires: Horaires;
  fige: boolean;
  onPlus: (s: Stop) => void;
} & Pick<GoNavigationProps, "onTerminer" | "onCloture" | "onTelephone" | "modeSimple" | "onAppel">) {
  const secondaire = [s.business_name, s.recipient].filter((v): v is string => Boolean(v) && !repeteAdresse(v, s.address)).join(" · ");
  const pastilleBase = "inline-flex min-h-[44px] items-center gap-1 rounded-full px-3 text-xs font-semibold";
  return (
    <section
      className={`relative flex max-h-full w-[88%] max-w-md shrink-0 snap-center flex-col gap-2 overflow-y-auto overscroll-y-contain touch-pan-x touch-pan-y rounded-2xl border-2 bg-surface px-3.5 py-3 shadow-card ${suivi ? bordureArret(s, "border-teal/70") : "border-transparent"}`}
      aria-label={`Arrêt ${numero} sur ${total}${suivi ? ", en cours de navigation" : ""}`}
    >
      <EncocheArret stop={s} large />
      {onAller && (
        <button type="button" className="btn-dark min-h-[44px] justify-center text-sm" onClick={onAller}>
          🧭 Y aller (guidage vers cet arrêt)
        </button>
      )}
      <div>
        <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] font-semibold uppercase tracking-wide text-teal-ink">
          <BadgeArret stop={s} />
          {horsTournee && <BadgeHorsTournee commune={horsTournee} />}
          <span>
            Arrêt {numero} / {total}
            {prochain ? " · prochain" : ""}
            {s.parcel_count > 1 && ` · ${s.parcel_count} colis${estRamasse(s) ? " à ramasser" : estPointRelais(s) ? " à déposer" : ""}`}
            {formatPoids(s.weight_kg) && ` · ${formatPoids(s.weight_kg)}`}
            {nomListe && <span className="normal-case tracking-normal text-navy/55"> · {nomListe}</span>}
          </span>
        </p>
        <p className="mt-0.5 line-clamp-2 text-lg font-bold leading-snug">{s.address}</p>
        {secondaire && <p className="truncate text-sm text-navy/75">{secondaire}</p>}
        {s.notes && <p className="line-clamp-1 text-xs text-navy/65">{s.notes}</p>}
        {s.lat === null && <p className="text-xs font-semibold text-orange-ink">Adresse non localisée : ouvrez-la dans Waze ou Google Maps.</p>}
        <BadgeHoraires stop={s} fenetres={horaires.fenetres.get(s.id) ?? null} passage={horaires.passages.get(s.id)} />
      </div>

      {!fige && (
        <div className="grid grid-cols-[2fr_1fr] gap-2">
          <button type="button" className="btn-primary min-h-[48px] justify-center !py-2.5 text-base" onClick={() => onTerminer(s)}>
            {!modeSimple && estRamasse(s) ? <IconRamasse className="h-5 w-5" /> : !modeSimple && estPointRelais(s) ? <IconPointRelais className="h-5 w-5" /> : <IconCheck className="h-5 w-5" />} {libelleLivre(modeSimple, s)}
          </button>
          <button type="button" className="btn-secondary min-h-[48px] justify-center !px-2 !py-2.5 text-orange-ink" onClick={() => onCloture(s, "echec")}>
            <IconX className="h-5 w-5" /> Non livré
          </button>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-1.5">
        {s.phone ? (
          <a href={lienTel(s.phone)} onClick={() => onAppel(s)} className={`${pastilleBase} bg-teal/15 text-teal-ink`} aria-label={`Appeler ${s.recipient ?? s.address}`}>
            <IconPhone className="h-4 w-4" /> Appeler
          </a>
        ) : (
          <button type="button" className={`${pastilleBase} bg-navy/[0.05]`} disabled={fige} onClick={() => onTelephone(s)}>
            <IconPhone className="h-4 w-4" /> Ajouter le n°
          </button>
        )}
        <button type="button" className={`${pastilleBase} bg-navy/[0.05]`} onClick={() => onPlus(s)} aria-haspopup="dialog">
          ⋯ Plus
        </button>
      </div>
    </section>
  );
}

/**
 * Correction de l'adresse d'un arrêt sans quitter GO (erreur de saisie à la
 * base) : PATCH /api/colis/arrets/[id] { adresse } la re-géolocalise ; l'écran
 * est rechargé, le trajet vers l'arrêt se recalcule avec les nouvelles
 * coordonnées. L'ordre des arrêts n'est pas modifié (« Réoptimiser » reste
 * au choix du chauffeur).
 */
function CorrectionAdresse({
  stop,
  position,
  depot,
  onFermer,
  onCorrigee,
  onRecharger,
}: {
  stop: Stop;
  position: Point | null;
  depot: Point | null;
  onRecharger: () => Promise<void>;
  onFermer: () => void;
  /** `annuler` : remet l'ancienne adresse (message « Annuler » de l'écran). */
  onCorrigee: (texte: string, ok: boolean, annuler?: () => void) => Promise<void>;
}) {
  const [adresse, setAdresse] = useState(stop.address);
  const [envoi, setEnvoi] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const inchangee = adresse.trim() === stop.address.trim();

  /** Choisir une suggestion enregistre tout de suite (pas de bouton en plus) ; « Annuler » rétablit l'ancienne adresse. */
  async function enregistrer(texte = adresse) {
    const nouvelle = texte.trim();
    if (nouvelle.length < 5) return setErreur("Saisissez une adresse (5 caractères au moins).");
    if (nouvelle === stop.address.trim()) return onFermer();
    setEnvoi(true);
    setErreur(null);
    try {
      const issue = await patchArret(stop.id, { adresse: nouvelle });
      if (issue === "en_attente") return void (await onCorrigee("Pas de réseau : la correction est conservée et sera appliquée au retour du réseau.", true));
      const ancienne = stop.address;
      await onCorrigee("Adresse corrigée : le trajet est recalculé.", true, () => void patchArret(stop.id, { adresse: ancienne }).then(() => onRecharger()).catch(() => undefined));
    } catch (e) {
      setErreur(networkErrorMessage(e));
    } finally {
      setEnvoi(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[75] flex items-end justify-center bg-marine/60 sm:items-center" role="dialog" aria-modal="true" aria-labelledby="correction-adresse-titre">
      <section className="flex max-h-[92dvh] w-full max-w-lg flex-col gap-3 overflow-y-auto rounded-t-3xl bg-surface p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] shadow-pop sm:rounded-3xl">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 id="correction-adresse-titre" className="font-display text-xl font-bold">Corriger l&apos;adresse</h2>
            <p className="text-sm text-navy/60">Choisissez une suggestion : l&apos;adresse est remplacée et localisée de nouveau, sans quitter GO.</p>
          </div>
          <button type="button" className="btn-ghost !px-2 !py-1" onClick={onFermer} aria-label="Fermer">
            ✕
          </button>
        </div>
        <AdresseInput value={adresse} autoFocus biais={position ?? depot} onChange={setAdresse} onChoisir={(sug) => { setAdresse(sug.adresse); void enregistrer(sug.adresse); }} />
        {erreur && (
          <p role="alert" className="text-sm font-semibold text-orange-ink">
            {erreur}
          </p>
        )}
        <button type="button" className="btn-primary min-h-[48px] justify-center !py-3 text-base" disabled={envoi || inchangee || adresse.trim().length < 5} onClick={() => void enregistrer()}>
          {envoi ? "Enregistrement…" : "Enregistrer l'adresse"}
        </button>
      </section>
    </div>
  );
}

/**
 * Ajout d'une adresse oubliée pendant la tournée : recherche (annuaire,
 * BAN, établissements par leur nom), type d'arrêt, puis création via
 * POST /api/colis/arrets (rangement automatique dans le village) et
 * placement : au meilleur endroit parmi les restants (par défaut),
 * ré-optimisation des restants depuis la position, ou en fin de tournée.
 */
function AjoutAdresse({
  run,
  stops,
  position,
  onFermer,
  onAjoute,
  onReoptimiser,
}: {
  run: Run;
  stops: Stop[];
  position: Point | null;
  onFermer: () => void;
  /** `arretId` : arrêt créé, affiché dès le rechargement de la tournée. */
  onAjoute: (texte: string, ok: boolean, arretId?: string) => Promise<void>;
  onReoptimiser: () => Promise<void>;
}) {
  const [adresse, setAdresse] = useState("");
  const [etablissement, setEtablissement] = useState<SuggestionAdresse | null>(null);
  const [type, setType] = useState<TypeArret>("livraison");
  const [destinataire, setDestinataire] = useState("");
  const [telephone, setTelephone] = useState("");
  const [relais, setRelais] = useState("");
  const [colis, setColis] = useState("1");
  const [placement, setPlacement] = useState<Placement>("meilleur");
  /** Créneau du jour choisi avant l'ajout ; « Aucun » par défaut. */
  const [creneau, setCreneau] = useState<ChoixCreneau>(CRENEAU_AUCUN);
  const ouverture = useHorairesOuverture(adresse, true);
  const [envoi, setEnvoi] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const biais = position ?? (run.start_lat !== null && run.start_lng !== null ? { lat: Number(run.start_lat), lng: Number(run.start_lng) } : null);

  async function ajouter() {
    if (adresse.trim().length < 5) return setErreur("Saisissez une adresse (5 caractères au moins).");
    const choix = validerChoix(creneau);
    if (!choix.ok) return setErreur(choix.erreur);
    setEnvoi(true);
    setErreur(null);
    try {
      const corps = JSON.stringify({
          run_id: run.id,
          adresse: adresse.trim(),
          type,
          destinataire: destinataire.trim() || etablissement?.nom || null,
          telephone: telephone.trim() || null,
          creneau: choix.creneau,
          ...(type === "point_relais" ? { relais: relais.trim() || etablissement?.nom || null, colis: Math.max(0, Math.min(500, Number(colis) || 0)) } : {}),
          etablissement: etablissement && etablissement.adresse === adresse ? { nom: etablissement.nom ?? etablissement.adresse, lat: etablissement.lat, lng: etablissement.lng } : null,
      });
      let r: { stop?: Stop; grouped?: boolean; duplicate?: boolean; message?: string; village?: { nom: string; horsTournee: boolean } | null };
      try {
        r = await api<typeof r>("/api/colis/arrets", { method: "POST", body: corps });
      } catch (e) {
        if (!isNetworkFailure(e)) throw e;
        // Pas de réseau : l'adresse est gardée sur le téléphone et ajoutée dès le retour du réseau.
        await enqueueOfflineMutation("/api/colis/arrets", { method: "POST", body: corps });
        return void (await onAjoute("Pas de réseau : l'adresse est conservée et sera ajoutée dès que le réseau revient.", true));
      }
      if (r.duplicate) return void (await onAjoute(r.message ?? "Déjà dans la tournée.", false));
      const village = r.village ? ` (${r.village.horsTournee ? `${r.village.nom}, hors tournée` : r.village.nom})` : "";
      if (r.grouped || !r.stop) return void (await onAjoute(`Ajouté à l'arrêt déjà prévu à cette adresse${village}.`, true));
      let texte = `Adresse ajoutée${village}`;
      if (placement === "optimiser") {
        await onReoptimiser();
        return void (await onAjoute(`${texte} ; ordre des arrêts restants recalculé.`, true, r.stop.id));
      }
      if (placement === "meilleur") {
        const ins = meilleureInsertion(stops, r.stop, position);
        if (ins) {
          await api(`/api/colis/arrets/${r.stop.id}`, { method: "PATCH", body: JSON.stringify({ run_id: run.id, deposer: ins.cible }) });
          texte += ins.rang === 0 ? " : c'est votre prochain arrêt." : ` : placée au meilleur endroit (≈ ${ins.detourKm.toLocaleString("fr-FR")} km de détour).`;
        } else texte += " en fin de tournée (adresse non localisée).";
      } else texte += " en fin de tournée.";
      await onAjoute(texte, true, r.stop.id);
    } catch (e) {
      setErreur(networkErrorMessage(e));
    } finally {
      setEnvoi(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[75] flex items-end justify-center bg-marine/60 sm:items-center" role="dialog" aria-modal="true" aria-labelledby="ajout-adresse-titre">
      <section className="flex max-h-[92dvh] w-full max-w-lg flex-col gap-3 overflow-y-auto rounded-t-3xl bg-surface p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] shadow-pop sm:rounded-3xl">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 id="ajout-adresse-titre" className="font-display text-xl font-bold">Ajouter une adresse</h2>
            <p className="text-sm text-navy/60">Adresse oubliée : elle est rangée dans son village puis placée dans la tournée en cours.</p>
          </div>
          <button type="button" className="btn-ghost !px-2 !py-1" onClick={onFermer} aria-label="Fermer">
            ✕
          </button>
        </div>
        <ChoixTypeArret value={type} onChange={setType} />
        <AdresseInput
          value={adresse}
          autoFocus
          biais={biais}
          onChange={(v) => {
            setAdresse(v);
            if (etablissement && v !== etablissement.adresse) setEtablissement(null);
          }}
          onChoisir={(sug) => {
            setEtablissement(sug);
            if (type === "point_relais" && sug.nom && !relais) setRelais(sug.nom);
          }}
        />
        {etablissement?.nom && <p className="-mt-1 text-xs font-semibold text-teal-ink">Établissement : {etablissement.nom}</p>}
        {type === "point_relais" ? (
          <div className="grid grid-cols-[2fr_1fr] gap-2">
            <input className="input" value={relais} onChange={(e) => setRelais(e.target.value)} placeholder="Nom du relais" list="go-reseaux-relais" aria-label="Nom du point relais" />
            <datalist id="go-reseaux-relais">
              {RESEAUX_RELAIS.map((r) => (
                <option key={r} value={r} />
              ))}
            </datalist>
            <input className="input" inputMode="numeric" value={colis} onChange={(e) => setColis(e.target.value.replace(/\D/g, ""))} aria-label="Colis à déposer" placeholder="Colis" />
          </div>
        ) : (
          <input className="input" value={destinataire} onChange={(e) => setDestinataire(e.target.value)} placeholder={type === "ramasse" ? "Expéditeur (facultatif)" : "Destinataire (facultatif)"} aria-label="Destinataire" />
        )}
        <input className="input" type="tel" inputMode="tel" value={telephone} onChange={(e) => setTelephone(e.target.value)} placeholder="Téléphone (facultatif)" aria-label="Téléphone" />
        <fieldset className="flex flex-col gap-1.5 text-sm">
          <legend className="mb-1 text-xs font-semibold uppercase tracking-wide text-navy/55">Place dans la tournée</legend>
          {(
            [
              ["meilleur", "Au meilleur endroit parmi les arrêts restants (recommandé)"],
              ["optimiser", "Recalculer l'ordre de tous les arrêts restants depuis ma position"],
              ["fin", "En fin de tournée"],
            ] as const
          ).map(([v, libelle]) => (
            <label key={v} className="flex items-start gap-2">
              <input type="radio" name="go-placement" className="mt-1" checked={placement === v} onChange={() => setPlacement(v)} />
              <span>{libelle}</span>
            </label>
          ))}
        </fieldset>
        <EtapeCreneau
          idBase="go-creneau"
          value={creneau}
          onChange={(c) => {
            setCreneau(c);
            setErreur(null);
            // « Au meilleur endroit » ne regarde que le détour : avec un créneau,
            // on propose de recalculer l'ordre (l'optimisation respecte le créneau).
            if (c.cle !== "aucun" && c.cle !== "ouverture" && (creneau.cle === "aucun" || creneau.cle === "ouverture") && placement === "meilleur") setPlacement("optimiser");
          }}
          fiche={ouverture.fiche}
          chargement={ouverture.chargement}
          ymd={run.run_date ?? dateParis(new Date())}
        />
        {erreur && <p className="rounded-lg bg-orange/10 px-3 py-2 text-sm font-semibold text-orange-ink">{erreur}</p>}
        <button type="button" className="btn-primary justify-center !py-3.5 text-base" disabled={envoi || adresse.trim().length < 5 || !validerChoix(creneau).ok} onClick={ajouter}>
          {envoi ? "Ajout…" : "Ajouter à la tournée"}
        </button>
      </section>
    </div>
  );
}

/**
 * Menu rapide d'un arrêt (appui long sur sa ligne ou son repère, ou « ⋯ ») :
 * toutes les actions de l'arrêt en un seul écran, sans confirmation — retirer
 * se défait avec « Annuler ». Zones tactiles de 48 px.
 */
function MenuRapideArret({
  stop: s,
  numero,
  modeSimple,
  peutPasser,
  lecture,
  horaires,
  onFermer,
  onAppel,
  onTelephone,
  onHoraires,
  onLivre,
  onNonLivre,
  onCorriger,
  onRetirer,
  onPasser,
  onContact,
  onFiche,
}: {
  stop: Stop;
  numero: number;
  modeSimple: boolean;
  peutPasser: boolean;
  /** Tournée clôturée : consultation (appel, horaires, fiche, navigation externe). */
  lecture: boolean;
  horaires: Horaires;
  onFermer: () => void;
  onAppel: (s: Stop) => void;
  onTelephone: (s: Stop) => void;
  onHoraires: (s: Stop) => void;
  onLivre: (s: Stop) => void;
  onNonLivre: (s: Stop) => void;
  onCorriger: (s: Stop) => void;
  onRetirer: (s: Stop) => void;
  onPasser: (s: Stop) => void;
  onContact: (s: Stop, champ: ChampContact, valeur: boolean) => void;
  onFiche: (s: Stop) => void;
}) {
  const agir = (f: (s: Stop) => void) => () => {
    onFermer();
    f(s);
  };
  const action = "flex min-h-[48px] items-center rounded-xl bg-navy/[0.05] px-4 text-left text-sm font-semibold text-navy";
  const lien = "btn-secondary min-h-[48px] justify-center !px-2 !py-2 text-sm";
  return (
    <div className="fixed inset-0 z-[75] flex items-end justify-center bg-marine/60 sm:items-center" role="dialog" aria-modal="true" aria-labelledby="menu-arret-titre" onClick={onFermer}>
      <section className="flex max-h-[85dvh] w-full max-w-md flex-col gap-2 overflow-y-auto rounded-t-3xl bg-surface p-4 pb-[max(1rem,env(safe-area-inset-bottom))] shadow-pop sm:rounded-3xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3">
          <h2 id="menu-arret-titre" className="min-w-0 font-display text-base font-bold leading-snug">
            Arrêt {numero} · {s.address}
          </h2>
          <button type="button" className="btn-ghost min-h-[44px] !px-2" onClick={onFermer} aria-label="Fermer">
            ✕
          </button>
        </div>
        {!lecture && (
          <div className="grid grid-cols-2 gap-2">
            <button type="button" className="btn-primary min-h-[48px] justify-center" onClick={agir(onLivre)}>
              <IconCheck className="h-5 w-5" /> {libelleLivre(modeSimple, s)}
            </button>
            <button type="button" className="btn-secondary min-h-[48px] justify-center text-orange-ink" onClick={agir(onNonLivre)}>
              <IconX className="h-5 w-5" /> Non livré
            </button>
          </div>
        )}
        {s.phone ? (
          <a href={lienTel(s.phone)} onClick={() => { onFermer(); onAppel(s); }} className={`${action} gap-2 text-teal-ink`}>
            <IconPhone className="h-4 w-4" /> Appeler {s.recipient ?? ""}
          </a>
        ) : (
          !lecture && (
            <button type="button" className={`${action} gap-2`} onClick={agir(onTelephone)}>
              <IconPhone className="h-4 w-4" /> Ajouter le numéro
            </button>
          )
        )}
        {!lecture && (
          <div className="flex flex-wrap gap-1.5">
            <PastillesContact stop={s} onChange={(champ, v) => onContact(s, champ, v)} />
          </div>
        )}
        <button type="button" className={action} onClick={agir(onHoraires)}>
          🕘 Horaires
          <BadgeHoraires stop={s} fenetres={horaires.fenetres.get(s.id) ?? null} passage={horaires.passages.get(s.id)} />
        </button>
        <button type="button" className={action} onClick={agir(onFiche)}>
          Fiche de l&apos;arrêt
        </button>
        {!lecture && (
          <button type="button" className={action} onClick={agir(onCorriger)}>
            ✏️ Modifier l&apos;adresse
          </button>
        )}
        {!lecture && peutPasser && (
          <button type="button" className={action} onClick={agir(onPasser)}>
            Passer à plus tard
          </button>
        )}
        <div className="grid grid-cols-2 gap-1.5">
          {s.phone && (
            <a href={lienSms(s.phone, SMS_ARRIVEE)} className={lien}>
              <IconMessage className="h-4 w-4" /> SMS « j&apos;arrive »
            </a>
          )}
          <a href={waze(s)} target="_blank" rel="noreferrer" className={lien}>
            <IconNavigation className="h-4 w-4" /> Waze
          </a>
          <a href={gmaps(s)} target="_blank" rel="noreferrer" className={lien}>
            <IconMapPin className="h-4 w-4" /> Google Maps
          </a>
        </div>
        {!lecture && (
          <button type="button" className={`${action} text-orange-ink`} onClick={agir(onRetirer)}>
            Retirer cette adresse
          </button>
        )}
      </section>
    </div>
  );
}
