import { z } from "zod";

export const vehicleCsvRowSchema = z.object({
  registration: z.string().min(1, "Immatriculation requise"),
  type: z.enum(["VL", "PL", "SPL"]),
  tank_capacity_liters: z.coerce.number().positive().optional(),
  initial_km: z.coerce.number().min(0).optional(),
  service: z.string().optional().default(""),
  // Optional — present only if the source file has them. Lot A's
  // "compléter par IA" needs at least brand+model to look anything up.
  brand: z.string().optional(),
  model: z.string().optional(),
});

export type VehicleCsvRow = z.infer<typeof vehicleCsvRowSchema>;

export const driverCsvRowSchema = z.object({
  full_name: z.string().min(1, "Nom requis"),
  email: z.string().email("Email invalide"),
  role: z
    .enum(["chauffeur", "manager", "exploitation", "comptable", "direction"])
    .default("chauffeur"),
  phone: z.string().optional(),
  service: z.string().optional().default(""),
});

export type DriverCsvRow = z.infer<typeof driverCsvRowSchema>;

export interface CsvParseResult<T> {
  rows: T[];
  errors: { row: number; message: string }[];
  /** Set when the normal column-matching parser found nothing usable and an AI fallback extracted the rows instead. */
  aiExtracted?: boolean;
}

/**
 * A company's own spreadsheet almost never uses our exact English
 * column names — this maps the common French variants (and a few
 * English synonyms) to the canonical field name each schema above
 * expects. Anything not listed here passes through unchanged, so an
 * unrecognized extra column is just ignored by the schema rather than
 * breaking the import.
 */
const HEADER_ALIASES: Record<string, string> = {
  immatriculation: "registration",
  immat: "registration",
  plaque: "registration",
  categorie: "type",
  marque: "brand",
  modele: "model",
  capacite: "tank_capacity_liters",
  capacite_l: "tank_capacity_liters",
  capacite_reservoir: "tank_capacity_liters",
  capacite_cuve: "tank_capacity_liters",
  reservoir: "tank_capacity_liters",
  km: "initial_km",
  kilometrage: "initial_km",
  kilometrage_initial: "initial_km",
  km_initial: "initial_km",
  compteur: "initial_km",
  depot: "service",
  agence: "service",
  // "nom" alone (no separate first-name column) is treated as the
  // whole display name — but when a "prenom" column also exists (a
  // common split in HR export templates), validateRows()'s merge step
  // below combines the two into full_name instead.
  nom: "last_name",
  prenom: "first_name",
  nom_complet: "full_name",
  nom_prenom: "full_name",
  nom_et_prenom: "full_name",
  salarie: "full_name",
  employe: "full_name",
  mail: "email",
  courriel: "email",
  e_mail: "email",
  fonction: "role",
  poste: "role",
  telephone: "phone",
  tel: "phone",
  mobile: "phone",
  portable: "phone",
};

function normalizeKey(raw: string): string {
  const cleaned = raw
    // Drop a trailing "(obligatoire)" / "*(facultatif)" / "* requis"
    // annotation — common in HR/onboarding form templates — before
    // normalizing, so "Prénom (obligatoire)" still matches "prenom".
    .replace(/[*(].*$/, "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // strip accents (é -> e, etc.)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return HEADER_ALIASES[cleaned] ?? cleaned;
}

function normalizeRow(raw: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (value === null || value === undefined) continue;
    out[normalizeKey(key)] = String(value).trim();
  }
  // A file with separate "Prénom"/"Nom" columns has no single
  // full_name column at all — combine them the same way a manual
  // "Nom complet" field would read, rather than dropping the first
  // name into an unvalidated `first_name` key the schema never sees.
  if (!out.full_name && (out.first_name || out.last_name)) {
    out.full_name = [out.first_name, out.last_name].filter(Boolean).join(" ");
  }
  return out;
}

/**
 * Validates raw {header: value} rows (already extracted from
 * whatever file format — see lib/import/parse-table.ts for CSV/Excel
 * extraction, or lib/import/ai-extract.ts for the AI fallback — both
 * funnel through this same validation so every source produces
 * identical errors).
 */
export function validateRows<S extends z.ZodType<any, any, any>>(
  rawRows: Record<string, unknown>[],
  schema: S,
): CsvParseResult<z.infer<S>> {
  type T = z.infer<S>;
  const rows: T[] = [];
  const errors: { row: number; message: string }[] = [];

  rawRows.forEach((raw, index) => {
    const result = schema.safeParse(normalizeRow(raw));
    if (result.success) {
      rows.push(result.data);
    } else {
      errors.push({
        row: index + 2, // +1 for header row, +1 for 1-based indexing
        message: result.error.issues.map((i) => i.message).join(", "),
      });
    }
  });

  return { rows, errors };
}

/**
 * Extracts rows from any supported file (CSV or Excel — see
 * app/api/import/parse-file/route.ts) and validates them against
 * `schema`. The actual file parsing runs server-side: Excel needs a
 * Node-only library, and keeping CSV there too means every format
 * shares one code path and one set of error messages. `kind` tells the
 * server which schema this is for, so its AI fallback (only used when
 * the normal column-matching parser finds nothing) knows what to
 * extract.
 */
export async function parseImportFile<S extends z.ZodType<any, any, any>>(
  file: File,
  schema: S,
  kind: "vehicles" | "drivers",
): Promise<CsvParseResult<z.infer<S>>> {
  const formData = new FormData();
  formData.append("file", file);
  formData.append("kind", kind);

  const res = await fetch("/api/import/parse-file", { method: "POST", body: formData });
  const json = await res.json();
  if (!res.ok) {
    return { rows: [], errors: [{ row: 0, message: json.error ?? "Fichier illisible" }] };
  }

  const result = validateRows(json.rows as Record<string, unknown>[], schema);
  // Lecture IA refusée (quota) : le message explique pourquoi le fichier n'a pas été relu.
  const errors = json.warning ? [{ row: 0, message: json.warning as string }, ...result.errors] : result.errors;
  return { ...result, errors, aiExtracted: json.source === "ai" };
}
