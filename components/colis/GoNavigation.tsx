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
import { pastille, marqueurChauffeur, orienterChauffeur } from "@/components/colis/marqueurs";
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
import { RAYON_ARRIVEE_M, arretApresCloture, arretSuivi, distanceM, doitRecalculer, formatDistance, formatDuree, meilleureInsertion, resteSurTrace } from "@/lib/colis/navigation";

/** Fond vectoriel gratuit et sans clé déjà utilisé par l'app (OpenStreetMap via OpenFreeMap), recoloré aux couleurs GODAC. */
const STYLE = process.env.NEXT_PUBLIC_MAP_STYLE ?? "https://tiles.openfreemap.org/styles/liberty";
/** Envoi de la position à l'écran chauffeur (heures estimées) : au plus toutes les 30 s. */
const REMONTEE_POSITION_MS = 30_000;
const ligneGeo = (coordinates: [number, number][]) => ({ type: "Feature" as const, properties: {}, geometry: { type: "LineString" as const, coordinates } });
const VIDE = ligneGeo([]);

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
  const [suivre, setSuivre] = useState(true);
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
  const suivreRef = useRef(suivre);
  suivreRef.current = suivre;
  const feuilleRef = useRef<HTMLDivElement>(null);

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
      });
      m.on("load", () => {
        m.addSource("suite", { type: "geojson", data: VIDE });
        m.addSource("trajet", { type: "geojson", data: VIDE });
        m.addLayer({ id: "suite", type: "line", source: "suite", paint: { "line-color": COULEURS_CARTE.marine, "line-width": 3, "line-opacity": 0.35, "line-dasharray": [1.5, 1.5] }, layout: { "line-cap": "round", "line-join": "round" } });
        m.addLayer({ id: "trajet-bord", type: "line", source: "trajet", paint: { "line-color": COULEURS_CARTE.marine, "line-width": 12, "line-opacity": 0.85 }, layout: { "line-cap": "round", "line-join": "round" } });
        m.addLayer({ id: "trajet", type: "line", source: "trajet", paint: { "line-color": COULEURS_CARTE.teal, "line-width": 7 }, layout: { "line-cap": "round", "line-join": "round" } });
        setPrete(true);
      });
      // Le chauffeur déplace la carte : on arrête de le suivre (bouton « Recentrer »).
      m.on("dragstart", () => setSuivre(false));
      carte.current = m;
    })();
    return () => {
      annule = true;
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
        setPosition(pos);
        const m = carte.current;
        const maplibregl = lib.current;
        if (m && maplibregl) {
          if (!moi.current) moi.current = new maplibregl.Marker({ element: marqueurChauffeur() }).setLngLat([pos.lng, pos.lat]).addTo(m);
          else moi.current.setLngLat([pos.lng, pos.lat]);
          // Cap affiché seulement en mouvement (il est faux à l'arrêt).
          orienterChauffeur(moi.current.getElement(), g.coords.heading !== null && (g.coords.speed ?? 0) > 1.5 ? g.coords.heading : null);
          if (suivreRef.current) m.easeTo({ center: [pos.lng, pos.lat], zoom: Math.max(m.getZoom(), 15.5), padding: marges(), duration: 900 });
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

  // Arrêt suivi qui change (clôture, carte glissée) : on le montre avec le chauffeur.
  const derniereCible = useRef<string | null>(null);
  useEffect(() => {
    if (!prete || !cible || cible.id === derniereCible.current) return;
    derniereCible.current = cible.id;
    const m = carte.current;
    const maplibregl = lib.current;
    if (!m || !maplibregl || cible.lat === null || cible.lng === null || suivreRef.current) return;
    const pts: [number, number][] = [[Number(cible.lng), Number(cible.lat)]];
    if (position) pts.push([position.lng, position.lat]);
    const b = pts.reduce((bb, x) => bb.extend(x), new maplibregl.LngLatBounds(pts[0]!, pts[0]!));
    m.fitBounds(b, { padding: marges(), maxZoom: 16, duration: 600 });
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
    setSuivre(true);
    const m = carte.current;
    if (m && position) m.easeTo({ center: [position.lng, position.lat], zoom: 16, padding: marges(), duration: 600 });
  }
  function toutVoir() {
    setSuivre(false);
    const m = carte.current;
    const maplibregl = lib.current;
    if (!m || !maplibregl) return;
    const pts: [number, number][] = restants.filter((s) => s.lat !== null).map((s) => [Number(s.lng), Number(s.lat)]);
    if (position) pts.push([position.lng, position.lat]);
    if (!pts.length) return;
    const b = pts.reduce((bb, x) => bb.extend(x), new maplibregl.LngLatBounds(pts[0]!, pts[0]!));
    m.fitBounds(b, { padding: marges(), maxZoom: 15, duration: 600 });
  }

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
        <div className="pointer-events-auto mx-auto flex max-w-xl items-stretch gap-2">
          <button type="button" onClick={p.onFermer} className="flex w-12 shrink-0 items-center justify-center rounded-2xl bg-marine text-2xl text-white shadow-pop" aria-label="Retour à la liste des arrêts">
            ‹
          </button>
          <div className="min-w-0 flex-1 rounded-2xl bg-marine px-4 py-2.5 text-white shadow-pop" aria-live="polite">
            {fige ? (
              <p className="py-1 text-sm font-semibold">Tournée clôturée : consultation seulement.</p>
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
        {erreurGps && <p className="pointer-events-auto mx-auto mt-2 max-w-xl rounded-xl bg-orange px-3 py-2 text-xs font-semibold text-white shadow-pop">{erreurGps}</p>}
        <div className="pointer-events-auto mx-auto mt-2 flex max-w-xl justify-end gap-2">
          {!fige && run.status === "in_progress" && (
            <button type="button" onClick={() => setAjout(true)} className="rounded-full bg-teal px-4 py-2.5 text-sm font-bold text-marine shadow-pop">
              + Adresse
            </button>
          )}
          <button type="button" onClick={toutVoir} className="rounded-full bg-surface px-3 py-2.5 text-xs font-semibold text-navy shadow-pop">
            Toute la tournée
          </button>
          {!suivre && (
            <button type="button" onClick={recentrer} className="rounded-full bg-marine px-3 py-2.5 text-xs font-semibold text-white shadow-pop">
              ◎ Recentrer
            </button>
          )}
        </div>
      </div>

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
