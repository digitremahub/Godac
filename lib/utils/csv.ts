import Papa from "papaparse";
import { z } from "zod";

export const vehicleCsvRowSchema = z.object({
  registration: z.string().min(1, "Immatriculation requise"),
  type: z.enum(["VL", "PL", "SPL"]),
  tank_capacity_liters: z.coerce.number().positive().optional(),
  service: z.string().optional().default(""),
});

export type VehicleCsvRow = z.infer<typeof vehicleCsvRowSchema>;

export const driverCsvRowSchema = z.object({
  full_name: z.string().min(1, "Nom requis"),
  email: z.string().email("Email invalide"),
  role: z
    .enum(["chauffeur", "manager", "manager_chauffeur", "comptable", "direction"])
    .default("chauffeur"),
  service: z.string().optional().default(""),
});

export type DriverCsvRow = z.infer<typeof driverCsvRowSchema>;

export interface CsvParseResult<T> {
  rows: T[];
  errors: { row: number; message: string }[];
}

/**
 * Generic CSV -> validated row parser used by the onboarding import
 * step (Module 1). Runs client-side so the user gets instant feedback
 * on malformed rows before anything is sent to the server.
 */
export function parseCsv<S extends z.ZodType<any, any, any>>(
  file: string,
  schema: S,
): CsvParseResult<z.infer<S>> {
  type T = z.infer<S>;
  const parsed = Papa.parse<Record<string, string>>(file, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h) => h.trim().toLowerCase(),
  });

  const rows: T[] = [];
  const errors: { row: number; message: string }[] = [];

  parsed.data.forEach((raw, index) => {
    const result = schema.safeParse(raw);
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
