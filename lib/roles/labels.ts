import type { UserRole } from "@/lib/types/domain";

/**
 * Split out from lib/clerk/roles.ts (which is server-only) so Client
 * Components — the admin users table, the top bar — can import just
 * the label map without pulling in Clerk's server SDK.
 */
export const ROLE_LABELS: Record<UserRole, string> = {
  chauffeur: "Chauffeur",
  manager: "Manager",
  manager_chauffeur: "Manager-Chauffeur",
  comptable: "Comptable",
  direction: "Direction",
};
