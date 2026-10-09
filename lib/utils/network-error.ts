/**
 * `fetch()` throws a bare TypeError when the request never reaches a
 * server — offline, DNS failure, dropped connection — and its message
 * is the browser's own English string ("Failed to fetch", "NetworkError
 * when attempting to fetch resource", "Load failed" on Safari), which
 * every OCR capture flow was displaying to the driver verbatim. This
 * turns that one case into an actionable French message while leaving
 * every other error (a thrown Error with an explicit, already-French
 * reason) untouched.
 */
export function networkErrorMessage(e: unknown): string {
  if (e instanceof TypeError && /fetch|network|load failed/i.test(e.message)) {
    return "Connexion réseau indisponible — vérifiez votre signal et réessayez.";
  }
  return e instanceof Error ? e.message : "Erreur inattendue";
}
