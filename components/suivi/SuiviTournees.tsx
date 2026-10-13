"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import "maplibre-gl/dist/maplibre-gl.css";
import type { Map as CarteMap, Marker } from "maplibre-gl";
import type { TourneeSuivie } from "@/app/api/suivi/route";
import { heureFin } from "@/lib/colis/estimation";

const STYLE = process.env.NEXT_PUBLIC_MAP_STYLE ?? "https://tiles.openfreemap.org/styles/liberty";
const COULEURS = ["#1BE4C1", "#2F7CF6", "#F25A22", "#A855F7", "#F5C842", "#EC4899", "#22C55E", "#0EA5E9"];
const RAFRAICHISSEMENT_MS = 30_000;

function initiales(nom: string) {
  return nom
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((m) => m[0]!.toUpperCase())
    .join("");
}

function depuis(iso: string | null | undefined): string {
  if (!iso) return "position non partagée";
  const min = Math.round((Date.now() - Date.parse(iso)) / 60000);
  return min <= 1 ? "à l'instant" : min < 60 ? `il y a ${min} min` : `il y a ${Math.floor(min / 60)} h`;
}

/**
 * Suivi des tournées colis du jour pour la direction et l'exploitation :
 * dernière position partagée par chaque chauffeur (pendant sa tournée
 * uniquement), arrêts restants, avancement et fin estimée, filtre par
 * service. Rafraîchi toutes les 30 secondes.
 */
