/** Lecture ponctuelle de la position (jamais de suivi permanent : batterie et vie privée). */
export function lirePosition(options: { maximumAge?: number; timeout?: number } = {}): Promise<GeolocationPosition | null> {
  if (typeof navigator === "undefined" || !navigator.geolocation) return Promise.resolve(null);
  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(resolve, () => resolve(null), {
      enableHighAccuracy: true,
      timeout: options.timeout ?? 10000,
      maximumAge: options.maximumAge ?? 30000,
    });
  });
}

/** « 17:42 » à l'heure de Paris. */
export function heureParis(iso: string): string {
  return new Date(iso).toLocaleTimeString("fr-FR", { timeZone: "Europe/Paris", hour: "2-digit", minute: "2-digit" });
}
