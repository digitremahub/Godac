"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { heureParis, lirePosition } from "@/components/time-clock/position";

/** Intervalle de lecture de la position tant que l'app est ouverte. */
export const INTERVALLE_SORTIE_MS = 60_000;
/** Au-delà, on arrête de surveiller (journée finie ou app oubliée ouverte). */
export const DUREE_MAX_SURVEILLANCE_MS = 4 * 60 * 60 * 1000;
const CLE_AIDE = "godac-aide-sortie-depot";

export type Bandeau =
  | { kind: "auto_in"; entryId: string; time: string }
  | { kind: "offer_out" }
  | { kind: "auto_out"; entryId: string; time: string }
  | { kind: "offer_left"; lastSeenAt: string | null }
  | { kind: "done"; message: string }
  | null;

export type ReponseAssistee = {
  status: string;
  atDepot?: boolean;
  clockedInAt?: string;
  clockedOutAt?: string;
  entryId?: string;
  lastSeenAt?: string | null;
  suivi?: boolean;
};

/** Envoie la position courante au pointage assisté ; null si position, réseau ou réponse indisponibles. */
export async function sonderPointage(pos: GeolocationPosition): Promise<{ ok: boolean; status: number; json: ReponseAssistee | null }> {
  const res = await fetch("/api/time-clock/assisted", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ latitude: pos.coords.latitude, longitude: pos.coords.longitude, accuracy: pos.coords.accuracy }),
  }).catch(() => null);
  if (!res) return { ok: false, status: 0, json: null };
  return { ok: res.ok, status: res.status, json: res.ok ? ((await res.json().catch(() => null)) as ReponseAssistee | null) : null };
}

/**
 * Logique unique de la sortie du dépôt, partagée par l'app livreur
 * (SortieDepotLivreur) et le tableau de bord (AssistedClock) :
 * - sonder() : une lecture de position + appel à l'API, et le bandeau qui en découle ;
 * - boucle (si `surveiller`) : toutes les 60 s, app visible uniquement,
 *   position lue à la demande (getCurrentPosition, pas de watch), arrêt dès
 *   que la sortie est pointée/proposée/refusée, que le serveur dit qu'il n'y
 *   a rien à surveiller, ou après 4 h ; reprise au retour de visibilité.
 * Jamais en arrière-plan quand l'app est fermée (limite du web) : la sortie
 * est alors proposée à la prochaine ouverture (AssistedClock).
 */
