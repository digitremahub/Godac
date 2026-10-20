import type { UserRole } from "@/lib/types/domain";

/**
 * Split out from lib/auth/session.ts (which is server-only) so Client
 * Components — the admin users table, the top bar — can import just
 * the label map without pulling in server-only auth code.
 */
export const ROLE_LABELS: Record<UserRole, string> = {
  chauffeur: "Chauffeur",
  manager: "Manager",
  comptable: "Comptable",
  direction: "Direction",
};
