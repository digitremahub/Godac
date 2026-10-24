"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import "maplibre-gl/dist/maplibre-gl.css";
import type { Map as CarteMap, Marker, Popup } from "maplibre-gl";
import type { TourneeSuivie } from "@/app/api/suivi/route";
import { heureFin } from "@/lib/colis/estimation";
import { LIBELLES_ETAT, aSurveiller, libelleRetard } from "@/lib/exploitation/retards";
import { BlocRetards } from "@/components/suivi/BlocRetards";
import { COULEUR_ETAT } from "@/components/suivi/etat";
import { ficheChauffeur } from "@/components/suivi/fiche";

const STYLE = process.env.NEXT_PUBLIC_MAP_STYLE ?? "https://tiles.openfreemap.org/styles/liberty";
const COULEURS = ["#1BE4C1", "#2F7CF6", "#F25A22", "#A855F7", "#F5C842", "#EC4899", "#22C55E", "#0EA5E9"];
const RAFRAICHISSEMENT_MS = 20_000;

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
 * service. Bloc « Retards » en tête ; sur la carte, la pastille de chaque
 * chauffeur a la couleur de son état (dans les temps, à surveiller, en
 * retard, hors ligne) et le nombre d'arrêts restants ; un clic ouvre sa
 * fiche. Rafraîchi toutes les 20 secondes, en pause quand l'onglet est caché.
 */
