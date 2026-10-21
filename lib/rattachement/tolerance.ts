/**
 * Tolérance à une migration non appliquée : une colonne ou une table
 * absente renvoie une erreur PostgREST (PGRST204 / PGRST205) ou Postgres
 * (42703 colonne, 42P01 table). Le code retombe alors sur les colonnes
 * historiques au lieu d'échouer.
 */
export function estSchemaManquant(error: { code?: string | null; message?: string | null } | null | undefined): boolean {
  if (!error) return false;
  if (error.code && ["42703", "42P01", "PGRST204", "PGRST205", "PGRST200"].includes(error.code)) return true;
  const m = (error.message ?? "").toLowerCase();
  return (m.includes("column") && m.includes("does not exist")) || m.includes("could not find the") || (m.includes("relation") && m.includes("does not exist"));
}

/** Valeur d'enum absente (ex. fine_status « dismissed » avant la migration). */
export function estValeurEnumInconnue(error: { code?: string | null; message?: string | null } | null | undefined): boolean {
  if (!error) return false;
  return error.code === "22P02" || (error.message ?? "").includes("invalid input value for enum");
}
