// Identifiant d'action hors ligne (en-tête posé par lib/offline/outbox.ts). Pur, testé.

export const ENTETE_ACTION_HORS_LIGNE = "X-GODAC-Offline-Action";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Identifiant de l'action rejouée, ou null (requête directe, en-tête absent ou mal formé). */
export function idActionHorsLigne(headers: Pick<Headers, "get">): string | null {
  const id = headers.get(ENTETE_ACTION_HORS_LIGNE)?.trim().toLowerCase() ?? "";
  return UUID.test(id) ? id : null;
}

/** Erreur Postgres « table absente » : la migration n'est pas encore appliquée. */
export function tableAbsente(error: { code?: string; message?: string } | null): boolean {
  return Boolean(error) && (error!.code === "42P01" || error!.code === "PGRST205" || /offline_actions/.test(error!.message ?? "") && /does not exist|schema cache/.test(error!.message ?? ""));
}
