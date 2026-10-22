"use client";

import { useEffect, useRef, useState } from "react";
import maplibregl, { type Map as MapLibreMap, type Marker } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { arretsProlonges, depuisCompact, dureeConduiteMin, kmParcourus, type ArretProlonge, type PointTrace } from "@/lib/colis/trace-gps";
import { formatDuree } from "@/lib/colis/navigation";

type Stop = { id: string; address: string; status: string; lat: number | string | null; lng: number | string | null; done_at?: string | null };
type Props = { runId: string; stops: Stop[]; depot: { lat: number; lng: number } | null };

const coord = (v: number | string | null) => v === null || v === "" ? null : Number(v);
const valide = (lat: number | null, lng: number | null) => lat !== null && lng !== null && Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;

/** Couleurs de la carte d'historique (charte GODAC). */
const C = {
  reel: "#0A0F1E",
  reelBord: "#FFFFFF",
  theorique: "#0F766E",
  livre: "#0F766E",
  echec: "#C2410C",
  nonFait: "#8B93A7",
  depot: "#0A0F1E",
  prolonge: "#B7791F",
} as const;

const heure = (t: number) => new Date(t).toLocaleTimeString("fr-FR", { timeZone: "Europe/Paris", hour: "2-digit", minute: "2-digit" });
const km = (v: number) => `${v.toLocaleString("fr-FR", { maximumFractionDigits: 1, minimumFractionDigits: v < 100 ? 1 : 0 })} km`;

interface Resume {
  points: number;
  km: number;
  conduiteMin: number;
  debut: number;
  fin: number;
  prolonges: ArretProlonge[];
}

/**
 * Carte de la tournée dans l'historique : arrêts numérotés colorés selon
 * leur statut, dépôt, itinéraire routier théorique entre les arrêts (dans
 * l'ordre de passage) et, quand il existe, le tracé GPS réellement
 * emprunté (enregistré pendant la tournée en cours) avec les km réels, la
 * durée de conduite et les arrêts prolongés (> 5 min hors livraison).
 */
