"use client";

import { useEffect, useRef, useState } from "react";
import { traceGpsAutorisee } from "@/lib/go-lieux/mission";
import { MAX_POINTS_REQUETE, ajouterAFile, doitEnvoyer, doitEnvoyerPosition, garderPoint, lireFile, type PointTrace } from "@/lib/colis/trace-gps";

const CLE_FILE = (runId: string) => `godac.trace-gps.${runId}`;
/** Vérification de la file (envoi par lots). */
const VERIFICATION_MS = 5_000;
/** Après une erreur serveur : nouvel essai au plus tôt dans 60 s. */
const ATTENTE_ERREUR_MS = 60_000;

function memoriser(runId: string, file: readonly PointTrace[]) {
  try {
    if (file.length) localStorage.setItem(CLE_FILE(runId), JSON.stringify(file));
    else localStorage.removeItem(CLE_FILE(runId));
  } catch {
    /* stockage indisponible ou plein : la file reste en mémoire */
  }
}

/**
 * Fil d'Ariane GPS de la tournée colis en cours (historique : trajet
 * réellement emprunté). Actif seulement si `runId` est celui d'une tournée
 * en cours et que le chauffeur n'a pas mis le partage de position en pause.
 * Points filtrés (précision ≤ 50 m, 20 m ou 30 s d'écart), envoyés par lots
 * à /api/colis/trace ; file locale plafonnée si le réseau est coupé. Le même
 * appel porte la dernière position du chauffeur (carte de suivi de
 * l'exploitation) : plus d'appel séparé à /api/colis/position.
 * Renvoie `true` quand l'enregistrement est actif (indicateur discret).
 */
export function useTraceGps(runId: string | null, actif: boolean): boolean {
  const [enregistre, setEnregistre] = useState(false);
  const file = useRef<PointTrace[]>([]);
  const dernierGarde = useRef<PointTrace | null>(null);
  const dernierFix = useRef<{ lat: number; lng: number } | null>(null);
  const dernierEnvoi = useRef(0);
  const pauseJusqua = useRef(0);
  const envoiEnCours = useRef(false);

  useEffect(() => {
    // « Aller à… » (mission libre) : jamais de trace, quoi qu'il arrive (RGPD).
    if (!runId || !traceGpsAutorisee(runId) || !actif || typeof navigator === "undefined" || !navigator.geolocation) {
      setEnregistre(false);
      return;
    }
    let fini = false;
    try {
      file.current = lireFile(localStorage.getItem(CLE_FILE(runId)));
    } catch {
      file.current = [];
    }
    dernierGarde.current = file.current[file.current.length - 1] ?? null;
    dernierFix.current = null;
    dernierEnvoi.current = Date.now();

    async function envoyer(force = false) {
      const maintenant = Date.now();
      if (!runId || envoiEnCours.current || maintenant < pauseJusqua.current) return;
      const positionSeule = !force && doitEnvoyerPosition(dernierFix.current !== null, file.current.length, dernierEnvoi.current, maintenant);
      if (!force && !positionSeule && !doitEnvoyer(file.current.length, dernierEnvoi.current, maintenant)) return;
      if (!file.current.length && !positionSeule) return;
      if (typeof navigator !== "undefined" && navigator.onLine === false) return;
      const lot = file.current.slice(0, MAX_POINTS_REQUETE);
      envoiEnCours.current = true;
      dernierEnvoi.current = maintenant;
      try {
        const res = await fetch("/api/colis/trace", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          // Position jointe sauf à la fermeture / mise en pause (un envoi final ne doit pas republier une position masquée).
          body: JSON.stringify({ run_id: runId, points: lot, ...(!force && dernierFix.current ? { position: dernierFix.current } : {}) }),
          keepalive: force,
        });
        if (res.ok || (res.status >= 400 && res.status < 500 && res.status !== 401 && res.status !== 408 && res.status !== 429)) {
          // Enregistré, ou refusé pour de bon (tournée close, requête invalide) : on retire le lot.
          if (lot.length) {
            const fin = lot[lot.length - 1]!.t;
            file.current = file.current.filter((p) => p.t > fin);
            memoriser(runId, file.current);
          }
          const j = res.ok ? ((await res.json().catch(() => null)) as { ignore?: boolean } | null) : null;
          if (j?.ignore) file.current = [];
        } else pauseJusqua.current = Date.now() + ATTENTE_ERREUR_MS;
      } catch {
        // Réseau coupé : le lot reste dans la file.
        pauseJusqua.current = Date.now() + 15_000;
      } finally {
        envoiEnCours.current = false;
      }
    }

    const id = navigator.geolocation.watchPosition(
      (g) => {
        if (fini) return;
        const p: PointTrace = {
          t: Math.round(g.timestamp || Date.now()),
          lat: Math.round(g.coords.latitude * 1e6) / 1e6,
          lng: Math.round(g.coords.longitude * 1e6) / 1e6,
          acc: g.coords.accuracy != null ? Math.round(g.coords.accuracy) : null,
          v: g.coords.speed != null && Number.isFinite(g.coords.speed) && g.coords.speed >= 0 ? Math.round(g.coords.speed * 10) / 10 : null,
          cap: g.coords.heading != null && Number.isFinite(g.coords.heading) && g.coords.heading >= 0 ? Math.round(g.coords.heading) : null,
        };
        setEnregistre(true);
        dernierFix.current = { lat: p.lat, lng: p.lng };
        if (!garderPoint(dernierGarde.current, p)) return;
        dernierGarde.current = p;
        file.current = ajouterAFile(file.current, p);
        memoriser(runId, file.current);
        void envoyer();
      },
      () => setEnregistre(false),
      { enableHighAccuracy: true, maximumAge: 5_000, timeout: 30_000 },
    );
    const minuteur = setInterval(() => void envoyer(), VERIFICATION_MS);
    const enLigne = () => {
      pauseJusqua.current = 0;
      void envoyer(true);
    };
    // Application mise en arrière-plan : on vide la file tant que c'est possible.
    const masquee = () => {
      if (document.visibilityState === "hidden") void envoyer(true);
    };
    window.addEventListener("online", enLigne);
    document.addEventListener("visibilitychange", masquee);
    return () => {
      fini = true;
      navigator.geolocation.clearWatch(id);
      clearInterval(minuteur);
      window.removeEventListener("online", enLigne);
      document.removeEventListener("visibilitychange", masquee);
      void envoyer(true);
      setEnregistre(false);
    };
  }, [runId, actif]);

  return enregistre;
}
