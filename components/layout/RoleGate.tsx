import type { UserRole } from "@/lib/types/domain";

interface RoleGateProps {
  role: UserRole;
  allow: UserRole[];
  children: React.ReactNode;
  fallback?: React.ReactNode;
}

/**
 * Presentational-only gate: the real access control is Supabase RLS
 * (see supabase/migrations/20260101000009_rls_policies.sql). This
 * just avoids rendering controls a role can't use, it never
 * substitutes for a server-side check.
 */
export function RoleGate({ role, allow, children, fallback = null }: RoleGateProps) {
  if (!allow.includes(role)) return <>{fallback}</>;
  return <>{children}</>;
}
