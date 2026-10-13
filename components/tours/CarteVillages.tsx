"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import "maplibre-gl/dist/maplibre-gl.css";
import type { GeoJSONSource, Map as CarteMap, Popup } from "maplibre-gl";
import { Card } from "@/components/ui";
import type { TourRoute } from "@/components/tours/TourRoutesBoard";
import type { GeocodedVillage } from "@/app/api/tour-routes/geocode/route";
import { OUTLIER_MAX_KM, OUTLIER_RATIO, analyzeVillages, assignTourColors, villageKey, type LngLat, type MapVillage } from "@/lib/tours/carte-villages";

/** Même fond de carte que la tournée colis et le suivi (OpenFreeMap), remplaçable par variable d'environnement. */
const STYLE = process.env.NEXT_PUBLIC_MAP_STYLE ?? "https://tiles.openfreemap.org/styles/liberty";
const ALERTE = "#F25A22";
const NAVY = "#0A0F1E";
const SANS_SERVICE = "__aucun__";

type Geo = Pick<GeocodedVillage, "lat" | "lng" | "inseeCode" | "geoStatus">;
type EtatGeo = "attente" | "en_cours" | "termine" | "hors_ligne" | "indisponible";

function plural(n: number, mot: string) {
  return `${n} ${mot}${n > 1 ? "s" : ""}`;
}

/**
 * Carte des villages de toutes les tournées : un point par village, une
 * couleur par tournée, l'étendue de chaque tournée (enveloppe convexe)
 * en aplat léger pour voir les chevauchements. À côté, les incohérences :
 * village sur plusieurs tournées, village loin du reste de sa tournée,
 * village non localisé. Les communes sont localisées une fois pour toutes
 * (geo.api.gouv.fr) au premier affichage, puis lues depuis la base.
 */
