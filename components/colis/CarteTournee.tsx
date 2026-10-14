"use client";

import { useEffect, useRef, useState } from "react";
import "maplibre-gl/dist/maplibre-gl.css";
import type { Map as CarteMap, Marker } from "maplibre-gl";
import type { Itineraire } from "@/lib/colis/itineraire";
import type { Run, Stop } from "@/components/colis/commun";

/** Fond de carte vectoriel gratuit (OpenStreetMap via OpenFreeMap), remplaçable par variable d'environnement. */
const STYLE = process.env.NEXT_PUBLIC_MAP_STYLE ?? "https://tiles.openfreemap.org/styles/liberty";
const TEAL = "#1BE4C1";
const NAVY = "#0A0F1E";

const GOLD = "#F5C842";

/** Pastille numérotée ; une ramasse a une encoche (coin carré) et une bordure dorée. */
function pastille(numero: string, statut: Stop["status"], actif: boolean, ramasse = false): HTMLElement {
  const el = document.createElement("button");
  el.type = "button";
  el.textContent = numero;
  const fond = statut === "delivered" ? "#9AA3B5" : statut === "failed" ? "#F25A22" : actif ? TEAL : NAVY;
  const texte = statut === "pending" && actif ? NAVY : "#FFFFFF";
  const taille = actif ? 38 : 28;
  Object.assign(el.style, {
    width: `${taille}px`,
    height: `${taille}px`,
    borderRadius: ramasse ? "999px 999px 999px 3px" : "999px",
    background: fond,
    color: texte,
    border: ramasse ? `3px solid ${GOLD}` : "2px solid #FFFFFF",
    boxShadow: "0 2px 6px rgba(10,15,30,.35)",
    font: `700 ${actif ? 15 : 12}px system-ui, sans-serif`,
    cursor: "pointer",
    zIndex: actif ? "2" : "1",
  });
  return el;
}

/**
 * Carte de la tournée (étape 1 du GPS livraison) : arrêts numérotés dans
 * l'ordre de passage, tracé routier de la suite de la tournée, position du
 * chauffeur en direct. Le guidage vocal passe encore par Waze / Google Maps.
 */
