"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { vitesseEstimee } from "@/lib/colis/conduite";
import { kmhDepuisMs } from "@/lib/colis/limitation-vitesse";
import { mouvementApres } from "@/lib/go-lieux/saisie";

export interface PositionGo {
  lat: number;
  lng: number;
  precision: number | null;
}

/**
 * Position et mouvement sur l'écran « Aller à… », EN MÉMOIRE seulement :
 * rien n'est envoyé au serveur ni stocké. Sert au départ implicite (« Ma
 * position actuelle »), au biais de recherche et au blocage de la saisie en
 * roulant (15 / 8 km/h).
 */
export function usePosition() {
  const [position, setPosition] = useState<PositionGo | null>(null);
  const [mouvement, setMouvement] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const precedent = useRef<{ lat: number; lng: number; t: number } | null>(null);

  const recevoir = useCallback((g: GeolocationPosition) => {
    const pos = { lat: g.coords.latitude, lng: g.coords.longitude };
    const t = Date.now();
    const v = vitesseEstimee(g.coords.speed, precedent.current, { ...pos, t });
    precedent.current = { ...pos, t };
    setMouvement((avant) => mouvementApres(avant, kmhDepuisMs(v)));
    setPosition({ ...pos, precision: g.coords.accuracy != null ? Math.round(g.coords.accuracy) : null });
    setErreur(null);
  }, []);
  const refuser = useCallback((e: GeolocationPositionError) => setErreur(e.code === e.PERMISSION_DENIED ? "Localisation refusée : autorisez-la pour être guidé." : "Position GPS indisponible pour le moment."), []);

  useEffect(() => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setErreur("Ce téléphone ne donne pas sa position.");
      return;
    }
    const id = navigator.geolocation.watchPosition(recevoir, refuser, { enableHighAccuracy: true, maximumAge: 3000, timeout: 20000 });
    return () => navigator.geolocation.clearWatch(id);
  }, [recevoir, refuser]);

  /** « Ma position actuelle » : nouvelle lecture immédiate. */
  const actualiser = useCallback(() => {
    if (typeof navigator !== "undefined" && navigator.geolocation) navigator.geolocation.getCurrentPosition(recevoir, refuser, { enableHighAccuracy: true, timeout: 15000 });
  }, [recevoir, refuser]);

  return { position, mouvement, erreur, actualiser };
}