export function CarteVillages({ routes, services, geoReady }: { routes: TourRoute[]; services: { id: string; name: string }[]; geoReady: boolean }) {
  const [geo, setGeo] = useState<Map<string, Geo>>(new Map());
  const [etat, setEtat] = useState<EtatGeo>(geoReady ? "attente" : "indisponible");
  const [restants, setRestants] = useState(0);
  const [service, setService] = useState("");
  const [masquees, setMasquees] = useState<Set<string>>(new Set());
  const [selection, setSelection] = useState<string | null>(null);

  // Tous les villages, avec les coordonnées trouvées pendant cette visite.
  const villages: MapVillage[] = useMemo(
    () =>
      routes.flatMap((r) =>
        r.villages
          .filter((v) => v.id)
          .map((v) => {
            const g = geo.get(v.id!);
            return {
              id: v.id!,
              routeId: r.id,
              tourNumber: r.tourNumber,
              serviceId: r.serviceId,
              serviceName: r.serviceName,
              name: v.name,
              postalCode: v.postal_code,
              lat: g ? g.lat : (v.lat ?? null),
              lng: g ? g.lng : (v.lng ?? null),
              inseeCode: g ? g.inseeCode : (v.insee_code ?? null),
              geoStatus: g ? g.geoStatus : (v.geocode_status ?? null),
            };
          }),
      ),
    [routes, geo],
  );

  // Localisation des villages jamais cherchés, par lots.
  useEffect(() => {
    if (!geoReady || !routes.some((r) => r.villages.some((v) => v.id && !v.geocode_status))) {
      if (geoReady) setEtat("termine");
      return;
    }
    let annule = false;
    (async () => {
      setEtat("en_cours");
      for (let tour = 0; tour < 40 && !annule; tour++) {
        let json: {
          results?: GeocodedVillage[];
          remaining?: number;
          offline?: boolean;
          persisted?: boolean;
        };
        try {
          const res = await fetch("/api/tour-routes/geocode", {
            method: "POST",
          });
          json = await res.json();
          if (!res.ok) throw new Error();
        } catch {
          if (!annule) setEtat("hors_ligne");
          return;
        }
        if (annule) return;
        const results = json.results ?? [];
        if (results.length) {
          setGeo((prev) => {
            const next = new Map(prev);
            for (const r of results) next.set(r.id, r);
            return next;
          });
        }
        setRestants(json.remaining ?? 0);
        if (json.offline) return setEtat("hors_ligne");
        // Rien d'écrit en base : relancer chercherait les mêmes villages.
        if (!json.remaining || !results.length || json.persisted === false) return setEtat("termine");
      }
      if (!annule) setEtat("termine");
    })();
    return () => {
      annule = true;
    };
  }, [geoReady, routes]);

  const couleurs = useMemo(() => {
    const parNumero = assignTourColors(routes.map((r) => r.tourNumber));
    return new Map(routes.map((r) => [r.id, parNumero.get(r.tourNumber)!]));
  }, [routes]);

  const tourneesDuService = useMemo(() => routes.filter((r) => !service || (service === SANS_SERVICE ? !r.serviceId : r.serviceId === service)), [routes, service]);
  const idsService = useMemo(() => new Set(tourneesDuService.map((r) => r.id)), [tourneesDuService]);
  const affichees = useMemo(() => new Set(tourneesDuService.filter((r) => !masquees.has(r.id)).map((r) => r.id)), [tourneesDuService, masquees]);

  // Doublons cherchés sur toutes les tournées (même hors du service filtré) ; le reste par service.
  const analyse = useMemo(() => analyzeVillages(villages), [villages]);
  const doublons = analyse.duplicates.filter((d) => d.villages.some((v) => idsService.has(v.routeId)));
  const isoles = analyse.outliers.filter((o) => idsService.has(o.village.routeId));
  const nonLocalises = analyse.unlocated.filter((v) => idsService.has(v.routeId));
  const clesDoublons = useMemo(() => new Set(analyse.duplicates.map((d) => d.key)), [analyse]);
  const idsIsoles = useMemo(() => new Set(analyse.outliers.map((o) => o.village.id)), [analyse]);

  // --- Carte -------------------------------------------------------------
  const conteneur = useRef<HTMLDivElement>(null);
  const carte = useRef<CarteMap | null>(null);
  const lib = useRef<typeof import("maplibre-gl") | null>(null);
  const popup = useRef<Popup | null>(null);
  const [prete, setPrete] = useState(false);
  const [erreurCarte, setErreurCarte] = useState(false);

  useEffect(() => {
    let annule = false;
    (async () => {
      try {
        const maplibregl = await import("maplibre-gl");
        if (annule || !conteneur.current) return;
        lib.current = maplibregl;
        const m = new maplibregl.Map({
          container: conteneur.current,
          style: STYLE,
          center: [2.4, 46.6],
          zoom: 5,
          attributionControl: { compact: true },
        });
        m.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
        m.on("load", () => {
          const vide = { type: "FeatureCollection" as const, features: [] };
          m.addSource("etendues", { type: "geojson", data: vide });
          m.addSource("villages", { type: "geojson", data: vide });
          m.addLayer({
            id: "etendues-fond",
            type: "fill",
            source: "etendues",
            filter: ["==", ["geometry-type"], "Polygon"],
            paint: { "fill-color": ["get", "couleur"], "fill-opacity": 0.12 },
          });
          m.addLayer({
            id: "etendues-bord",
            type: "line",
            source: "etendues",
            paint: {
              "line-color": ["get", "couleur"],
              "line-width": 2,
              "line-opacity": 0.75,
            },
            layout: { "line-join": "round" },
          });
          m.addLayer({
            id: "villages-alerte",
            type: "circle",
            source: "villages",
            filter: ["==", ["get", "alerte"], true],
            paint: {
              "circle-radius": 11,
              "circle-color": "rgba(0,0,0,0)",
              "circle-stroke-color": ALERTE,
              "circle-stroke-width": 3,
            },
          });
          m.addLayer({
            id: "villages",
            type: "circle",
            source: "villages",
            paint: {
              "circle-radius": ["case", ["==", ["get", "choisi"], true], 9, 6],
              "circle-color": ["get", "couleur"],
              "circle-stroke-color": ["case", ["==", ["get", "choisi"], true], NAVY, "#FFFFFF"],
              "circle-stroke-width": ["case", ["==", ["get", "choisi"], true], 3, 1.5],
            },
          });
          m.on("click", "villages", (e) => {
            const id = e.features?.[0]?.properties?.id;
            if (typeof id === "string") setSelection(id);
          });
          m.on("mouseenter", "villages", () => (m.getCanvas().style.cursor = "pointer"));
          m.on("mouseleave", "villages", () => (m.getCanvas().style.cursor = ""));
          setPrete(true);
        });
        m.on("error", () => setErreurCarte(true));
        carte.current = m;
      } catch {
        if (!annule) setErreurCarte(true);
      }
    })();
    return () => {
      annule = true;
      popup.current?.remove();
      carte.current?.remove();
      carte.current = null;
    };
  }, []);

  const visibles = useMemo(() => villages.filter((v) => affichees.has(v.routeId) && v.lat !== null && v.lng !== null), [villages, affichees]);

  // Points et étendues.
  useEffect(() => {
    const m = carte.current;
    if (!m || !prete) return;
    (m.getSource("villages") as GeoJSONSource | undefined)?.setData({
      type: "FeatureCollection",
      features: visibles.map((v) => ({
        type: "Feature",
        properties: {
          id: v.id,
          couleur: couleurs.get(v.routeId) ?? NAVY,
          alerte: idsIsoles.has(v.id) || clesDoublons.has(villageKey(v)),
          choisi: v.id === selection,
        },
        geometry: { type: "Point", coordinates: [v.lng!, v.lat!] },
      })),
    });
    const features = Array.from(analyse.extents.values())
      .filter((e) => affichees.has(e.routeId) && e.hull.length >= 2)
      .map((e) => ({
        type: "Feature" as const,
        properties: { couleur: couleurs.get(e.routeId) ?? NAVY },
        geometry:
          e.hull.length >= 3
            ? {
                type: "Polygon" as const,
                coordinates: [[...e.hull, e.hull[0]!]],
              }
            : { type: "LineString" as const, coordinates: e.hull },
      }));
    (m.getSource("etendues") as GeoJSONSource | undefined)?.setData({
      type: "FeatureCollection",
      features,
    });
  }, [prete, visibles, analyse, affichees, couleurs, idsIsoles, clesDoublons, selection]);

  function cadrer(points: LngLat[]) {
    const m = carte.current;
    const maplibregl = lib.current;
    if (!m || !maplibregl || !points.length) return;
    const b = points.reduce((bb, p) => bb.extend(p), new maplibregl.LngLatBounds(points[0]!, points[0]!));
    m.fitBounds(b, { padding: 50, maxZoom: 12, duration: 500 });
  }
  const toutVoir = () => cadrer(visibles.map((v) => [v.lng!, v.lat!]));

  // Cadrage dès que des villages sont localisés, puis à chaque changement de service.
  const dejaCadre = useRef<string | null>(null);
  useEffect(() => {
    if (!prete || !visibles.length || dejaCadre.current === service) return;
    dejaCadre.current = service;
    carte.current?.resize();
    toutVoir();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prete, visibles.length > 0, service]);

  // Bulle du village choisi : son nom, ses tournées, leur service.
  const choisi = villages.find((v) => v.id === selection) ?? null;
  useEffect(() => {
    const m = carte.current;
    const maplibregl = lib.current;
    popup.current?.remove();
    if (!m || !maplibregl || !prete || !choisi || choisi.lat === null || choisi.lng === null) return;
    const memes = villages.filter((v) => villageKey(v) === villageKey(choisi));
    const el = document.createElement("div");
    el.style.font = "13px system-ui, sans-serif";
    el.style.color = NAVY;
    const titre = document.createElement("p");
    titre.style.fontWeight = "700";
    titre.textContent = [choisi.name, choisi.postalCode].filter(Boolean).join(" ");
    el.appendChild(titre);
    for (const v of memes) {
      const ligne = document.createElement("p");
      ligne.style.display = "flex";
      ligne.style.alignItems = "center";
      ligne.style.gap = "6px";
      const pastille = document.createElement("span");
      Object.assign(pastille.style, {
        width: "10px",
        height: "10px",
        borderRadius: "999px",
        background: couleurs.get(v.routeId) ?? NAVY,
        flexShrink: "0",
      });
      ligne.appendChild(pastille);
      ligne.appendChild(document.createTextNode(`Tournée ${v.tourNumber} · ${v.serviceName ?? "Tous services"}`));
      el.appendChild(ligne);
    }
    const isole = analyse.outliers.find((o) => o.village.id === choisi.id);
    if (memes.length > 1 || isole) {
      const alerte = document.createElement("p");
      alerte.style.color = "#B4410F";
      alerte.style.marginTop = "4px";
      alerte.textContent = [memes.length > 1 ? `Sur ${memes.length} tournées` : null, isole ? `À ${Math.round(isole.distanceKm)} km du centre de sa tournée` : null]
        .filter(Boolean)
        .join(" · ");
      el.appendChild(alerte);
    }
    popup.current = new maplibregl.Popup({
      offset: 12,
      closeButton: true,
      maxWidth: "280px",
    })
      .setLngLat([choisi.lng, choisi.lat])
      .setDOMContent(el)
      .addTo(m);
    popup.current.on("close", () => setSelection((s) => (s === choisi.id ? null : s)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selection, prete, choisi?.lat, choisi?.lng]);

  function montrer(v: MapVillage) {
    if (!affichees.has(v.routeId))
      setMasquees((prev) => {
        const next = new Set(prev);
        next.delete(v.routeId);
        return next;
      });
    setSelection(v.id);
    if (v.lat !== null && v.lng !== null)
      carte.current?.easeTo({
        center: [v.lng, v.lat],
        zoom: Math.max(carte.current.getZoom(), 10),
        duration: 500,
      });
  }

  function basculer(routeId: string) {
    setMasquees((prev) => {
      const next = new Set(prev);
      if (next.has(routeId)) next.delete(routeId);
      else next.add(routeId);
      return next;
    });
  }

  const sansService = routes.some((r) => !r.serviceId);
  const servicesUtilises = services.filter((s) => routes.some((r) => r.serviceId === s.id));
  const totalVillages = villages.filter((v) => idsService.has(v.routeId)).length;
  const totalLocalises = totalVillages - nonLocalises.length;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
        {(servicesUtilises.length > 1 || (servicesUtilises.length && sansService)) && (
          <label className="block sm:w-64">
            <span className="label">Service</span>
            <select className="input" value={service} onChange={(e) => setService(e.target.value)}>
              <option value="">Tous les services</option>
              {servicesUtilises.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
              {sansService && <option value={SANS_SERVICE}>Tournées sans service</option>}
            </select>
          </label>
        )}
        <p className="text-sm text-navy/60 sm:ml-auto" aria-live="polite">
          {etat === "en_cours"
            ? `Localisation des villages en cours…${restants ? ` (${restants} restants)` : ""}`
            : etat === "hors_ligne"
              ? "Service de localisation des communes injoignable : certains villages restent non localisés, réessayez plus tard."
              : etat === "indisponible"
                ? "La carte sera disponible après la mise à jour de la base de données."
                : `${totalLocalises} village${totalLocalises > 1 ? "s" : ""} sur la carte sur ${totalVillages}.`}
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="relative h-[62vh] min-h-[420px] overflow-hidden rounded-2xl border border-navy/[0.08] bg-navy/[0.03]">
          <div ref={conteneur} className="h-full w-full" role="region" aria-label="Carte des villages par tournée" />
          <button type="button" className="absolute left-3 top-3 rounded-full bg-surface px-3 py-2 text-xs font-semibold shadow-pop" onClick={toutVoir}>
            Tout voir
          </button>
          {erreurCarte && (
            <p className="absolute inset-x-3 bottom-3 rounded-xl bg-orange px-3 py-2 text-xs font-semibold text-white shadow-pop">
              Fond de carte indisponible (réseau ?). Les villages et les incohérences restent listés à côté.
            </p>
          )}
        </div>

        <div className="flex flex-col gap-4">
          <Card className="flex flex-col gap-2">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-base">Tournées</h2>
              <div className="flex gap-1 text-xs">
                <button type="button" className="btn-ghost !px-2 !py-1" onClick={() => setMasquees(new Set())}>
                  Toutes
                </button>
                <button type="button" className="btn-ghost !px-2 !py-1" onClick={() => setMasquees(new Set(tourneesDuService.map((r) => r.id)))}>
                  Aucune
                </button>
              </div>
            </div>
            {tourneesDuService.length === 0 ? (
              <p className="text-sm text-navy/55">Aucune tournée.</p>
            ) : (
              <ul className="flex max-h-[300px] flex-col overflow-y-auto">
                {tourneesDuService.map((r) => {
                  const etendue = analyse.extents.get(r.id);
                  const localises = villages.filter((v) => v.routeId === r.id && v.lat !== null).length;
                  return (
                    <li key={r.id}>
                      <label className="flex cursor-pointer items-center gap-2.5 rounded-lg px-1.5 py-1.5 hover:bg-navy/[0.04]">
                        <input type="checkbox" className="h-4 w-4 shrink-0" checked={!masquees.has(r.id)} onChange={() => basculer(r.id)} />
                        <span className="h-3.5 w-3.5 shrink-0 rounded-full border-2 border-white shadow" style={{ background: couleurs.get(r.id) }} aria-hidden />
                        <span className="min-w-0 flex-1 text-sm">
                          <span className="font-semibold tabular-nums">{r.tourNumber}</span>
                          <span className="text-navy/60"> · {r.serviceName ?? "Tous services"}</span>
                          <span className="block text-xs text-navy/55">
                            {plural(r.villages.length, "village")}
                            {localises < r.villages.length && ` (${r.villages.length - localises} non localisé${r.villages.length - localises > 1 ? "s" : ""})`}
                            {etendue && etendue.spanKm >= 1 && ` · étendue ${Math.round(etendue.spanKm)} km`}
                          </span>
                        </span>
                      </label>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>

          <Card className="flex flex-col gap-3">
            <h2 className="text-base">Incohérences</h2>
            {doublons.length + isoles.length + nonLocalises.length === 0 ? (
              <p className="text-sm text-navy/55">{etat === "en_cours" ? "Analyse en cours…" : "Rien à signaler."}</p>
            ) : null}

            {doublons.length > 0 && (
              <section>
                <h3 className="text-sm font-semibold">Sur plusieurs tournées ({doublons.length})</h3>
                <ul className="mt-1 flex flex-col">
                  {doublons.map((d) => (
                    <li key={d.key}>
                      <button
                        type="button"
                        className="w-full rounded-lg px-1.5 py-1 text-left text-sm hover:bg-navy/[0.04]"
                        onClick={() => montrer(d.villages.find((v) => idsService.has(v.routeId)) ?? d.villages[0]!)}
                      >
                        <span className="font-semibold">{d.name}</span>
                        <span className="text-navy/60">
                          {" "}
                          — {d.tourNumbers.join(", ")} · {d.sameService ? "même service" : "services différents"}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {isoles.length > 0 && (
              <section>
                <h3 className="text-sm font-semibold">Loin du reste de la tournée ({isoles.length})</h3>
                <ul className="mt-1 flex flex-col">
                  {isoles.map((o) => (
                    <li key={o.village.id}>
                      <button type="button" className="w-full rounded-lg px-1.5 py-1 text-left text-sm hover:bg-navy/[0.04]" onClick={() => montrer(o.village)}>
                        <span className="font-semibold">{o.village.name}</span>
                        <span className="text-navy/60">
                          {" "}
                          — {o.village.tourNumber} · à {Math.round(o.distanceKm)} km du centre (médiane {Math.round(o.medianKm)} km)
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {nonLocalises.length > 0 && (
              <section>
                <h3 className="text-sm font-semibold">Non localisés ({nonLocalises.length})</h3>
                <ul className="mt-1 flex max-h-[220px] flex-col overflow-y-auto">
                  {nonLocalises.map((v) => (
                    <li key={v.id} className="px-1.5 py-1 text-sm">
                      <span className="font-semibold">{v.name}</span>
                      {v.postalCode && <span className="tabular-nums text-navy/60"> {v.postalCode}</span>}
                      <span className="text-navy/60">
                        {" "}
                        — {v.tourNumber} · {v.geoStatus === "introuvable" ? "commune introuvable" : etat === "en_cours" ? "en attente" : "pas encore localisé"}
                      </span>
                    </li>
                  ))}
                </ul>
                <p className="mt-1 text-xs text-navy/55">Vérifiez l&apos;orthographe ou ajoutez le code postal dans la fiche de la tournée.</p>
              </section>
            )}

            <p className="text-xs text-navy/50">
              Cerclés d&apos;orange sur la carte : villages sur plusieurs tournées ou à plus de {OUTLIER_RATIO.toLocaleString("fr-FR")}× la distance habituelle (ou
              {` ${OUTLIER_MAX_KM}`} km) du centre de leur tournée. Commune mal placée ? Ajoutez son code postal dans la fiche.
            </p>
          </Card>
        </div>
      </div>
    </div>
  );
}