export default function HistoriqueCarte({ runId, stops, depot }: Props) {
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const markersRef = useRef<Marker[]>([]);
  const [routeMessage, setRouteMessage] = useState("Chargement du trajet…");
  const [kmTheorique, setKmTheorique] = useState<number | null>(null);
  const [trace, setTrace] = useState<Resume | null | "absent" | "chargement">("chargement");

  useEffect(() => {
    if (!container.current || mapRef.current) return;
    let annule = false;
    const map = new maplibregl.Map({
      container: container.current,
      center: [2.2, 46.5],
      zoom: 5,
      style: {
        version: 8,
        sources: {
          osm: {
            type: "raster",
            tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
            tileSize: 256,
            attribution: "© OpenStreetMap contributors"
          }
        },
        layers: [{ id: "osm", type: "raster", source: "osm", paint: { "raster-saturation": -0.6, "raster-opacity": 0.9 } }]
      }
    });
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
    mapRef.current = map;

    const points = stops.map((s, i) => {
      const lat = coord(s.lat), lng = coord(s.lng);
      return { stop: s, index: i + 1, lat, lng };
    }).filter((p) => valide(p.lat, p.lng)) as { stop: Stop; index: number; lat: number; lng: number }[];
    const depotValide = depot && valide(depot.lat, depot.lng) ? depot : null;

    // Tracé réel (fil d'Ariane GPS), chargé à part : la page reste légère.
    const traceReel = fetch(`/api/colis/trace?run_id=${encodeURIComponent(runId)}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j: { points?: [number, number, number][] } | null) => depuisCompact(j?.points ?? []))
      .catch(() => [] as PointTrace[]);

    map.on("load", async () => {
      for (const marker of markersRef.current) marker.remove();
      markersRef.current = [];
      const ajouter = (el: HTMLElement, lng: number, lat: number) => markersRef.current.push(new maplibregl.Marker({ element: el }).setLngLat([lng, lat]).addTo(map));
      if (depotValide) {
        const el = document.createElement("div");
        el.textContent = "D";
        el.title = "Dépôt";
        Object.assign(el.style, { width: "26px", height: "26px", borderRadius: "6px", display: "grid", placeItems: "center", background: "#fff", color: C.depot, border: `2px solid ${C.depot}`, fontWeight: "700", fontSize: "12px", boxShadow: "0 1px 5px #0005" });
        ajouter(el, depotValide.lng, depotValide.lat);
      }
      for (const p of points) {
        const el = document.createElement("div");
        el.textContent = String(p.index);
        el.title = `${p.index}. ${p.stop.address}${p.stop.status === "delivered" ? " · fait" : p.stop.status === "failed" ? " · échec" : " · non fait"}`;
        const fond = p.stop.status === "delivered" ? C.livre : p.stop.status === "failed" ? C.echec : C.nonFait;
        Object.assign(el.style, {
          width: "26px", height: "26px", borderRadius: "50%", display: "flex",
          alignItems: "center", justifyContent: "center", background: fond,
          color: "#fff", border: "2px solid white", boxShadow: "0 1px 5px #0005",
          fontWeight: "700", fontSize: "11px"
        });
        ajouter(el, p.lng, p.lat);
      }
      const bounds = new maplibregl.LngLatBounds();
      if (depotValide) bounds.extend([depotValide.lng, depotValide.lat]);
      points.forEach((p) => bounds.extend([p.lng, p.lat]));

      // Itinéraire théorique entre les arrêts, dans l'ordre affiché (ordre de passage).
      const routePoints = [
        ...(depotValide ? [[depotValide.lng, depotValide.lat] as [number, number]] : []),
        ...points.map((p) => [p.lng, p.lat] as [number, number])
      ];
      const theorique = async () => {
        if (routePoints.length < 2) {
          setRouteMessage(points.length ? "Un seul arrêt géolocalisé : pas d’itinéraire théorique." : "Aucun arrêt géolocalisé pour cette tournée.");
          return;
        }
        try {
          // Le service public limite le nombre de points : au-delà, segments droits.
          if (routePoints.length > 90) throw new Error("trop de points");
          const coords = routePoints.map((p) => p.join(",")).join(";");
          const response = await fetch(`https://router.project-osrm.org/route/v1/driving/${coords}?overview=full&geometries=geojson`);
          if (!response.ok) throw new Error("route indisponible");
          const data = await response.json();
          const geometry = data?.routes?.[0]?.geometry;
          if (!geometry?.coordinates?.length) throw new Error("tracé absent");
          if (annule) return;
          map.addSource("godac-route", { type: "geojson", data: { type: "Feature", properties: {}, geometry } });
          map.addLayer({ id: "godac-route-line", type: "line", source: "godac-route", layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": C.theorique, "line-width": 4, "line-opacity": 0.55, "line-dasharray": [2, 1.5] } }, map.getLayer("godac-reel-bord") ? "godac-reel-bord" : undefined);
          const distance = Number(data?.routes?.[0]?.distance);
          if (Number.isFinite(distance) && distance > 0) setKmTheorique(distance / 1000);
          setRouteMessage("Itinéraire routier théorique entre les arrêts, dans l’ordre de passage.");
        } catch {
          if (annule) return;
          map.addSource("godac-route", { type: "geojson", data: { type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: routePoints } } });
          map.addLayer({ id: "godac-route-line", type: "line", source: "godac-route", layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": C.theorique, "line-width": 3, "line-dasharray": [2, 2], "line-opacity": 0.5 } }, map.getLayer("godac-reel-bord") ? "godac-reel-bord" : undefined);
          setRouteMessage("Itinéraire théorique indicatif (segments droits) : le calcul routier est momentanément indisponible.");
        }
      };

      const reel = async () => {
        const pts = await traceReel;
        if (annule) return;
        if (pts.length < 2) {
          setTrace("absent");
          return;
        }
        const coordonnees = pts.map((p) => [p.lng, p.lat] as [number, number]);
        map.addSource("godac-reel", { type: "geojson", data: { type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: coordonnees } } });
        map.addLayer({ id: "godac-reel-bord", type: "line", source: "godac-reel", layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": C.reelBord, "line-width": 7, "line-opacity": 0.9 } });
        map.addLayer({ id: "godac-reel-line", type: "line", source: "godac-reel", layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": C.reel, "line-width": 3.5 } });
        const livraisons = points.map((p) => ({ lat: p.lat, lng: p.lng }));
        const prolonges = arretsProlonges(pts, livraisons);
        for (const a of prolonges) {
          const el = document.createElement("div");
          el.title = `Arrêt prolongé : ${a.dureeMin} min (${heure(a.debut)} → ${heure(a.fin)})`;
          el.setAttribute("aria-label", el.title);
          Object.assign(el.style, { display: "flex", alignItems: "center", gap: "3px", font: "700 10px system-ui, sans-serif", color: "#3B2A06" });
          const point = document.createElement("span");
          Object.assign(point.style, { width: "10px", height: "10px", borderRadius: "50%", background: C.prolonge, border: "2px solid #fff", boxShadow: "0 1px 3px #0006" });
          const texte = document.createElement("span");
          texte.textContent = `${a.dureeMin} min`;
          Object.assign(texte.style, { background: "rgba(255,255,255,.9)", borderRadius: "6px", padding: "0 3px" });
          el.append(point, texte);
          markersRef.current.push(new maplibregl.Marker({ element: el, anchor: "left" }).setLngLat([a.lng, a.lat]).addTo(map));
        }
        coordonnees.forEach((c) => bounds.extend(c));
        setTrace({ points: pts.length, km: kmParcourus(pts), conduiteMin: dureeConduiteMin(pts), debut: pts[0]!.t, fin: pts[pts.length - 1]!.t, prolonges });
      };

      await Promise.all([reel(), theorique()]);
      if (!annule && !bounds.isEmpty()) map.fitBounds(bounds, { padding: 40, maxZoom: 14, duration: 0 });
    });

    return () => {
      annule = true;
      markersRef.current.forEach((marker) => marker.remove());
      markersRef.current = [];
      map.remove();
      mapRef.current = null;
    };
  }, [runId, stops, depot]);

  const resume = typeof trace === "object" && trace ? trace : null;
  const ecart = resume && kmTheorique ? Math.round(((resume.km - kmTheorique) / kmTheorique) * 100) : null;

  return (
    <section className="overflow-hidden rounded-xl border border-navy/10">
      <div className="flex items-center justify-between gap-3 bg-white px-3 py-2">
        <h3 className="text-sm font-semibold text-navy">Trajet de la tournée</h3>
        <span className="text-xs text-navy/60">{stops.filter((s) => valide(coord(s.lat), coord(s.lng))).length} arrêt(s) sur la carte</span>
      </div>
      <div ref={container} className="h-[400px] w-full bg-navy/[0.06]" aria-label="Carte du trajet de la tournée" />
      <div className="flex flex-col gap-2 bg-white px-3 py-2.5 text-xs text-navy/70">
        {trace === "chargement" ? (
          <p>Chargement du tracé réel…</p>
        ) : trace === "absent" || !resume ? (
          <p className="font-semibold text-navy/70">Tracé non disponible pour cette tournée.</p>
        ) : (
          <dl className="grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-4">
            <div>
              <dt className="text-navy/55">Km réels parcourus</dt>
              <dd className="text-sm font-semibold tabular-nums text-navy">{km(resume.km)}</dd>
            </div>
            <div>
              <dt className="text-navy/55">Durée de conduite</dt>
              <dd className="text-sm font-semibold tabular-nums text-navy">
                {formatDuree(resume.conduiteMin)}
                <span className="ml-1 text-xs font-normal text-navy/55">
                  ({heure(resume.debut)} → {heure(resume.fin)})
                </span>
              </dd>
            </div>
            <div>
              <dt className="text-navy/55">Itinéraire théorique</dt>
              <dd className="text-sm font-semibold tabular-nums text-navy">
                {kmTheorique ? km(kmTheorique) : "—"}
                {ecart !== null && <span className={`ml-1 text-xs font-semibold ${ecart > 10 ? "text-orange-ink" : "text-teal-ink"}`}>({ecart > 0 ? "+" : ""}{ecart} %)</span>}
              </dd>
            </div>
            <div>
              <dt className="text-navy/55">Arrêts prolongés (&gt; 5 min hors livraison)</dt>
              <dd className="text-sm font-semibold tabular-nums text-navy">
                {resume.prolonges.length ? `${resume.prolonges.length} · ${formatDuree(resume.prolonges.reduce((s, a) => s + a.dureeMin, 0))}` : "aucun"}
              </dd>
            </div>
          </dl>
        )}
        <ul className="flex flex-wrap gap-x-4 gap-y-1" aria-label="Légende">
          <li className="flex items-center gap-1.5">
            <span className="inline-block h-1 w-6 rounded-full" style={{ background: C.reel, boxShadow: "0 0 0 1.5px #fff, 0 0 0 2.5px #0A0F1E22" }} aria-hidden="true" /> Trajet réel (GPS)
          </li>
          <li className="flex items-center gap-1.5">
            <span className="inline-block w-6 border-t-[3px] border-dashed" style={{ borderColor: C.theorique, opacity: 0.7 }} aria-hidden="true" /> Itinéraire théorique
          </li>
          <li className="flex items-center gap-1.5">
            <span className="inline-block h-3 w-3 rounded-full" style={{ background: C.livre }} aria-hidden="true" /> Fait
          </li>
          <li className="flex items-center gap-1.5">
            <span className="inline-block h-3 w-3 rounded-full" style={{ background: C.echec }} aria-hidden="true" /> Échec
          </li>
          <li className="flex items-center gap-1.5">
            <span className="inline-block h-3 w-3 rounded-full" style={{ background: C.nonFait }} aria-hidden="true" /> Non fait
          </li>
          <li className="flex items-center gap-1.5">
            <span className="inline-block h-2.5 w-2.5 rounded-full border-2 border-white" style={{ background: C.prolonge }} aria-hidden="true" /> Arrêt prolongé
          </li>
          <li className="flex items-center gap-1.5">
            <span className="inline-grid h-3.5 w-3.5 place-items-center rounded-[3px] border-2 text-[8px] font-bold" style={{ borderColor: C.depot }} aria-hidden="true" /> Dépôt
          </li>
        </ul>
        <p className="text-navy/55">
          {routeMessage} Trajet réel enregistré seulement pendant la tournée en cours, application ouverte (conservé 1 an) ; les km réels excluent les sauts aberrants du GPS.
        </p>
      </div>
    </section>
  );
}