export function SuiviTournees({ services }: { services: { id: string; name: string }[] }) {
  const conteneur = useRef<HTMLDivElement>(null);
  const carte = useRef<CarteMap | null>(null);
  const lib = useRef<typeof import("maplibre-gl") | null>(null);
  const marqueurs = useRef<Marker[]>([]);
  const cadre = useRef(false);
  const [prete, setPrete] = useState(false);
  const [service, setService] = useState("");
  const [tournees, setTournees] = useState<TourneeSuivie[] | null>(null);
  const [maj, setMaj] = useState<string | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [focus, setFocus] = useState<string | null>(null);

  const charger = useCallback(async () => {
    try {
      const res = await fetch(`/api/suivi${service ? `?service=${service}` : ""}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Erreur");
      setTournees(json.tournees);
      setMaj(json.maj);
      setErreur(null);
    } catch (e) {
      setErreur(e instanceof Error ? e.message : "Suivi indisponible.");
    }
  }, [service]);

  useEffect(() => {
    cadre.current = false;
    charger();
    const t = setInterval(charger, RAFRAICHISSEMENT_MS);
    return () => clearInterval(t);
  }, [charger]);

  useEffect(() => {
    let annule = false;
    (async () => {
      const maplibregl = await import("maplibre-gl");
      if (annule || !conteneur.current) return;
      lib.current = maplibregl;
      const m = new maplibregl.Map({ container: conteneur.current, style: STYLE, center: [2.4, 46.6], zoom: 5, attributionControl: { compact: true } });
      m.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
      m.on("load", () => setPrete(true));
      carte.current = m;
    })();
    return () => {
      annule = true;
      carte.current?.remove();
      carte.current = null;
    };
  }, []);

  const couleurDe = (id: string) => COULEURS[(tournees ?? []).findIndex((t) => t.id === id) % COULEURS.length] ?? COULEURS[0]!;

  // Marqueurs : chauffeurs (position) et arrêts (restants colorés, faits en gris).
  useEffect(() => {
    const m = carte.current;
    const maplibregl = lib.current;
    if (!m || !maplibregl || !prete || !tournees) return;
    marqueurs.current.forEach((mk) => mk.remove());
    marqueurs.current = [];
    const pts: [number, number][] = [];
    tournees.forEach((t) => {
      const couleur = couleurDe(t.id);
      const attenue = focus !== null && focus !== t.id;
      t.arrets.forEach((a) => {
        const el = document.createElement("div");
        const fait = a.status !== "pending";
        Object.assign(el.style, {
          width: "12px",
          height: "12px",
          borderRadius: "999px",
          background: fait ? "#9AA3B5" : couleur,
          border: "2px solid #FFFFFF",
          opacity: attenue ? "0.25" : fait ? "0.7" : "1",
        });
        el.title = `${t.chauffeur} — arrêt ${a.ordre}${fait ? " (fait)" : ""}`;
        marqueurs.current.push(new maplibregl.Marker({ element: el }).setLngLat([a.lng, a.lat]).addTo(m));
        if (!attenue) pts.push([a.lng, a.lat]);
      });
      if (t.position) {
        const el = document.createElement("button");
        el.type = "button";
        el.textContent = initiales(t.chauffeur);
        el.setAttribute("aria-label", `${t.chauffeur} — ${depuis(t.position.at)}`);
        Object.assign(el.style, {
          width: "36px",
          height: "36px",
          borderRadius: "999px",
          background: couleur,
          color: "#0A0F1E",
          border: "3px solid #FFFFFF",
          boxShadow: "0 2px 8px rgba(10,15,30,.4)",
          font: "700 12px system-ui, sans-serif",
          cursor: "pointer",
          opacity: attenue ? "0.35" : "1",
          zIndex: "3",
        });
        el.addEventListener("click", () => setFocus((f) => (f === t.id ? null : t.id)));
        marqueurs.current.push(new maplibregl.Marker({ element: el }).setLngLat([t.position.lng, t.position.lat]).addTo(m));
        if (!attenue) pts.push([t.position.lng, t.position.lat]);
      }
    });
    if (pts.length && (!cadre.current || focus)) {
      cadre.current = true;
      const b = pts.reduce((bb, p) => bb.extend(p), new maplibregl.LngLatBounds(pts[0]!, pts[0]!));
      m.fitBounds(b, { padding: 60, maxZoom: 14, duration: 500 });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tournees, prete, focus]);

  const enCours = (tournees ?? []).filter((t) => t.statut === "in_progress");
  const autres = (tournees ?? []).filter((t) => t.statut !== "in_progress");

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-sm">
          <span className="text-navy/65">Service</span>
          <select className="input !w-auto !py-1.5" value={service} onChange={(e) => (setService(e.target.value), setFocus(null))}>
            <option value="">Tous les services</option>
            {services.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        <p className="text-xs text-navy/55">
          {maj ? `Mis à jour ${depuis(maj)} · actualisation automatique toutes les 30 s` : "Chargement…"}
        </p>
        {focus && (
          <button type="button" className="btn-ghost !py-1 text-xs" onClick={() => setFocus(null)}>
            Voir toutes les tournées
          </button>
        )}
      </div>
      {erreur && <p className="rounded-lg bg-orange/10 px-3 py-2 text-sm text-orange-ink">{erreur}</p>}

      <div className="grid gap-4 lg:grid-cols-[360px_1fr]">
        <div className="order-2 flex flex-col gap-3 lg:order-1 lg:max-h-[70vh] lg:overflow-y-auto">
          {tournees !== null && tournees.length === 0 && (
            <p className="rounded-xl bg-navy/[0.04] p-4 text-sm text-navy/65">Aucune tournée colis aujourd&apos;hui{service ? " pour ce service" : ""}.</p>
          )}
          {[...enCours, ...autres].map((t) => {
            const pct = t.adressesTotal ? Math.round((t.adressesFaites / t.adressesTotal) * 100) : 0;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => setFocus((f) => (f === t.id ? null : t.id))}
                className={`rounded-xl border bg-surface p-3 text-left shadow-card transition-colors ${focus === t.id ? "border-teal" : "border-navy/10 hover:border-navy/25"}`}
              >
                <div className="flex items-center gap-2">
                  <span className="h-3 w-3 shrink-0 rounded-full" style={{ background: couleurDe(t.id) }} aria-hidden="true" />
                  <p className="min-w-0 flex-1 truncate font-semibold">{t.chauffeur}</p>
                  <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${t.statut === "in_progress" ? "bg-teal/15 text-teal-ink" : "bg-navy/[0.06] text-navy/60"}`}>
                    {t.statut === "in_progress" ? "En livraison" : t.statut === "done" ? "Terminée" : "Chargement"}
                  </span>
                </div>
                <p className="mt-0.5 truncate text-xs text-navy/60">
                  {[t.nom, t.services.map((s) => s.nom).join(", ")].filter(Boolean).join(" · ")}
                </p>
                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-navy/10" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
                  <div className="h-full rounded-full bg-teal" style={{ width: `${pct}%` }} />
                </div>
                <div className="mt-2 grid grid-cols-3 gap-1 text-center text-xs">
                  <div>
                    <p className="font-display text-base font-bold tabular-nums">{t.adressesRestantes}</p>
                    <p className="text-navy/55">adresses</p>
                  </div>
                  <div>
                    <p className="font-display text-base font-bold tabular-nums">{t.colisRestants}</p>
                    <p className="text-navy/55">colis</p>
                  </div>
                  <div>
                    <p className="font-display text-base font-bold tabular-nums">{heureFin(t.finEstimee) ?? "—"}</p>
                    <p className="text-navy/55">fin estimée</p>
                  </div>
                </div>
                {t.statut === "in_progress" && <p className="mt-1 text-[11px] text-navy/50">📍 {depuis(t.position?.at)}</p>}
              </button>
            );
          })}
        </div>
        <div className="order-1 h-[55vh] overflow-hidden rounded-2xl border border-navy/10 lg:order-2 lg:h-[70vh]">
          <div ref={conteneur} className="h-full w-full" role="region" aria-label="Carte des tournées en cours" />
        </div>
      </div>
      <p className="text-xs text-navy/50">
        Position partagée par le chauffeur uniquement pendant sa tournée colis en cours (il peut la masquer pendant une pause) ; seule la
        dernière position est conservée, effacée à la clôture de la tournée.
      </p>
    </div>
  );
}
