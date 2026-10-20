"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as PointerEventReact } from "react";
import "maplibre-gl/dist/maplibre-gl.css";
import type { GeoJSONSource, Map as CarteMap, Marker, StyleSpecification } from "maplibre-gl";
import { IconCheck, IconMapPin, IconMessage, IconNavigation, IconPhone, IconPointRelais, IconRamasse, IconX } from "@/components/layout/icons";
import { BadgeArret, ChoixTypeArret, EncocheArret, bordureArret } from "@/components/colis/Ramasse";
import { BadgeSansTelephone } from "@/components/colis/AlertesArret";
import { BadgeHoraires, type useHoraires } from "@/components/colis/HorairesSheet";
import { ArretTriable, BoutonPoignee, ZoneTri, type Poignee } from "@/components/colis/Triable";
import { AdresseInput } from "@/components/colis/AdresseInput";
import { pastille, marqueurVehicule, etatVehicule } from "@/components/colis/marqueurs";
import { api, gmaps, waze, SMS_ARRIVEE, type Liste, type Run, type Stop } from "@/components/colis/commun";
import { lienSms, lienTel } from "@/lib/colis/telephone";
import { formatPoids } from "@/lib/colis/poids";
import { estPointRelais, estRamasse, libelleFait, type TypeArret } from "@/lib/colis/livraison";
import { RESEAUX_RELAIS } from "@/lib/colis/relais";
import { heureFin, type Avancement } from "@/lib/colis/estimation";
import { nomGroupe, grouperParListe } from "@/lib/colis/listes";
import type { Itineraire, Point } from "@/lib/colis/itineraire";
import type { CibleDepot } from "@/lib/colis/reordonner";
import type { SuggestionAdresse } from "@/lib/colis/recherche-adresses";
import { networkErrorMessage } from "@/lib/utils/network-error";
import { COULEURS_CARTE, styliserGodac, type StyleCarte } from "@/lib/colis/style-carte";
import { ECART_MAX_M, RAYON_ARRIVEE_M, arretApresCloture, arretSuivi, distanceM, doitRecalculer, formatDistance, formatDuree, meilleureInsertion, projeterSurTrace, resteSurTrace } from "@/lib/colis/navigation";
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
  onToast: (t: { ok: boolean; text: string }) => void;
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
  /** Suite complète de la tournée (heure de fin estimée de l'app chauffeur). */
  onItineraire: (it: Itineraire | null) => void;
  onPosition: (p: Point) => void;
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
  const [feuille, setFeuille] = useState<"reduit" | "liste">("reduit");
  const [position, setPosition] = useState<Point | null>(null);
  const [erreurGps, setErreurGps] = useState<string | null>(null);
  const [vue, setVue] = useState<Vue>("ensemble");
  const [voix, setVoix] = useState(false);
  const [trajet, setTrajet] = useState<Itineraire | null>(null);
  const [ajout, setAjout] = useState(false);
  const [recherche, setRecherche] = useState("");

  const restants = useMemo(() => stops.filter((s) => s.status === "pending"), [stops]);
  const cible = arretSuivi(stops, selection);
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
        m.addLayer({ id: "suite", type: "line", source: "suite", paint: { "line-color": COULEURS_CARTE.marine, "line-width": 3, "line-opacity": 0.35, "line-dasharray": [1.5, 1.5] }, layout: { "line-cap": "round", "line-join": "round" } });
        m.addLayer({ id: "trajet-bord", type: "line", source: "trajet", paint: { "line-color": COULEURS_CARTE.marine, "line-width": 12, "line-opacity": 0.85 }, layout: { "line-cap": "round", "line-join": "round" } });
        m.addLayer({ id: "trajet", type: "line", source: "trajet", paint: { "line-color": COULEURS_CARTE.teal, "line-width": 7 }, layout: { "line-cap": "round", "line-join": "round" } });
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
      m.on("dragstart", quitterSuivi);
      m.on("zoomstart", quitterSuivi);
      m.on("rotatestart", quitterSuivi);
      m.on("pitchstart", quitterSuivi);
      // Boussole : le « N » pointe vers le nord de la carte.
      m.on("rotate", () => {
        if (boussoleRef.current) boussoleRef.current.style.transform = `rotate(${-m.getBearing()}deg)`;
      });
      carte.current = m;
    })();
    return () => {
      annule = true;
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

  function dessiner(e: EtatCamera) {
    moi.current?.setLngLat([e.lng, e.lat]).setRotation(e.cap);
    const m = carte.current;
    if (m && vueRef.current === "conduite" && performance.now() > transitionJusqua.current) {
      m.jumpTo({ center: [e.lng, e.lat], bearing: e.cap, zoom: e.zoom, pitch: PITCH_CONDUITE, padding: (margesCache.current ??= margesC()) });
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
      el.addEventListener("click", (e) => {
        e.stopPropagation();
        if (s.status === "pending") {
          setSelection(s.id);
          setFeuille("reduit");
        }
      });
      marqueurs.current.push(new maplibregl.Marker({ element: el }).setLngLat([Number(s.lng), Number(s.lat)]).addTo(m));
    });
  }, [prete, stops, cible?.id, run.start_lat, run.start_lng, run.start_label]);

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
          onPosition(pos);
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
  const tracer = useCallback(
    async (versId: string, depuis: Point | null) => {
      if (enCalcul.current) return;
      enCalcul.current = true;
      dernierCalcul.current = Date.now();
      cibleTracee.current = versId;
      traceDepuisGps.current = Boolean(depuis);
      try {
        const it = await api<Itineraire>("/api/colis/itineraire", { method: "POST", body: JSON.stringify({ run_id: run.id, depuis, cible: versId }) });
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
    [run.id],
  );

  useEffect(() => {
    if (!prete) return;
    if (!cible) {
      cibleTracee.current = null;
      setTrajet(null);
      (carte.current?.getSource("trajet") as GeoJSONSource | undefined)?.setData(VIDE);
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
  }, [hauteur]);

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

  // ——— Indications de direction (manœuvres OSRM) ———
  const trajetValide = trajet && cible && cibleTracee.current === cible.id ? trajet : null;
  const placees = useMemo(() => (trajetValide?.manoeuvres?.length && trajetValide.ligne.length > 1 ? placerManoeuvres(trajetValide.ligne, trajetValide.manoeuvres) : []), [trajetValide]);
  const projection = placees.length && position && trajetValide ? projeterSurTrace(position, trajetValide.ligne) : null;
  // Hors du tracé (en attendant le recalcul) : pas d'indication trompeuse.
  const courante = projection && projection.ecartM <= ECART_MAX_M * 1.5 ? manoeuvreCourante(placees, projection.abscisseM) : null;
  const manoeuvre = courante ? placees[courante.index]! : null;
  const suivante = courante ? (placees[courante.index + 1] ?? null) : null;

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
  const indexCible = cible ? restants.indexOf(cible) : -1;
  useEffect(() => {
    const el = defile.current;
    if (!el || indexCible < 0 || feuille !== "reduit") return;
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
      if (!el || Date.now() - defilementAuto.current < 600) return;
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
      if (s && s.id !== cible?.id) setSelection(s.id);
    }, 140);
  }

  // Tirer la feuille vers le haut (liste complète) ou vers le bas (cartes).
  const glisse = useRef<{ y: number } | null>(null);
  function poigneeBas(e: PointerEventReact) {
    glisse.current = { y: e.clientY };
  }
  function poigneeHaut(e: PointerEventReact) {
    const dy = glisse.current ? e.clientY - glisse.current.y : 0;
    glisse.current = null;
    if (dy < -30) setFeuille("liste");
    else if (dy > 30) setFeuille("reduit");
    else setFeuille((f) => (f === "liste" ? "reduit" : "liste"));
  }

  // ——— Liste complète (recherche, glisser-déposer) ———
  const terme = recherche.trim().toLocaleLowerCase("fr-FR");
  const correspond = (st: Stop) =>
    [st.address, st.recipient ?? "", st.phone ?? "", st.parcel_code ?? "", st.relay_name ?? "", st.business_name ?? "", lists.find((l) => l.id === st.list_id)?.name ?? ""].some((v) =>
      v.toLocaleLowerCase("fr-FR").includes(terme),
    );
  const visibles = terme ? restants.filter(correspond) : restants;
  const triActif = !fige && !terme && restants.length > 1;
  const ordreTri = restants.map((s) => ({ id: s.id, list_id: s.list_id ?? null }));
  const groupes = grouperParListe(stops, lists);
  const multi = groupes.length > 1 || groupes[0]?.liste != null;
  const nomListe = (s: Stop) => {
    const g = groupes.find((x) => x.arrets.includes(s));
    return g ? nomGroupe(g) : null;
  };

  function choisirDansListe(s: Stop) {
    setSelection(s.id);
    setFeuille("reduit");
  }

  const faits = stops.length - restants.length;

  return (
    <div className="fixed inset-0 z-40 flex flex-col overflow-hidden bg-paper" aria-label="GO Navigation">
      <style>{`.go-nav .maplibregl-ctrl-attrib{font-size:10px;background:rgba(246,247,251,.75)!important;color:#5A6378}.go-nav .maplibregl-ctrl-attrib a{color:#5A6378}.go-nav .maplibregl-ctrl-bottom-right{bottom:var(--go-feuille,300px);transition:bottom .3s}`}</style>
      <div className="go-nav absolute inset-0" style={{ "--go-feuille": `${hauteur}px` } as CSSProperties}>
        <div ref={conteneur} className="h-full w-full" role="region" aria-label="Carte de navigation" />
      </div>

      {/* Bandeau de guidage */}
      <div className="pointer-events-none absolute inset-x-0 top-0 z-10 px-3 pt-[max(0.75rem,env(safe-area-inset-top))]">
        <div ref={bandeauRef} className="pointer-events-auto mx-auto flex max-w-xl items-stretch gap-2">
          <button type="button" onClick={p.onFermer} className="flex w-12 shrink-0 items-center justify-center rounded-2xl bg-marine text-2xl text-white shadow-pop" aria-label="Retour à la liste des arrêts">
            ‹
          </button>
          <div className="min-w-0 flex-1 rounded-2xl bg-marine px-4 py-2.5 text-white shadow-pop" aria-live="polite">
            {fige ? (
              <p className="py-1 text-sm font-semibold">Tournée clôturée : consultation seulement.</p>
            ) : cible && manoeuvre && courante && !arrive ? (
              <>
                <div className="flex items-center gap-3">
                  <FlecheManoeuvre picto={pictogramme(manoeuvre)} sortie={manoeuvre.sortie} className="h-12 w-12 shrink-0 text-teal" />
                  <div className="min-w-0">
                    <p className="font-display text-2xl font-bold tabular-nums leading-tight text-teal">{formatDistanceManoeuvre(courante.distanceM)}</p>
                    <p className="line-clamp-2 text-sm font-semibold leading-snug">{texteManoeuvre(manoeuvre)}</p>
                  </div>
                </div>
                {suivante && (
                  <p className="mt-1.5 flex items-center gap-1.5 border-t border-white/15 pt-1.5 text-xs text-white/75">
                    <FlecheManoeuvre picto={pictogramme(suivante)} sortie={suivante.sortie} className="h-4 w-4 shrink-0 text-white/75" />
                    <span className="truncate">Puis : {texteManoeuvre(suivante)}</span>
                  </p>
                )}
                <p className="mt-1 truncate text-[11px] text-white/70">
                  {formatDistance(distanceAffichee)}
                  {dureeAffichee !== null && ` · ${formatDuree(dureeAffichee)}`} · Arrêt {numero(cible)} · {cible.address}
                </p>
              </>
            ) : cible ? (
              <>
                <p className="flex items-baseline gap-2">
                  <span className="font-display text-2xl font-bold tabular-nums text-teal">{arrive ? "Arrivé" : formatDistance(distanceAffichee)}</span>
                  {!arrive && dureeAffichee !== null && <span className="text-sm text-white/80">· {formatDuree(dureeAffichee)}</span>}
                  {trajet?.approx && !arrive && <span className="text-[11px] text-white/60">(estimation)</span>}
                </p>
                <p className="truncate text-xs text-white/80">
                  Arrêt {numero(cible)} · {cible.address}
                </p>
              </>
            ) : (
              <p className="py-1 text-sm font-semibold">Tous les arrêts sont faits 🎉</p>
            )}
            <p className="mt-1 text-[11px] text-white/60">
              {faits}/{stops.length} faits
              {avancement.finEstimee && ` · fin ≈ ${heureFin(avancement.finEstimee)}`}
            </p>
          </div>
        </div>
        {erreurGps ? (
          <p className="pointer-events-auto mx-auto mt-2 max-w-xl rounded-xl bg-orange px-3 py-2 text-xs font-semibold text-white shadow-pop">{erreurGps}</p>
        ) : (
          !position && <p className="mx-auto mt-2 w-fit max-w-xl rounded-full bg-surface/90 px-3 py-1 text-[11px] font-semibold text-navy/70 shadow-card">Vue d&apos;ensemble : en attente de la position GPS…</p>
        )}
        <div className="pointer-events-auto mx-auto mt-2 flex max-w-xl flex-wrap justify-end gap-2">
          {!fige && run.status === "in_progress" && (
            <button type="button" onClick={() => setAjout(true)} className="rounded-full bg-teal px-4 py-2.5 text-sm font-bold text-marine shadow-pop">
              + Adresse
            </button>
          )}
          <button type="button" onClick={toutVoir} className="rounded-full bg-surface px-3 py-2.5 text-xs font-semibold text-navy shadow-pop">
            Toute la tournée
          </button>
          {vue === "conduite" ? (
            <button type="button" onClick={voirTrajet} className="rounded-full bg-surface px-3 py-2.5 text-xs font-semibold text-navy shadow-pop">
              Vue d&apos;ensemble
            </button>
          ) : (
            <button
              type="button"
              onClick={recentrer}
              disabled={!position}
              className="rounded-full bg-marine px-3 py-2.5 text-xs font-semibold text-white shadow-pop disabled:opacity-50"
              title={position ? undefined : "En attente de la position GPS"}
            >
              Conduite
            </button>
          )}
        </div>
        <div className="pointer-events-auto mx-auto mt-2 flex max-w-xl flex-col items-end gap-2">
          <button
            type="button"
            onClick={basculerVoix}
            className={`flex h-11 w-11 items-center justify-center rounded-full shadow-pop ${voix ? "bg-marine text-teal" : "bg-surface text-navy/70"}`}
            aria-pressed={voix}
            aria-label={voix ? "Couper le guidage vocal" : "Activer le guidage vocal"}
          >
            <IconeHautParleur actif={voix} className="h-5 w-5" />
          </button>
          {vue !== "ensemble" && (
            <button type="button" onClick={voirTrajet} className="flex h-11 w-11 items-center justify-center rounded-full bg-surface shadow-pop" aria-label="Nord en haut (vue d'ensemble)">
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

      {/* Recentrer (le chauffeur a déplacé la carte) */}
      {vue === "libre" && position && (
        <button
          type="button"
          onClick={recentrer}
          className="absolute left-3 z-10 flex items-center gap-1.5 rounded-full bg-marine px-4 py-3 text-sm font-bold text-white shadow-pop"
          style={{ bottom: `${Math.round(Math.min(hauteur, (typeof window !== "undefined" ? window.innerHeight : 800) * 0.6)) + 12}px` }}
        >
          <IconNavigation className="h-4 w-4 text-teal" /> Recentrer
        </button>
      )}

      {/* Feuille de la tournée */}
      <div
        ref={feuilleRef}
        className={`absolute inset-x-0 bottom-0 z-20 flex flex-col rounded-t-3xl bg-paper shadow-pop transition-[max-height] duration-300 ${feuille === "liste" ? "max-h-[85dvh]" : "max-h-[60dvh]"}`}
      >
        <button
          type="button"
          className="flex w-full touch-none flex-col items-center gap-1 pb-1 pt-2"
          onPointerDown={poigneeBas}
          onPointerUp={poigneeHaut}
          aria-expanded={feuille === "liste"}
          aria-label={feuille === "liste" ? "Réduire la liste des arrêts" : "Voir tous les arrêts"}
        >
          <span className="h-1.5 w-10 rounded-full bg-navy/20" aria-hidden="true" />
          <span className="text-[11px] font-semibold uppercase tracking-wide text-navy/55">
            {restants.length} restant{restants.length > 1 ? "s" : ""}
            {avancement.colisRestants > 0 && ` · ${avancement.colisRestants} colis`} · {feuille === "liste" ? "réduire ▾" : "tous les arrêts ▴"}
          </span>
        </button>

        {feuille === "reduit" ? (
          restants.length ? (
            <div
              ref={defile}
              onScroll={auDefilement}
              className="flex snap-x snap-mandatory gap-3 overflow-x-auto px-[6%] pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-1 [scrollbar-width:none]"
              aria-label="Arrêts à faire (glisser pour passer d'un arrêt à l'autre)"
            >
              {restants.map((s) => (
                <CarteArret
                  key={s.id}
                  stop={s}
                  numero={numero(s)}
                  total={stops.length}
                  suivi={s.id === cible?.id}
                  prochain={s.id === restants[0]?.id}
                  nomListe={multi ? nomListe(s) : null}
                  horaires={horaires}
                  fige={fige}
                  plusieurs={restants.length > 1}
                  busy={p.busy}
                  onTerminer={p.onTerminer}
                  onCloture={p.onCloture}
                  onTelephone={p.onTelephone}
                  onHoraires={p.onHoraires}
                  onFiche={p.onFiche}
                  onPasser={p.onPasser}
                />
              ))}
            </div>
          ) : (
            <div className="flex flex-col items-center gap-3 px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-2 text-center">
              <p className="font-display text-lg font-bold">Tournée terminée 🎉</p>
              <button type="button" className="btn-primary !py-3" onClick={p.onFermer}>
                {fige ? "Retour à la tournée" : "Retour à la liste pour clôturer"}
              </button>
            </div>
          )
        ) : (
          <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
            <div className="flex gap-2">
              <label className="relative block flex-1">
                <span className="sr-only">Rechercher dans la tournée</span>
                <input className="input" type="search" value={recherche} onChange={(e) => setRecherche(e.target.value)} placeholder="Adresse, client, n° de colis…" />
              </label>
              {!fige && (
                <button type="button" className="btn-secondary shrink-0 !px-3 text-xs" disabled={p.busy} onClick={() => void p.onReoptimiser()}>
                  {p.busy ? "Calcul…" : "Recalculer l'ordre"}
                </button>
              )}
            </div>
            {terme && visibles.length === 0 && <p className="text-center text-sm text-navy/60">Aucun arrêt restant ne correspond.</p>}
            <ZoneTri ordre={ordreTri} onDeposer={(id, c) => void p.onDeposer(id, c)} actif={triActif}>
              <ol className="flex flex-col gap-2">
                {visibles.map((s) => {
                  const rendu = (props: { ref?: (el: HTMLElement | null) => void; style?: CSSProperties } | null, poignee: Poignee | null) => (
                    <li
                      ref={props?.ref}
                      style={props?.style}
                      className={`relative flex items-center gap-2.5 overflow-hidden rounded-xl bg-surface py-2.5 pr-2 shadow-card ${s.id === cible?.id ? "ring-2 ring-teal" : ""} ${estRamasse(s) || estPointRelais(s) ? "pl-4" : "pl-2.5"}`}
                    >
                      <EncocheArret stop={s} />
                      {poignee && <BoutonPoignee poignee={poignee} libelle={s.recipient ?? s.address} />}
                      <button type="button" className="flex min-w-0 flex-1 items-center gap-2.5 text-left" onClick={() => choisirDansListe(s)} aria-label={`Naviguer vers l'arrêt ${numero(s)} — ${s.address}`}>
                        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-marine text-xs font-semibold tabular-nums text-teal">{numero(s)}</span>
                        <span className="min-w-0">
                          {(estRamasse(s) || estPointRelais(s) || !s.phone) && (
                            <span className="mb-1 flex flex-wrap gap-1">
                              <BadgeArret stop={s} />
                              {!s.phone && <BadgeSansTelephone />}
                            </span>
                          )}
                          <span className="block text-sm font-semibold leading-snug">{s.address}</span>
                          <span className="block truncate text-xs text-navy/60">{[multi && nomListe(s), s.recipient, s.parcel_count > 1 && `${s.parcel_count} colis`].filter(Boolean).join(" · ") || " "}</span>
                          <BadgeHoraires stop={s} fenetres={horaires.fenetres.get(s.id) ?? null} passage={horaires.passages.get(s.id)} />
                        </span>
                      </button>
                      {!fige && (
                        <button type="button" className="shrink-0 rounded-full border border-navy/15 px-2.5 py-2 text-xs font-semibold text-navy/80" onClick={() => p.onCloture(s, "choix")} aria-label={`Clôturer ${s.recipient ?? s.address}`}>
                          Clôturer
                        </button>
                      )}
                      {s.phone && (
                        <a href={lienTel(s.phone)} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-teal/15 text-teal-ink" aria-label={`Appeler ${s.recipient ?? s.address}`}>
                          <IconPhone className="h-4 w-4" />
                        </a>
                      )}
                    </li>
                  );
                  return triActif ? <ArretTriable key={s.id} id={s.id} rendu={rendu} /> : <Fragment key={s.id}>{rendu(null, null)}</Fragment>;
                })}
              </ol>
            </ZoneTri>
            {faits > 0 && (
              <button type="button" className="btn-ghost justify-center text-sm text-navy/60" onClick={p.onFermer}>
                {faits} arrêt{faits > 1 ? "s" : ""} terminé{faits > 1 ? "s" : ""} : voir dans la liste
              </button>
            )}
          </div>
        )}
      </div>

      {ajout && (
        <AjoutAdresse
          run={run}
          stops={stops}
          position={position}
          onFermer={() => setAjout(false)}
          onAjoute={async (texte, ok) => {
            setAjout(false);
            await p.onRecharger();
            p.onToast({ ok, text: texte });
          }}
          onReoptimiser={p.onReoptimiser}
        />
      )}
    </div>
  );
}

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

/** Carte d'un arrêt dans la feuille : adresse, client, horaires et toutes les actions. */
function CarteArret({
  stop: s,
  numero,
  total,
  suivi,
  prochain,
  nomListe,
  horaires,
  fige,
  plusieurs,
  busy,
  onTerminer,
  onCloture,
  onTelephone,
  onHoraires,
  onFiche,
  onPasser,
}: {
  stop: Stop;
  numero: number;
  total: number;
  suivi: boolean;
  prochain: boolean;
  nomListe: string | null;
  horaires: Horaires;
  fige: boolean;
  plusieurs: boolean;
  busy: boolean;
} & Pick<GoNavigationProps, "onTerminer" | "onCloture" | "onTelephone" | "onHoraires" | "onFiche" | "onPasser">) {
  return (
    <section
      className={`relative flex w-[88%] max-w-md shrink-0 snap-center flex-col gap-3 overflow-hidden rounded-2xl border-2 bg-surface p-4 shadow-card ${suivi ? bordureArret(s, "border-teal/70") : "border-transparent"}`}
      aria-label={`Arrêt ${numero} sur ${total}${suivi ? ", en cours de navigation" : ""}`}
    >
      <EncocheArret stop={s} large />
      <div>
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs font-semibold uppercase tracking-wide text-teal-ink">
          <BadgeArret stop={s} />
          <span>
            Arrêt {numero} / {total}
            {prochain ? " · prochain" : ""}
            {s.parcel_count > 1 && ` · ${s.parcel_count} colis${estRamasse(s) ? " à ramasser" : estPointRelais(s) ? " à déposer" : ""}`}
            {formatPoids(s.weight_kg) && ` · ${formatPoids(s.weight_kg)}`}
          </span>
        </p>
        {nomListe && <p className="mt-0.5 text-[11px] font-semibold text-navy/55">{nomListe}</p>}
        <p className="mt-1 font-display text-lg font-bold leading-snug">{s.address}</p>
        {(s.recipient || s.business_name) && <p className="text-sm text-navy/75">{[s.business_name, s.recipient].filter(Boolean).join(" · ")}</p>}
        {s.notes && <p className="mt-0.5 line-clamp-2 text-xs text-navy/65">{s.notes}</p>}
        {s.lat === null && <p className="mt-0.5 text-xs font-semibold text-orange-ink">Adresse non localisée : ouvrez-la dans Waze ou Google Maps.</p>}
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <BadgeHoraires stop={s} fenetres={horaires.fenetres.get(s.id) ?? null} passage={horaires.passages.get(s.id)} />
          <button type="button" className="rounded-full bg-navy/[0.05] px-2.5 py-1 text-xs font-semibold" onClick={() => onHoraires(s)}>
            🕘 Horaires
          </button>
          <button type="button" className="rounded-full bg-navy/[0.05] px-2.5 py-1 text-xs font-semibold" onClick={() => onFiche(s)}>
            Fiche
          </button>
        </div>
      </div>

      <div className="grid grid-cols-4 gap-2">
        {s.phone ? (
          <>
            <a href={lienTel(s.phone)} className="btn-secondary col-span-2 justify-center border-teal/70 !px-2 !py-3 text-sm text-teal-ink">
              <IconPhone className="h-4 w-4" /> Appeler
            </a>
            <a href={lienSms(s.phone, SMS_ARRIVEE)} className="btn-secondary justify-center !px-2 !py-3" aria-label="Envoyer un SMS « j'arrive »">
              <IconMessage className="h-4 w-4" />
            </a>
          </>
        ) : (
          <button type="button" className="btn-secondary col-span-3 justify-center !px-2 !py-3 text-sm" disabled={fige} onClick={() => onTelephone(s)}>
            <IconPhone className="h-4 w-4" /> Ajouter le n°
          </button>
        )}
        <details className="relative">
          <summary className="btn-secondary h-full list-none justify-center !px-2 !py-3 [&::-webkit-details-marker]:hidden" aria-label="Ouvrir dans Waze ou Google Maps">
            <IconNavigation className="h-4 w-4" />
          </summary>
          <div className="absolute bottom-full right-0 z-10 mb-2 flex w-44 flex-col gap-1 rounded-xl bg-surface p-2 shadow-pop">
            <a href={waze(s)} target="_blank" rel="noreferrer" className="btn-ghost justify-start !py-2 text-sm">
              <IconNavigation className="h-4 w-4" /> Waze
            </a>
            <a href={gmaps(s)} target="_blank" rel="noreferrer" className="btn-ghost justify-start !py-2 text-sm">
              <IconMapPin className="h-4 w-4" /> Google Maps
            </a>
          </div>
        </details>
      </div>

      {!fige && (
        <div className="grid grid-cols-[2fr_1fr] gap-2">
          <button type="button" className="btn-primary justify-center !py-3.5 text-base" onClick={() => onTerminer(s)}>
            {estRamasse(s) ? <IconRamasse className="h-5 w-5" /> : estPointRelais(s) ? <IconPointRelais className="h-5 w-5" /> : <IconCheck className="h-5 w-5" />} {libelleFait(s)}
          </button>
          <button type="button" className="btn-secondary justify-center !py-3.5 text-orange-ink" onClick={() => onCloture(s, "echec")}>
            <IconX className="h-5 w-5" /> Échec
          </button>
        </div>
      )}
      {!fige && plusieurs && (
        <button type="button" className="btn-ghost -mt-1 justify-center !py-1.5 text-xs text-navy/60" disabled={busy} onClick={() => onPasser(s)}>
          Passer plus tard (en fin de tournée)
        </button>
      )}
    </section>
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
  onAjoute: (texte: string, ok: boolean) => Promise<void>;
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
  const [envoi, setEnvoi] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const biais = position ?? (run.start_lat !== null && run.start_lng !== null ? { lat: Number(run.start_lat), lng: Number(run.start_lng) } : null);

  async function ajouter() {
    if (adresse.trim().length < 5) return setErreur("Saisissez une adresse (5 caractères au moins).");
    setEnvoi(true);
    setErreur(null);
    try {
      const r = await api<{ stop?: Stop; grouped?: boolean; duplicate?: boolean; message?: string; village?: { nom: string; horsTournee: boolean } | null }>("/api/colis/arrets", {
        method: "POST",
        body: JSON.stringify({
          run_id: run.id,
          adresse: adresse.trim(),
          type,
          destinataire: destinataire.trim() || etablissement?.nom || null,
          telephone: telephone.trim() || null,
          ...(type === "point_relais" ? { relais: relais.trim() || etablissement?.nom || null, colis: Math.max(0, Math.min(500, Number(colis) || 0)) } : {}),
          etablissement: etablissement && etablissement.adresse === adresse ? { nom: etablissement.nom ?? etablissement.adresse, lat: etablissement.lat, lng: etablissement.lng } : null,
        }),
      });
      if (r.duplicate) return void (await onAjoute(r.message ?? "Déjà dans la tournée.", false));
      const village = r.village ? ` (${r.village.horsTournee ? "hors tournée" : r.village.nom})` : "";
      if (r.grouped || !r.stop) return void (await onAjoute(`Ajouté à l'arrêt déjà prévu à cette adresse${village}.`, true));
      let texte = `Adresse ajoutée${village}`;
      if (placement === "optimiser") {
        await onReoptimiser();
        return void (await onAjoute(`${texte} ; ordre des arrêts restants recalculé.`, true));
      }
      if (placement === "meilleur") {
        const ins = meilleureInsertion(stops, r.stop, position);
        if (ins) {
          await api(`/api/colis/arrets/${r.stop.id}`, { method: "PATCH", body: JSON.stringify({ run_id: run.id, deposer: ins.cible }) });
          texte += ins.rang === 0 ? " : c'est votre prochain arrêt." : ` : placée au meilleur endroit (≈ ${ins.detourKm.toLocaleString("fr-FR")} km de détour).`;
        } else texte += " en fin de tournée (adresse non localisée).";
      } else texte += " en fin de tournée.";
      await onAjoute(texte, true);
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
        {erreur && <p className="rounded-lg bg-orange/10 px-3 py-2 text-sm font-semibold text-orange-ink">{erreur}</p>}
        <button type="button" className="btn-primary justify-center !py-3.5 text-base" disabled={envoi || adresse.trim().length < 5} onClick={ajouter}>
          {envoi ? "Ajout…" : "Ajouter à la tournée"}
        </button>
      </section>
    </div>
  );
}
