"use client";

import { useEffect, useRef, useState } from "react";
import maplibregl, { type Map as MapLibreMap, type Marker } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";

type Stop = { id: string; address: string; status: string; lat: number | string | null; lng: number | string | null; done_at?: string | null };
type Props = { stops: Stop[]; depot: { lat: number; lng: number } | null };

const coord = (v: number | string | null) => v === null || v === "" ? null : Number(v);
const valide = (lat: number | null, lng: number | null) => lat !== null && lng !== null && Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;

/** Carte native GODAC : arrêts numérotés, dépôt et tracé routier si le service de routage répond. */
export default function HistoriqueCarte({ stops, depot }: Props) {
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const markersRef = useRef<Marker[]>([]);
  const [routeMessage, setRouteMessage] = useState("Chargement du trajet…");

  useEffect(() => {
    if (!container.current || mapRef.current) return;
    const map = new maplibregl.Map({
      container: container.current,
      center: [2.2, 46.5],
      zoom: 5,
      attributionControl: true,
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
        layers: [{ id: "osm", type: "raster", source: "osm" }]
      }
    });
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
    mapRef.current = map;

    const points = stops.map((s, i) => {
      const lat = coord(s.lat), lng = coord(s.lng);
      return { stop: s, index: i + 1, lat, lng };
    }).filter((p) => valide(p.lat, p.lng)) as { stop: Stop; index: number; lat: number; lng: number }[];
    const locations = [
      ...(depot && valide(depot.lat, depot.lng) ? [{ lat: depot.lat, lng: depot.lng, label: "D", title: "Dépôt" }] : []),
      ...points.map((p) => ({ lat: p.lat, lng: p.lng, label: String(p.index), title: p.stop.address }))
    ];

    map.on("load", async () => {
      for (const marker of markersRef.current) marker.remove();
      markersRef.current = [];
      for (const loc of locations) {
        const el = document.createElement("div");
        el.className = "godac-route-marker";
        el.textContent = loc.label;
        el.title = loc.title;
        Object.assign(el.style, {
          width: "30px", height: "30px", borderRadius: "50%", display: "flex",
          alignItems: "center", justifyContent: "center", background: loc.label === "D" ? "#f97316" : "#0d9488",
          color: "#fff", border: "2px solid white", boxShadow: "0 1px 5px #0005",
          fontWeight: "700", fontSize: "12px"
        });
        markersRef.current.push(new maplibregl.Marker({ element: el }).setLngLat([loc.lng, loc.lat]).addTo(map));
      }
      if (locations.length) {
        const bounds = new maplibregl.LngLatBounds();
        locations.forEach((p) => bounds.extend([p.lng, p.lat]));
        map.fitBounds(bounds, { padding: 48, maxZoom: 14, duration: 0 });
      }
      const routePoints = [
        ...(depot && valide(depot.lat, depot.lng) ? [[depot.lng, depot.lat] as [number, number]] : []),
        ...points.map((p) => [p.lng, p.lat] as [number, number])
      ];
      if (routePoints.length < 2) {
        setRouteMessage(points.length ? "Un seul arrêt géolocalisé : le tracé nécessite au moins deux points." : "Aucun arrêt géolocalisé pour cette tournée.");
        return;
      }
      try {
        const coords = routePoints.map((p) => p.join(",")).join(";");
        const response = await fetch(`https://router.project-osrm.org/route/v1/driving/${coords}?overview=full&geometries=geojson`);
        if (!response.ok) throw new Error("route indisponible");
        const data = await response.json();
        const geometry = data?.routes?.[0]?.geometry;
        if (!geometry?.coordinates?.length) throw new Error("tracé absent");
        map.addSource("godac-route", { type: "geojson", data: { type: "Feature", properties: {}, geometry } });
        map.addLayer({ id: "godac-route-line", type: "line", source: "godac-route", layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": "#0d9488", "line-width": 5, "line-opacity": 0.85 } });
        setRouteMessage("Trajet routier estimé · arrêts numérotés dans l’ordre affiché.");
      } catch {
        map.addSource("godac-route", { type: "geojson", data: { type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: routePoints } } });
        map.addLayer({ id: "godac-route-line", type: "line", source: "godac-route", layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": "#0d9488", "line-width": 4, "line-dasharray": [2, 2], "line-opacity": 0.75 } });
        setRouteMessage("Tracé indicatif entre les points : le calcul d’itinéraire routier est momentanément indisponible.");
      }
    });

    return () => {
      markersRef.current.forEach((marker) => marker.remove());
      markersRef.current = [];
      map.remove();
      mapRef.current = null;
    };
  }, [stops, depot]);

  return (
    <section className="overflow-hidden rounded-xl border border-navy/10">
      <div className="flex items-center justify-between gap-3 bg-white px-3 py-2">
        <h3 className="text-sm font-semibold text-navy">Trajet de la tournée</h3>
        <span className="text-xs text-navy/60">{stops.filter((s) => valide(coord(s.lat), coord(s.lng))).length} arrêt(s) sur la carte</span>
      </div>
      <div ref={container} className="h-[360px] w-full bg-slate-100" aria-label="Carte du trajet de la tournée" />
      <p className="bg-white px-3 py-2 text-xs text-navy/60">{routeMessage}</p>
    </section>
  );
}
