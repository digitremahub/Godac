export type GoReportType = "accident" | "works" | "hazard" | "slowdown";

export interface GoNavigationStop {
  id: string;
  label: string;
  address: string;
  latitude?: number | null;
  longitude?: number | null;
  sequence?: number;
  timeWindowLabel?: string | null;
  completed?: boolean;
}

export interface GoNavigationReport {
  id: string;
  type: GoReportType;
  latitude: number;
  longitude: number;
  createdAt: string;
  note?: string;
}

export interface GoNavigationProps {
  /** Arrêts fournis par une API GODAC sécurisée. */
  stops?: GoNavigationStop[];
  /** Position d'arrivée optionnelle, sinon le conducteur choisit une destination. */
  destination?: { label: string; latitude: number; longitude: number } | null;
  /** OSRM-compatible routing endpoint. Public demo endpoint is for development only. */
  routingUrl?: string;
  /** Nominatim-compatible geocoding endpoint. Public demo endpoint is rate-limited. */
  geocodingUrl?: string;
  /** Route deviation in metres before requesting a recalculation. */
  deviationThresholdMeters?: number;
}