export function CarteTournee({
  run,
  stops,
  selection,
  onSelection,
  onItineraire,
}: {
  run: Run;
  stops: Stop[];
  selection: string | null;
  onSelection: (id: string) => void;
  onItineraire?: (it: Itineraire | null) => void;
}) {
  const conteneur = useRef<HTMLDivElement>(null);
  const carte = useRef<CarteMap | null>(null);
  const lib = useRef<typeof import("maplibre-gl") | null>(null);
  const marqueurs = useRef<Marker[]>([]);
  const moi = useRef<Marker | null>(null);
  const position = useRef<{ lat: number; lng: number } | null>(null);
  const [prete, setPrete] = useState(false);
  const [suivre, setSuivre] = useState(false);
  const [erreurGps, setErreurGps] = useState(false);
  const suivreRef = useRef(suivre);
  suivreRef.current = suivre;

  const localises = stops.filter((s) => s.lat !== null && s.lng !== null);
  const restants = stops.filter((s) => s.status === "pending");
  const cleTrace = `${run.id}:${restants.map((s) => s.id).join(",")}`;

  // Création de la carte (une fois).
  useEffect(() => {
    let annule = false;
    (async () => {
      const maplibregl = await import("maplibre-gl");
      if (annule || !conteneur.current) return;
      lib.current = maplibregl;
      const centre = localises[0] ?? (run.start_lat !== null ? { lat: run.start_lat, lng: run.start_lng } : { lat: 46.6, lng: 2.4 });
      const m = new maplibregl.Map({
        container: conteneur.current,
        style: STYLE,
        center: [Number(centre.lng), Number(centre.lat)],
        zoom: localises.length ? 11 : 5,
        attributionControl: { compact: true },
      });
      m.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
      m.on("load", () => {
        m.addSource("trace", { type: "geojson", data: { type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: [] } } });
        m.addLayer({ id: "trace-bord", type: "line", source: "trace", paint: { "line-color": NAVY, "line-width": 8, "line-opacity": 0.55 }, layout: { "line-cap": "round", "line-join": "round" } });
        m.addLayer({ id: "trace", type: "line", source: "trace", paint: { "line-color": TEAL, "line-width": 5 }, layout: { "line-cap": "round", "line-join": "round" } });
        setPrete(true);
      });
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

  // Arrêts numérotés (et dépôt).
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
      Object.assign(d.style, { width: "26px", height: "26px", borderRadius: "6px", background: "#FFFFFF", color: NAVY, border: `2px solid ${NAVY}`, font: "700 12px system-ui", display: "grid", placeItems: "center" });
      marqueurs.current.push(new maplibregl.Marker({ element: d }).setLngLat([Number(run.start_lng), Number(run.start_lat)]).addTo(m));
    }
    stops.forEach((s, i) => {
      if (s.lat === null || s.lng === null) return;
      const el = pastille(String(i + 1), s.status, s.id === selection, s.kind === "ramasse");
      el.setAttribute("aria-label", `${s.kind === "ramasse" ? "Ramasse" : "Arrêt"} ${i + 1} — ${s.address}`);
      el.addEventListener("click", (e) => {
        e.stopPropagation();
        onSelection(s.id);
      });
      marqueurs.current.push(new maplibregl.Marker({ element: el }).setLngLat([Number(s.lng), Number(s.lat)]).addTo(m));
    });
  }, [prete, stops, selection, run.start_lat, run.start_lng, run.start_label, onSelection]);

  // Cadrage initial sur toute la tournée.
  const cadre = useRef(false);
  function cadrer() {
    const m = carte.current;
    const maplibregl = lib.current;
    if (!m || !maplibregl) return;
    const pts: [number, number][] = localises.map((s) => [Number(s.lng), Number(s.lat)]);
    if (run.start_lat !== null && run.start_lng !== null) pts.push([Number(run.start_lng), Number(run.start_lat)]);
    if (position.current) pts.push([position.current.lng, position.current.lat]);
    if (!pts.length) return;
    const b = pts.reduce((bb, p) => bb.extend(p), new maplibregl.LngLatBounds(pts[0]!, pts[0]!));
    m.fitBounds(b, { padding: { top: 70, bottom: 230, left: 50, right: 60 }, maxZoom: 15, duration: 600 });
  }
  useEffect(() => {
    if (prete && !cadre.current) {
      cadre.current = true;
      // Le conteneur prend sa taille définitive juste après le premier rendu.
      setTimeout(() => {
        carte.current?.resize();
        cadrer();
      }, 80);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prete]);

  // Centrer sur l'arrêt choisi (pas au premier affichage : on montre d'abord toute la tournée).
  const derniereSelection = useRef(selection);
  useEffect(() => {
    if (!prete || selection === derniereSelection.current) return;
    derniereSelection.current = selection;
    const s = stops.find((x) => x.id === selection);
    if (s?.lat != null && s.lng != null && !suivreRef.current) carte.current?.easeTo({ center: [Number(s.lng), Number(s.lat)], duration: 500 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selection, prete]);

  // Position du chauffeur en direct.
  useEffect(() => {
    if (!prete || !navigator.geolocation) return;
    const id = navigator.geolocation.watchPosition(
      (p) => {
        setErreurGps(false);
        position.current = { lat: p.coords.latitude, lng: p.coords.longitude };
        const m = carte.current;
        const maplibregl = lib.current;
        if (!m || !maplibregl) return;
        if (!moi.current) {
          const el = document.createElement("div");
          Object.assign(el.style, { width: "18px", height: "18px", borderRadius: "999px", background: "#2F7CF6", border: "3px solid #FFFFFF", boxShadow: "0 0 0 6px rgba(47,124,246,.25)" });
          moi.current = new maplibregl.Marker({ element: el }).setLngLat([p.coords.longitude, p.coords.latitude]).addTo(m);
        } else moi.current.setLngLat([p.coords.longitude, p.coords.latitude]);
        if (suivreRef.current) m.easeTo({ center: [p.coords.longitude, p.coords.latitude], zoom: Math.max(m.getZoom(), 15), duration: 800 });
      },
      () => setErreurGps(true),
      { enableHighAccuracy: true, maximumAge: 5000 },
    );
    return () => navigator.geolocation.clearWatch(id);
  }, [prete]);

  // Tracé de la suite de la tournée.
  async function tracer(depuisMoi: boolean) {
    try {
      const res = await fetch("/api/colis/itineraire", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ run_id: run.id, depuis: depuisMoi ? position.current : null }),
      });
      if (!res.ok) throw new Error();
      const it = (await res.json()) as Itineraire;
      const src = carte.current?.getSource("trace") as { setData?: (d: unknown) => void } | undefined;
      src?.setData?.({ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: it.ligne } });
      onItineraire?.(it);
    } catch {
      onItineraire?.(null);
    }
  }
  useEffect(() => {
    if (prete) tracer(Boolean(position.current));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prete, cleTrace]);

  return (
    <div className="relative h-full w-full">
      <div ref={conteneur} className="h-full w-full" aria-label="Carte de la tournée" role="region" />
      <div className="absolute left-3 top-3 flex flex-col gap-2">
        <button type="button" className="rounded-full bg-surface px-3 py-2 text-xs font-semibold shadow-pop" onClick={cadrer}>
          Toute la tournée
        </button>
        <button
          type="button"
          aria-pressed={suivre}
          className={`rounded-full px-3 py-2 text-xs font-semibold shadow-pop ${suivre ? "bg-teal text-marine" : "bg-surface"}`}
          onClick={() => {
            setSuivre((v) => !v);
            if (position.current) carte.current?.easeTo({ center: [position.current.lng, position.current.lat], zoom: 15 });
          }}
        >
          {suivre ? "Je suis suivi" : "Me suivre"}
        </button>
        <button type="button" className="rounded-full bg-surface px-3 py-2 text-xs font-semibold shadow-pop" onClick={() => tracer(true)}>
          Tracé depuis ma position
        </button>
      </div>
      {erreurGps && (
        <p className="absolute inset-x-3 top-[140px] rounded-xl bg-orange px-3 py-2 text-xs font-semibold text-white shadow-pop">
          Position indisponible : autorisez la localisation pour voir où vous êtes sur la carte.
        </p>
      )}
    </div>
  );
}
