'use client';

import maplibregl, { GeoJSONSource, LngLatLike, Map as MapLibreMap } from 'maplibre-gl';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Feature, FeatureCollection, LineString, Point } from 'geojson';
import { distanceMeters, formatDistance, formatDuration } from './geo';
import type { GoNavigationProps, GoNavigationReport, GoReportType } from './types';
import './go-navigation.css';

type RouteResult = {
  coordinates: [number, number][];
  distance: number;
  duration: number;
};

type SearchResult = {
  place_id: number;
  display_name: string;
  lat: string;
  lon: string;
};

const DEFAULT_ROUTING_URL = 'https://router.project-osrm.org';
const DEFAULT_GEOCODING_URL = 'https://nominatim.openstreetmap.org';
const REPORTS_KEY = 'godac.go-navigation.reports.v1';

const reportLabels: Record<GoReportType, string> = {
  accident: 'Accident',
  works: 'Travaux',
  hazard: 'Danger',
  slowdown: 'Ralentissement',
};

function routeFeature(route: RouteResult | null): Feature<LineString> | null {
  if (!route || route.coordinates.length < 2) return null;
  return {
    type: 'Feature',
    properties: {},
    geometry: { type: 'LineString', coordinates: route.coordinates },
  };
}

function pointCollection(points: Array<{ longitude: number; latitude: number }>): FeatureCollection<Point> {
  return {
    type: 'FeatureCollection',
    features: points.map((p) => ({
      type: 'Feature',
      properties: {},
      geometry: { type: 'Point', coordinates: [p.longitude, p.latitude] },
    })),
  };
}

function readReports(): GoNavigationReport[] {
  if (typeof window === 'undefined') return [];
  try {
    const value = window.localStorage.getItem(REPORTS_KEY);
    return value ? (JSON.parse(value) as GoNavigationReport[]) : [];
  } catch {
    return [];
  }
}

