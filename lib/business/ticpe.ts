import type { Vehicle, VehicleType } from "@/lib/types/domain";

/**
 * TICPE (Taxe Intérieure de Consommation sur les Produits
 * Énergétiques) hard business rule: it applies ONLY to PL and SPL
 * vehicles, NEVER to VL — regardless of usage, organisation, or
 * client preference. This function is the single choke point that
 * rule flows through; the export route (Module 7) and any future
 * reporting must filter through it rather than re-implementing the
 * VL/PL/SPL check inline.
 */
const TICPE_ELIGIBLE_TYPES: readonly VehicleType[] = ["PL", "SPL"];

export function isTicpeEligible(vehicleType: VehicleType): boolean {
  return TICPE_ELIGIBLE_TYPES.includes(vehicleType);
}

export function filterTicpeEligibleVehicles<T extends Pick<Vehicle, "type">>(
  vehicles: T[],
): T[] {
  return vehicles.filter((v) => isTicpeEligible(v.type));
}

export interface RecoverableVatInput {
  vehicleType: VehicleType;
  amountExclVat: number;
  vatRate?: number;
}

/**
 * TVA récupérable: VL 80% / PL+SPL 100%. Flagged in the spec as a
 * feature to plan for but not required in the MVP — implemented here
 * as a pure function so Phase 2 wiring is a UI/export task only, not
 * a new business-logic decision.
 */
export function computeRecoverableVat({
  vehicleType,
  amountExclVat,
  vatRate = 0.2,
}: RecoverableVatInput): number {
  const recoveryRate = vehicleType === "VL" ? 0.8 : 1;
  const vatAmount = amountExclVat * vatRate;
  return roundTo(vatAmount * recoveryRate, 2);
}

function roundTo(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}
