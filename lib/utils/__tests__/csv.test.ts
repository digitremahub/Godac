import { describe, it, expect } from "vitest";
import { validateRows, vehicleCsvRowSchema, driverCsvRowSchema } from "../csv";

describe("validateRows", () => {
  it("accepts canonical English headers", () => {
    const { rows, errors } = validateRows(
      [{ registration: "AB-123-CD", type: "PL", tank_capacity_liters: "500", service: "DPD" }],
      vehicleCsvRowSchema,
    );
    expect(errors).toHaveLength(0);
    expect(rows).toEqual([{ registration: "AB-123-CD", type: "PL", tank_capacity_liters: 500, service: "DPD" }]);
  });

  it("maps common French column names to canonical fields", () => {
    const { rows, errors } = validateRows(
      [{ Immatriculation: "AB-123-CD", Type: "PL", "Capacité réservoir": "500", "Kilométrage": "12000", Service: "DPD" }],
      vehicleCsvRowSchema,
    );
    expect(errors).toHaveLength(0);
    expect(rows[0]).toMatchObject({ registration: "AB-123-CD", tank_capacity_liters: 500, initial_km: 12000 });
  });

  it("maps French driver columns (nom, téléphone) to canonical fields", () => {
    const { rows, errors } = validateRows(
      [{ Nom: "Jean Dupont", Email: "jean@example.com", "Téléphone": "0612345678", Service: "DPD" }],
      driverCsvRowSchema,
    );
    expect(errors).toHaveLength(0);
    expect(rows[0]).toMatchObject({ full_name: "Jean Dupont", email: "jean@example.com", phone: "0612345678" });
  });

  it("reports a row-level error for an invalid value, keeping the row index", () => {
    const { rows, errors } = validateRows(
      [
        { registration: "AB-123-CD", type: "PL", service: "" },
        { registration: "", type: "PL", service: "" },
      ],
      vehicleCsvRowSchema,
    );
    expect(rows).toHaveLength(1);
    expect(errors).toHaveLength(1);
    expect(errors[0]?.row).toBe(3);
  });
});