export function GoNavigation({
  stops = [],
  destination = null,
  routingUrl = DEFAULT_ROUTING_URL,
  geocodingUrl = DEFAULT_GEOCODING_URL,
  deviationThresholdMeters = 100,
}: GoNavigationProps) {
  const mapElement = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const userMarkerRef = useRef<maplibregl.Marker | null>(null);
  const watchIdRef = useRef<number | null>(null);
  const lastRerouteAtRef = useRef<number>(0);
  const currentPositionRef = useRef<{ latitude: number; longitude: number } | null>(null);
  const destinationRef = useRef<{ label: string; latitude: number; longitude: number } | null>(destination);
  const routeRef = useRef<RouteResult | null>(null);
  const routeStopsRef = useRef<Array<{ label: string; latitude: number; longitude: number }>>(
    destination ? [destination] : [],
  );

  const [position, setPosition] = useState<{ latitude: number; longitude: number } | null>(null);
  const [gpsStatus, setGpsStatus] = useState<'idle' | 'locating' | 'active' | 'error'>('idle');
  const [query, setQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [destinationState, setDestinationState] = useState(destination);
  const [route, setRoute] = useState<RouteResult | null>(null);
  const [routeBusy, setRouteBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reports, setReports] = useState<GoNavigationReport[]>([]);
  const [reportType, setReportType] = useState<GoReportType>('hazard');
  const [reportNote, setReportNote] = useState('');
  const [reportMode, setReportMode] = useState(false);
  const [showStops, setShowStops] = useState(true);

  const mappedStops = useMemo(
    () => stops.filter((s) => Number.isFinite(s.latitude) && Number.isFinite(s.longitude)),
    [stops],
  );

  useEffect(() => {
    setReports(readReports());
  }, []);

  useEffect(() => {
    destinationRef.current = destinationState;
  }, [destinationState]);

  const syncMapData = useCallback((map: MapLibreMap, nextRoute: RouteResult | null, nextPosition: { latitude: number; longitude: number } | null, nextReports: GoNavigationReport[]) => {
    const routeSource = map.getSource('go-route') as GeoJSONSource | undefined;
    routeSource?.setData({
      type: 'FeatureCollection',
      features: routeFeature(nextRoute) ? [routeFeature(nextRoute)!] : [],
    });
    const positionSource = map.getSource('go-position') as GeoJSONSource | undefined;
    positionSource?.setData(pointCollection(nextPosition ? [nextPosition] : []));
    const reportsSource = map.getSource('go-reports') as GeoJSONSource | undefined;
    reportsSource?.setData(pointCollection(nextReports));
  }, []);

  useEffect(() => {
    if (!mapElement.current || mapRef.current) return;
    const map = new maplibregl.Map({
      container: mapElement.current,
      // Public raster tiles are suitable for local evaluation only; replace with a compliant provider for production.
      style: {
        version: 8,
        sources: {
          osm: {
            type: 'raster',
            tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
            tileSize: 256,
            attribution: '© OpenStreetMap contributors',
          },
        },
        layers: [{ id: 'osm', type: 'raster', source: 'osm' }],
      },
      center: [2.35, 46.6] as LngLatLike,
      zoom: 5,
      attributionControl: true,
    });
    mapRef.current = map;

    map.addControl(new maplibregl.NavigationControl({ showCompass: true }), 'top-right');
    map.addControl(new maplibregl.ScaleControl({ unit: 'metric' }), 'bottom-left');

    map.on('load', () => {
      map.addSource('go-route', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] } as FeatureCollection,
      });
      map.addLayer({
        id: 'go-route-line',
        type: 'line',
        source: 'go-route',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': '#1BE4C1', 'line-width': 6, 'line-opacity': 0.9 },
      });
      map.addSource('go-position', { type: 'geojson', data: pointCollection([]) });
      map.addLayer({
        id: 'go-position-dot',
        type: 'circle',
        source: 'go-position',
        paint: { 'circle-radius': 8, 'circle-color': '#FF6B35', 'circle-stroke-width': 3, 'circle-stroke-color': '#fff' },
      });
      map.addSource('go-reports', { type: 'geojson', data: pointCollection([]) });
      map.addLayer({
        id: 'go-reports-dots',
        type: 'circle',
        source: 'go-reports',
        paint: { 'circle-radius': 7, 'circle-color': '#F5C842', 'circle-stroke-width': 2, 'circle-stroke-color': '#0A0F1E' },
      });
      syncMapData(map, routeRef.current, currentPositionRef.current, readReports());
      if (destinationRef.current) {
        map.flyTo({ center: [destinationRef.current.longitude, destinationRef.current.latitude], zoom: 12 });
      }
    });

    map.on('click', (event) => {
      if (!reportMode) {
        // Click-to-set destination is intentionally not enabled by default; use address search or GODAC stops.
        return;
      }
      const point = { longitude: event.lngLat.lng, latitude: event.lngLat.lat };
      const report: GoNavigationReport = {
        id: crypto.randomUUID(),
        type: reportType,
        latitude: point.latitude,
        longitude: point.longitude,
        createdAt: new Date().toISOString(),
        note: reportNote.trim() || undefined,
      };
      const next = [report, ...readReports()].slice(0, 100);
      try {
        window.localStorage.setItem(REPORTS_KEY, JSON.stringify(next));
      } catch {
        setError('Impossible d’enregistrer le signalement sur cet appareil.');
      }
      setReports(next);
      setReportMode(false);
      setReportNote('');
      syncMapData(map, routeRef.current, currentPositionRef.current, next);
    });

    return () => {
      if (watchIdRef.current !== null && typeof navigator !== 'undefined' && navigator.geolocation) {
        navigator.geolocation.clearWatch(watchIdRef.current);
      }
      userMarkerRef.current?.remove();
      map.remove();
      mapRef.current = null;
    };
    // Map is mounted once. Report mode/type/note are read by the handler closure below via effect updates.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [syncMapData]);

  // Keep map click handler's report settings current without rebuilding the map.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const handler = (event: maplibregl.MapMouseEvent) => {
      if (!reportMode) return;
      const report: GoNavigationReport = {
        id: crypto.randomUUID(),
        type: reportType,
        latitude: event.lngLat.lat,
        longitude: event.lngLat.lng,
        createdAt: new Date().toISOString(),
        note: reportNote.trim() || undefined,
      };
      const next = [report, ...readReports()].slice(0, 100);
      try { window.localStorage.setItem(REPORTS_KEY, JSON.stringify(next)); } catch { setError('Stockage local indisponible.'); }
      setReports(next);
      setReportMode(false);
      setReportNote('');
      syncMapData(map, routeRef.current, currentPositionRef.current, next);
    };
    // The base handler does nothing unless reportMode was true at mount; this handler handles current state.
    map.on('click', handler);
    return () => { map.off('click', handler); };
  }, [reportMode, reportType, reportNote, syncMapData]);

  const calculateRoute = useCallback(async (
    from: { latitude: number; longitude: number },
    to:
      | { label: string; latitude: number; longitude: number }
      | Array<{ label: string; latitude: number; longitude: number }>,
  ) => {
    const destinations = (Array.isArray(to) ? to : [to]).filter(
      (point) => Number.isFinite(point.latitude) && Number.isFinite(point.longitude),
    );
    if (destinations.length === 0) {
      setError("Aucun arrêt avec des coordonnées GPS valides.");
      return;
    }

    setRouteBusy(true);
    setError(null);
    try {
      const coordinates = [
        `${from.longitude},${from.latitude}`,
        ...destinations.map((point) => `${point.longitude},${point.latitude}`),
      ].join(";");
      const url =
        `${routingUrl.replace(/\\/$/, "")}/route/v1/driving/${coordinates}` +
        "?overview=full&geometries=geojson&steps=true";
      const response = await fetch(url);
      if (!response.ok) throw new Error(`Le service d’itinéraire répond ${response.status}.`);
      const data = await response.json();
      if (data.code !== "Ok" || !data.routes?.[0]) {
        throw new Error("Aucun itinéraire disponible pour ces arrêts.");
      }

      const nextRoute: RouteResult = {
        coordinates: data.routes[0].geometry.coordinates,
        distance: data.routes[0].distance,
        duration: data.routes[0].duration,
      };
      routeRef.current = nextRoute;
      setRoute(nextRoute);

      const map = mapRef.current;
      if (map?.isStyleLoaded() && nextRoute.coordinates.length > 0) {
        syncMapData(map, nextRoute, currentPositionRef.current, readReports());
        const bounds = nextRoute.coordinates.reduce(
          (b, coordinate) => b.extend(coordinate as [number, number]),
          new maplibregl.LngLatBounds(nextRoute.coordinates[0], nextRoute.coordinates[0]),
        );
        map.fitBounds(bounds, {
          padding: { top: 50, bottom: 80, left: 40, right: 40 },
          maxZoom: 15,
          duration: 700,
        });
      }
    } catch (error) {
      setError(error instanceof Error ? error.message : "Erreur de calcul d’itinéraire.");
    } finally {
      setRouteBusy(false);
    }
  }, [routingUrl, syncMapData]);

  const setDestination = useCallback((next: { label: string; latitude: number; longitude: number }) => {
    setDestinationState(next);
    destinationRef.current = next;
    routeStopsRef.current = [next];
    const map = mapRef.current;
    map?.flyTo({ center: [next.longitude, next.latitude], zoom: 13, essential: true });
    const from = currentPositionRef.current;
    if (from) void calculateRoute(from, next);
  }, [calculateRoute]);

  const startGps = useCallback(() => {
    if (!navigator.geolocation) {
      setGpsStatus('error');
      setError('La géolocalisation n’est pas prise en charge par ce navigateur.');
      return;
    }
    setGpsStatus('locating');
    setError(null);
    watchIdRef.current = navigator.geolocation.watchPosition(
      (result) => {
        const next = { latitude: result.coords.latitude, longitude: result.coords.longitude };
        currentPositionRef.current = next;
        setPosition(next);
        setGpsStatus('active');
        const map = mapRef.current;
        if (map?.isStyleLoaded()) syncMapData(map, routeRef.current, next, readReports());
        if (!userMarkerRef.current && map) {
          userMarkerRef.current = new maplibregl.Marker({ color: '#FF6B35' })
            .setLngLat([next.longitude, next.latitude])
            .addTo(map);
        } else {
          userMarkerRef.current?.setLngLat([next.longitude, next.latitude]);
        }
        if (map && !routeRef.current) map.easeTo({ center: [next.longitude, next.latitude], zoom: 15, duration: 500 });
        const target = destinationRef.current;
        const now = Date.now();
        if (target && routeRef.current && now - lastRerouteAtRef.current > 20_000) {
          const routeCoordinates = routeRef.current.coordinates;
          const nearest = routeCoordinates.reduce((best, coord) => {
            const d = distanceMeters(next, { longitude: coord[0], latitude: coord[1] });
            return d < best.distance ? { distance: d } : best;
          }, { distance: Number.POSITIVE_INFINITY });
          if (nearest.distance > deviationThresholdMeters) {
            lastRerouteAtRef.current = now;
            void calculateRoute(
              next,
              routeStopsRef.current.length > 0 ? routeStopsRef.current : target,
            );
          }
        }
      },
      (geoError) => {
        setGpsStatus('error');
        setError(geoError.code === geoError.PERMISSION_DENIED
          ? 'Autorise la localisation dans ton navigateur puis réessaie.'
          : 'Position GPS indisponible. Vérifie le signal et les autorisations.');
      },
      { enableHighAccuracy: true, maximumAge: 3000, timeout: 15000 },
    );
  }, [calculateRoute, deviationThresholdMeters, syncMapData]);

  const searchAddress = useCallback(async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!query.trim()) return;
    setSearching(true);
    setError(null);
    try {
      const url = `${geocodingUrl.replace(/\/$/, '')}/search?format=jsonv2&limit=5&countrycodes=fr&q=${encodeURIComponent(query.trim())}`;
      const response = await fetch(url, { headers: { Accept: 'application/json' } });
      if (!response.ok) throw new Error('La recherche d’adresse est temporairement indisponible.');
      setSearchResults((await response.json()) as SearchResult[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erreur de recherche.');
    } finally {
      setSearching(false);
    }
  }, [geocodingUrl, query]);

  useEffect(() => {
    if (!destination || !position) return;
    const plannedStops = routeStopsRef.current;
    void calculateRoute(position, plannedStops.length > 0 ? plannedStops : destination);
  }, [destination, position, calculateRoute]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.isStyleLoaded()) return;
    syncMapData(map, route, position, reports);
  }, [route, position, reports, syncMapData]);

  const chooseStop = (stop: (typeof mappedStops)[number]) => {
    setDestination({
      label: stop.label,
      latitude: Number(stop.latitude),
      longitude: Number(stop.longitude),
    });
  };

  const addReport = () => {
    if (!position) {
      setError('Active d’abord le GPS pour signaler un événement à ta position.');
      return;
    }
    const report: GoNavigationReport = {
      id: crypto.randomUUID(),
      type: reportType,
      latitude: position.latitude,
      longitude: position.longitude,
      createdAt: new Date().toISOString(),
      note: reportNote.trim() || undefined,
    };
    const next = [report, ...reports].slice(0, 100);
    try { window.localStorage.setItem(REPORTS_KEY, JSON.stringify(next)); } catch { setError('Stockage local indisponible.'); }
    setReports(next);
    setReportNote('');
    setReportMode(false);
    const map = mapRef.current;
    if (map?.isStyleLoaded()) syncMapData(map, routeRef.current, currentPositionRef.current, next);
  };

  return (
    <main className="go-nav">
      <header className="go-nav__header">
        <div>
          <p className="go-nav__eyebrow">GODAC · MODULE CHAUFFEUR</p>
          <h1>GO <span>Navigation</span></h1>
        </div>
        <span className={`go-nav__gps go-nav__gps--${gpsStatus}`}>{gpsStatus === 'active' ? 'GPS actif' : gpsStatus === 'locating' ? 'Recherche GPS…' : gpsStatus === 'error' ? 'GPS indisponible' : 'GPS arrêté'}</span>
      </header>

      <section className="go-nav__layout">
        <aside className="go-nav__panel">
          <button className="go-nav__primary" type="button" onClick={startGps}>
            {gpsStatus === 'active' ? 'Reprendre / actualiser le GPS' : 'Démarrer la navigation GPS'}
          </button>

          <form className="go-nav__search" onSubmit={searchAddress}>
            <label htmlFor="go-nav-search">Rechercher une adresse ou une entreprise</label>
            <div className="go-nav__search-row">
              <input id="go-nav-search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Nom d’entreprise, rue, ville…" />
              <button type="submit" disabled={searching}>{searching ? '…' : 'Chercher'}</button>
            </div>
          </form>

          {searchResults.length > 0 && (
            <div className="go-nav__results" role="list" aria-label="Résultats de recherche">
              {searchResults.map((result) => (
                <button type="button" key={result.place_id} onClick={() => { setDestination({ label: result.display_name, latitude: Number(result.lat), longitude: Number(result.lon) }); setSearchResults([]); }}>
                  {result.display_name}
                </button>
              ))}
            </div>
          )}

          {destinationState && (
            <div className="go-nav__destination">
              <span className="go-nav__label">DESTINATION</span>
              <strong>{destinationState.label}</strong>
              {route && <div className="go-nav__metrics"><span>{formatDistance(route.distance)}</span><span>{formatDuration(route.duration)}</span></div>}
              <button type="button" className="go-nav__secondary" onClick={() => { setDestinationState(null); destinationRef.current = null; setRoute(null); routeRef.current = null; const map = mapRef.current; if (map?.isStyleLoaded()) syncMapData(map, null, currentPositionRef.current, reports); }}>Effacer l’itinéraire</button>
            </div>
          )}

          {mappedStops.length > 0 && (
            <section className="go-nav__stops">
              <button type="button" className="go-nav__section-toggle" onClick={() => setShowStops((v) => !v)}>
                <span>Tournée du jour ({mappedStops.length} arrêts)</span><span>{showStops ? '−' : '+'}</span>
              </button>
              <button
                type="button"
                className="go-nav__primary"
                disabled={mappedStops.filter((stop) => !stop.completed).length === 0}
                onClick={() => {
                  const remainingStops = mappedStops
                    .filter((stop) => !stop.completed)
                    .map((stop) => ({
                      label: stop.label,
                      latitude: Number(stop.latitude),
                      longitude: Number(stop.longitude),
                    }));
                  if (remainingStops.length === 0) {
                    setError("Il ne reste aucun arrêt à desservir.");
                    return;
                  }
                  routeStopsRef.current = remainingStops;
                  const lastStop = remainingStops[remainingStops.length - 1];
                  setDestinationState(lastStop);
                  destinationRef.current = lastStop;
                  if (currentPositionRef.current) {
                    void calculateRoute(currentPositionRef.current, remainingStops);
                  } else {
                    setError("Démarre le GPS pour calculer l’itinéraire complet.");
                  }
                }}
              >
                Calculer toute la tournée
              </button>
              {showStops && mappedStops.map((stop, index) => (
                <button type="button" className={`go-nav__stop ${stop.completed ? 'is-complete' : ''}`} key={stop.id} onClick={() => chooseStop(stop)}>
                  <span className="go-nav__stop-index">{stop.completed ? '✓' : index + 1}</span>
                  <span className="go-nav__stop-copy"><strong>{stop.label}</strong><small>{stop.address}{stop.timeWindowLabel ? ` · ${stop.timeWindowLabel}` : ''}</small></span>
                </button>
              ))}
              {stops.length > mappedStops.length && <p className="go-nav__hint">{stops.length - mappedStops.length} arrêt(s) sans coordonnées GPS ne peuvent pas encore être routés.</p>}
            </section>
          )}

          <section className="go-nav__reports">
            <span className="go-nav__label">SIGNALER UN ÉVÉNEMENT</span>
            <label htmlFor="go-report-type">Type</label>
            <select id="go-report-type" value={reportType} onChange={(e) => setReportType(e.target.value as GoReportType)}>
              {Object.entries(reportLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
            <input value={reportNote} onChange={(e) => setReportNote(e.target.value)} placeholder="Précision facultative" aria-label="Précision du signalement" maxLength={160} />
            <div className="go-nav__report-actions">
              <button type="button" className="go-nav__secondary" onClick={() => setReportMode((v) => !v)}>{reportMode ? 'Annuler le placement' : 'Placer sur la carte'}</button>
              <button type="button" className="go-nav__secondary" onClick={addReport} disabled={!position}>Signaler ici</button>
            </div>
            {reportMode && <p className="go-nav__hint">Touchez la carte à l’emplacement de l’événement.</p>}
            <p className="go-nav__hint">{reports.length} signalement(s) enregistrés sur cet appareil uniquement.</p>
          </section>

          {error && <p className="go-nav__error" role="alert">{error}</p>}
          {routeBusy && <p className="go-nav__hint">Calcul de l’itinéraire…</p>}
          <p className="go-nav__disclaimer">Prototype : pas de trafic temps réel ni de profil poids lourd. Utilise les indications uniquement à l’arrêt ou avec un support sécurisé.</p>
        </aside>

        <div className={`go-nav__map-wrap ${reportMode ? 'is-reporting' : ''}`}>
          <div ref={mapElement} className="go-nav__map" aria-label="Carte de navigation" />
          <div className="go-nav__map-caption">{reportMode ? 'Touchez la carte pour placer le signalement' : position ? 'Votre position GPS est affichée' : 'Démarrez le GPS pour afficher votre position'}</div>
        </div>
      </section>
    </main>
  );
}
