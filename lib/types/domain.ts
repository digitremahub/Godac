// Hand-written domain types mirroring supabase/migrations/*.sql.
// Once the project is linked to a real Supabase instance, generate
// the authoritative types with:
//   supabase gen types typescript --project-id <ref> > lib/types/database.ts
// and prefer importing table row types from there; these stay as the
// stable shapes business logic and UI code are written against.

export type UserRole =
  | "chauffeur"
  | "manager"
  | "manager_chauffeur"
  | "comptable"
  | "direction";

/** 'pin' = Lot 7's QR-badge chauffeur login (no email), see lib/auth/driver-pin.ts. */
export type UserAuthMethod = "email" | "pin";

export type VehicleType = "VL" | "PL" | "SPL";

export type VehicleStatus = "active" | "maintenance" | "out_of_service";

export type FuelType = "diesel" | "adblue";

export type FuelEntryStatus =
  | "manual"
  | "pending_ocr"
  | "awaiting_validation"
  | "validated"
  | "ocr_failed";

export type AlertType =
  | "price_anomaly"
  | "totalizer_gap"
  | "tank_overflow"
  | "ocr_failure"
  | "maintenance_request"
  | "odometer_anomaly"
  | "usage_quota";

export type AlertSeverity = "info" | "warning" | "critical";

export interface Organization {
  id: string;
  name: string;
  plan: string;
  logo_url: string | null;
  accent_color: string | null;
  require_odometer_photo: boolean;
  emergency_phone: string | null;
  consumption_anomaly_threshold_percent: number;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  subscription_status: "trialing" | "active" | "past_due" | "canceled" | "incomplete";
}

export interface Vehicle {
  id: string;
  organization_id: string;
  service_id: string | null;
  registration: string;
  type: VehicleType;
  tank_capacity_liters: number | null;
  status: VehicleStatus;
}

export interface Tank {
  id: string;
  organization_id: string;
  service_id: string | null;
  name: string;
  fuel_type: FuelType;
  capacity_liters: number;
  current_totalizer_index: number;
  last_reading_at: string | null;
}

export interface FuelEntryInput {
  tank_id: string;
  vehicle_id: string;
  driver_id: string;
  occurred_at: string;
  totalizer_before: number | null;
  totalizer_after: number;
  liters: number;
  unit_price: number;
  status: FuelEntryStatus;
}

/** A trusted prior fill-up used to seed PMP / gap calculations. */
export interface PriorTankHistory {
  cumulativeLiters: number;
  cumulativeAmount: number;
  lastTrustedEntry: {
    occurred_at: string;
    totalizer_after: number;
  } | null;
}