export function SuiviTournees({ services, tourneeInitiale }: { services: { id: string; name: string }[]; tourneeInitiale?: string }) {
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
  const [focus, setFocus] = useState<string | null>(tourneeInitiale ?? null);
  // Fiche chauffeur ouverte : rouverte après chaque rafraîchissement des marqueurs.
  const fiche = useRef<Popup | null>(null);
  const ficheId = useRef<string | null>(tourneeInitiale ?? null);
  const reconstruction = useRef(false);
  // Tournées terminées : repliées sur une ligne, dépliées au clic.
  const [ouvertes, setOuvertes] = useState<Set<string>>(new Set());

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
    let minuteur: ReturnType<typeof setInterval> | null = null;
    const demarrer = () => {
      if (!minuteur) minuteur = setInterval(charger, RAFRAICHISSEMENT_MS);
    };
    const arreter = () => {
      if (minuteur) clearInterval(minuteur);
      minuteur = null;
    };
    // Onglet caché : on ne sollicite plus le serveur ; au retour, mise à jour immédiate.
    const visibilite = () => {
      if (document.hidden) arreter();
      else {
        charger();
        demarrer();
      }
    };
    charger();
    if (!document.hidden) demarrer();
    document.addEventListener("visibilitychange", visibilite);
    return () => {
      arreter();
      document.removeEventListener("visibilitychange", visibilite);
    };
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
    reconstruction.current = true;
    fiche.current?.remove();
    fiche.current = null;
    marqueurs.current.forEach((mk) => mk.remove());
    marqueurs.current = [];
    const pts: [number, number][] = [];
    tournees.forEach((t) => {
      const couleur = couleurDe(t.id);
      const attenue = focus !== null && focus !== t.id;
      t.arrets.forEach((a) => {
        if (a.lat === null || a.lng === null) return;
        const el = document.createElement("button");
        el.type = "button";
        el.setAttribute("aria-label", `${t.chauffeur} — arrêt ${a.ordre} — ${a.adresse}`);
        el.style.cursor = "pointer";
        const fait = a.status !== "pending";
        // Ramasse : carré à bordure dorée ; point relais : carré à bordure violette (mêmes couleurs que les encoches).
        Object.assign(el.style, {
          width: "12px",
          height: "12px",
          borderRadius: a.ramasse || a.relais ? "3px" : "999px",
          background: fait ? "#9AA3B5" : couleur,
          border: a.ramasse ? "2px solid #F5C842" : a.relais ? "2px solid #A78BFA" : "2px solid #FFFFFF",
          opacity: attenue ? "0.25" : fait ? "0.7" : "1",
        });
        el.title = `${t.chauffeur} — ${a.ramasse ? "ramasse" : a.relais ? "point relais" : "arrêt"} ${a.ordre}${fait ? " (fait)" : ""}`;
        el.addEventListener("click", (event) => {
          event.stopPropagation();
          const contenu = document.createElement("div");
          contenu.style.cssText = "min-width:210px;max-width:280px;font:13px system-ui,sans-serif;color:#0A0F1E";
          const titre = document.createElement("strong");
          titre.textContent = `${a.ordre}. ${a.ramasse ? "Ramasse" : a.relais ? `Point relais${typeof a.relais === "string" ? ` ${a.relais}` : ""}` : "Livraison"} · ${t.chauffeur}`;
          titre.style.cssText = "display:block;margin-bottom:6px;font-size:14px";
          const adresse = document.createElement("div");
          adresse.textContent = a.adresse;
          adresse.style.cssText = "margin-bottom:5px;white-space:normal";
          contenu.append(titre, adresse);
          if (a.preuve) {
            const preuve = document.createElement("div");
            preuve.textContent = a.preuve;
            preuve.style.cssText = "margin-bottom:5px;color:#4B5563";
            contenu.append(preuve);
          }
          if (a.destinataire) { const el = document.createElement("div"); el.textContent = `Destinataire : ${a.destinataire}`; contenu.append(el); }
          if (a.telephone) { const el = document.createElement("div"); el.textContent = `Téléphone : ${a.telephone}`; contenu.append(el); }
          const infos = document.createElement("div");
          infos.textContent = `${a.colis} colis · ${fait ? "Arrêt effectué" : "À faire"}`;
          infos.style.cssText = "margin-top:5px;font-weight:600";
          contenu.append(infos);
          new maplibregl.Popup({ offset: 12, closeButton: true, maxWidth: "320px" }).setLngLat([a.lng!, a.lat!]).setDOMContent(contenu).addTo(m);
          setFocus(t.id);
        });
        marqueurs.current.push(new maplibregl.Marker({ element: el }).setLngLat([a.lng, a.lat]).addTo(m));
        if (!attenue) pts.push([a.lng, a.lat]);
      });
      if (t.position) {
        const etat = t.retard?.etat ?? "dans_les_temps";
        const c = COULEUR_ETAT[t.statut === "in_progress" ? etat : "hors_ligne"];
        const el = document.createElement("button");
        el.type = "button";
        el.textContent = initiales(t.chauffeur);
        el.setAttribute("aria-label", `${t.chauffeur} — ${LIBELLES_ETAT[etat]} — ${t.adressesRestantes} arrêt${t.adressesRestantes > 1 ? "s" : ""} restant${t.adressesRestantes > 1 ? "s" : ""} — ${depuis(t.position.at)}`);
        Object.assign(el.style, {
          position: "relative",
          width: "36px",
          height: "36px",
          borderRadius: "999px",
          background: c.fond,
          color: c.texte,
          border: "3px solid #FFFFFF",
          boxShadow: "0 2px 8px rgba(10,15,30,.4)",
          font: "700 12px system-ui, sans-serif",
          cursor: "pointer",
          opacity: attenue ? "0.35" : "1",
          zIndex: "3",
        });
        // Pastille : arrêts restants.
        const pastille = document.createElement("span");
        pastille.textContent = String(t.adressesRestantes);
        Object.assign(pastille.style, {
          position: "absolute",
          top: "-8px",
          right: "-8px",
          minWidth: "18px",
          height: "18px",
          padding: "0 4px",
          borderRadius: "999px",
          background: "#0A0F1E",
          color: "#FFFFFF",
          border: "2px solid #FFFFFF",
          font: "700 10px/14px system-ui, sans-serif",
          textAlign: "center",
          boxSizing: "border-box",
        });
        el.append(pastille);
        const ouvrirFiche = () => {
          fiche.current?.remove();
          const popup = new maplibregl.Popup({ offset: 22, closeButton: true, maxWidth: "320px" }).setLngLat([t.position!.lng, t.position!.lat]).setDOMContent(ficheChauffeur(t));
          popup.on("close", () => {
            if (!reconstruction.current && fiche.current === popup) ficheId.current = null;
          });
          popup.addTo(m);
          fiche.current = popup;
          ficheId.current = t.id;
        };
        el.addEventListener("click", (event) => {
          event.stopPropagation();
          ouvrirFiche();
          setFocus(t.id);
        });
        marqueurs.current.push(new maplibregl.Marker({ element: el }).setLngLat([t.position.lng, t.position.lat]).addTo(m));
        if (!attenue) pts.push([t.position.lng, t.position.lat]);
        if (ficheId.current === t.id) ouvrirFiche();
      }
    });
    if (pts.length && (!cadre.current || focus)) {
      cadre.current = true;
      const b = pts.reduce((bb, p) => bb.extend(p), new maplibregl.LngLatBounds(pts[0]!, pts[0]!));
      m.fitBounds(b, { padding: 60, maxZoom: 14, duration: 500 });
    }
    reconstruction.current = false;
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
          {maj ? `Mis à jour ${depuis(maj)} · actualisation automatique toutes les 20 s` : "Chargement…"}
        </p>
        {focus && (
          <button type="button" className="btn-ghost !py-1 text-xs" onClick={() => setFocus(null)}>
            Voir toutes les tournées
          </button>
        )}
      </div>
      {erreur && <p className="rounded-lg bg-orange/10 px-3 py-2 text-sm text-orange-ink">{erreur}</p>}
      {tournees && <BlocRetards tournees={tournees} onVoir={(id) => (ficheId.current = id, setFocus(id))} />}

      <div className="grid gap-4 lg:grid-cols-[360px_1fr]">
        <div className="order-2 flex flex-col gap-3 lg:order-1 lg:max-h-[70vh] lg:overflow-y-auto">
          {tournees !== null && tournees.length === 0 && (
            <p className="rounded-xl bg-navy/[0.04] p-4 text-sm text-navy/65">Aucune tournée colis aujourd&apos;hui{service ? " pour ce service" : ""}.</p>
          )}
          {[...enCours, ...autres].map((t) => {
            const pct = t.adressesTotal ? Math.round((t.adressesFaites / t.adressesTotal) * 100) : 0;
            const terminee = t.statut === "done";
            const replie = terminee && !ouvertes.has(t.id);
            return (
              <button
                key={t.id}
                type="button"
                aria-expanded={terminee ? !replie : undefined}
                onClick={() => {
                  setFocus((f) => (f === t.id ? null : t.id));
                  if (terminee)
                    setOuvertes((o) => {
                      const n = new Set(o);
                      if (n.has(t.id)) n.delete(t.id);
                      else n.add(t.id);
                      return n;
                    });
                }}
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
                {replie ? (
                  <p className="mt-1 flex items-center justify-between text-xs text-navy/60">
                    <span>
                      {t.adressesFaites}/{t.adressesTotal} adresses faites
                    </span>
                    <span className="font-semibold text-teal-ink">Détail ▾</span>
                  </p>
                ) : (
                <>
                {terminee && <p className="mt-1 text-right text-xs font-semibold text-teal-ink">Replier ▴</p>}
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
                {t.statut === "in_progress" && (
                  <p className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-navy/50">
                    <span>📍 {depuis(t.position?.at)}</span>
                    {t.retard && aSurveiller(t.retard) && (
                      <span className="rounded-full px-2 py-0.5 font-bold" style={{ background: COULEUR_ETAT[t.retard.etat].fond, color: COULEUR_ETAT[t.retard.etat].texte }}>
                        {LIBELLES_ETAT[t.retard.etat]}
                        {t.retard.retardMin > 0 ? ` · +${libelleRetard(t.retard.retardMin)}` : ""}
                      </span>
                    )}
                  </p>
                )}
                <div className="mt-3 border-t border-navy/10 pt-2">
                  <p className="mb-1 text-xs font-semibold text-navy/70">Ordre de passage</p>
                  <ol className="flex flex-col gap-1">
                    {t.arrets.map((a) => (
                      <li key={`${t.id}-${a.ordre}`} className="flex gap-2 text-xs">
                        <span className={`w-5 shrink-0 text-right font-bold ${a.status === "pending" ? "text-teal-ink" : "text-navy/40"}`}>{a.ordre}.</span>
                        <span className="min-w-0 flex-1 break-words">
                          {a.ramasse ? "Ramasse · " : a.relais ? <span className="font-semibold text-relais-ink">Relais{typeof a.relais === "string" ? ` ${a.relais}` : ""} · </span> : ""}
                          {a.adresse}
                          {a.preuve && <span className="block text-navy/50">{a.preuve}</span>}
                        </span>
                        <span className="shrink-0 text-navy/45">{a.status === "pending" ? "À faire" : "Fait"}</span>
                      </li>
                    ))}
                  </ol>
                </div>
                </>
                )}
              </button>
            );
          })}
        </div>
        <div className="order-1 flex flex-col gap-2 lg:order-2">
          <div className="h-[55vh] overflow-hidden rounded-2xl border border-navy/10 lg:h-[70vh]">
            <div ref={conteneur} className="h-full w-full" role="region" aria-label="Carte des tournées en cours" />
          </div>
          <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-navy/65" aria-label="Légende des pastilles chauffeur">
            {(["dans_les_temps", "a_surveiller", "en_retard", "hors_ligne"] as const).map((e) => (
              <li key={e} className="flex items-center gap-1.5">
                <span className="h-3 w-3 rounded-full" style={{ background: COULEUR_ETAT[e].fond }} aria-hidden="true" />
                {LIBELLES_ETAT[e]}
              </li>
            ))}
            <li>Le chiffre = arrêts restants</li>
          </ul>
        </div>
      </div>
      <p className="text-xs text-navy/50">
        Position partagée par le chauffeur uniquement pendant sa tournée colis en cours (il peut la masquer pendant une pause) ; la
        dernière position est effacée à la clôture de la tournée, le trajet emprunté est gardé 1 an dans l&apos;historique des tournées.
      </p>
    </div>
  );
}