export function useSortieDepot({ surveiller, immediat }: { surveiller: boolean; immediat: boolean }) {
  const router = useRouter();
  const [bandeau, setBandeau] = useState<Bandeau>(null);
  const [occupe, setOccupe] = useState(false);
  const [aideVisible, setAideVisible] = useState(false);
  // Décisions définitives de la session : plus aucune sonde après une annulation, un « plus tard » ou une sortie.
  const termine = useRef(false);
  const vuAuDepot = useRef(false);

  const appliquer = useCallback(
    (json: ReponseAssistee, source: "ouverture" | "boucle"): "arret" | "suite" => {
      if (json.status === "auto_clocked_out" && json.clockedOutAt && json.entryId) {
        termine.current = true;
        setBandeau({ kind: "auto_out", entryId: json.entryId, time: heureParis(json.clockedOutAt) });
        router.refresh();
        return "arret";
      }
      if (json.status === "offer_out_left_depot") {
        // En cours de route (app ouverte) on ne propose qu'après avoir vu le salarié au dépôt dans cette session :
        // une tournée clôturée au dernier arrêt, loin du dépôt, ne doit pas déclencher « vous avez quitté le dépôt ».
        if (source === "boucle" && !vuAuDepot.current) return "suite";
        termine.current = true;
        setBandeau({ kind: "offer_left", lastSeenAt: json.lastSeenAt ?? null });
        return "arret";
      }
      if (json.atDepot) vuAuDepot.current = true;
      if (json.status === "disabled" || json.status === "not_at_depot") return "arret";
      if (json.status === "clocked_in" && json.suivi === false) return "arret";
      if (json.status === "clocked_in") {
        try {
          if (!localStorage.getItem(CLE_AIDE)) setAideVisible(true);
        } catch {
          /* stockage indisponible */
        }
      }
      return "suite";
    },
    [router],
  );

  const sonder = useCallback(async (source: "ouverture" | "boucle"): Promise<{ arret: boolean; json: ReponseAssistee | null }> => {
    const pos = await lirePosition({ maximumAge: source === "boucle" ? 15_000 : 30_000, timeout: 15_000 });
    if (!pos) return { arret: false, json: null };
    const r = await sonderPointage(pos);
    // Module absent, non connecté…: inutile d'insister.
    if (!r.ok) return { arret: r.status === 401 || r.status === 402 || r.status === 403, json: null };
    if (!r.json) return { arret: false, json: null };
    return { arret: appliquer(r.json, source) === "arret", json: r.json };
  }, [appliquer]);

  useEffect(() => {
    if (!surveiller) return;
    let arrete = termine.current;
    let enVol = false;
    const debut = Date.now();

    async function tick() {
      if (arrete || termine.current || enVol) return;
      if (document.visibilityState !== "visible") return;
      if (Date.now() - debut > DUREE_MAX_SURVEILLANCE_MS) {
        arrete = true;
        return;
      }
      enVol = true;
      try {
        const r = await sonder("boucle");
        if (r.arret) arrete = true;
      } finally {
        enVol = false;
      }
    }

    if (immediat) void tick();
    const timer = setInterval(() => void tick(), INTERVALLE_SORTIE_MS);
    const visible = () => {
      if (document.visibilityState === "visible") void tick();
    };
    document.addEventListener("visibilitychange", visible);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [surveiller, immediat, sonder]);

  const fermerAide = useCallback(() => {
    setAideVisible(false);
    try {
      localStorage.setItem(CLE_AIDE, "1");
    } catch {
      /* stockage indisponible */
    }
  }, []);

  /** « Annuler » : entrée assistée ou sortie automatique (même route DELETE). */
  const annuler = useCallback(
    async (entryId: string, quoi: "entree" | "sortie") => {
      setOccupe(true);
      termine.current = true;
      const res = await fetch(`/api/time-clock/assisted?id=${entryId}`, { method: "DELETE" }).catch(() => null);
      setOccupe(false);
      const ok = Boolean(res?.ok);
      setBandeau({
        kind: "done",
        message: ok
          ? quoi === "sortie"
            ? "Sortie annulée : vous êtes toujours pointé."
            : "Pointage annulé."
          : quoi === "sortie"
            ? "Cette sortie ne peut plus être annulée — contactez votre responsable."
            : "Ce pointage ne peut plus être annulé — contactez votre responsable.",
      });
      router.refresh();
    },
    [router],
  );

  /** Pointer la sortie : « maintenant » (bascule habituelle) ou à la dernière présence au dépôt (heure lue en base). */
  const pointerSortie = useCallback(
    async (quand: "maintenant" | "derniere_presence") => {
      setOccupe(true);
      termine.current = true;
      const pos = await lirePosition();
      const coords = pos ? { latitude: pos.coords.latitude, longitude: pos.coords.longitude } : {};
      const res =
        quand === "derniere_presence"
          ? await fetch("/api/time-clock/assisted", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ at: "last_seen", ...coords }) }).catch(() => null)
          : await fetch("/api/time-clock", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(coords) }).catch(() => null);
      setOccupe(false);
      let message = "Le pointage de sortie a échoué — réessayez depuis la pointeuse.";
      if (res?.ok) message = "Sortie pointée. Bonne soirée !";
      else if (res) message = ((await res.json().catch(() => null)) as { error?: string } | null)?.error ?? message;
      setBandeau({ kind: "done", message });
      router.refresh();
    },
    [router],
  );

  const plusTard = useCallback(() => {
    termine.current = true;
    setBandeau(null);
  }, []);

  return { bandeau, setBandeau, occupe, sonder, annuler, pointerSortie, plusTard, aideVisible, fermerAide };
}
