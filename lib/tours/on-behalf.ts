import "server-only";
import { createHmac, timingSafeEqual } from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import type { AppUser } from "@/lib/auth/session";

/**
 * « Dépanner un collègue » — a driver starts or closes a colleague's
 * tour from their own phone (dead battery, phone forgotten at home).
 *
 * Proof required: the colleague's badge (QR or driver code) AND their
 * PIN, checked server-side in app/api/tours/on-behalf. That check
 * hands back a short-lived HMAC token binding helper → colleague →
 * organization; the tour routes accept it in the `x-godac-on-behalf`
 * header and act for the colleague, recording the helper in
 * started_by / ended_by. Nothing here is trusted from the client
 * beyond the signed token itself.
 */

export const ON_BEHALF_HEADER = "x-godac-on-behalf";
const TTL_SECONDS = 10 * 60;

interface OnBehalfClaims {
  helper: string;
  colleague: string;
  org: string;
  exp: number;
}

function secret(): string {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error("SUPABASE_SERVICE_ROLE_KEY manquant.");
  // Domain-separated from the raw key: the token never reveals it and
  // can't be confused with any other signature made from it.
  return createHmac("sha256", key).update("godac:on-behalf:v1").digest("hex");
}

function sign(payload: string): string {
  return createHmac("sha256", secret()).update(payload).digest("base64url");
}

export function issueOnBehalfToken(helperId: string, colleagueId: string, organizationId: string): string {
  const claims: OnBehalfClaims = {
    helper: helperId,
    colleague: colleagueId,
    org: organizationId,
    exp: Math.floor(Date.now() / 1000) + TTL_SECONDS,
  };
  const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");
  return `${payload}.${sign(payload)}`;
}

export function verifyOnBehalfToken(token: string): OnBehalfClaims | null {
  const [payload, signature] = token.split(".");
  if (!payload || !signature) return null;
  const expected = Buffer.from(sign(payload));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  try {
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString()) as OnBehalfClaims;
    if (typeof claims.exp !== "number" || claims.exp < Math.floor(Date.now() / 1000)) return null;
    return claims;
  } catch {
    return null;
  }
}

export type TourActor =
  | {
      ok: true;
      /** Whose tour this is. */
      driverId: string;
      /** Set only when acting for a colleague — recorded in started_by / ended_by. */
      helperId: string | null;
      /**
       * The caller's own RLS-scoped client normally; the service-role
       * client when acting for a colleague (RLS only lets a driver see
       * their own tours) — every query through it must then filter on
       * organization_id explicitly.
       */
      db: SupabaseClient;
    }
  | { ok: false; status: number; error: string };

export async function resolveTourActor(req: Request, appUser: AppUser): Promise<TourActor> {
  const token = req.headers.get(ON_BEHALF_HEADER);
  if (!token) {
    return { ok: true, driverId: appUser.id, helperId: null, db: await createServerSupabaseClient() };
  }
  const claims = verifyOnBehalfToken(token);
  if (!claims || claims.helper !== appUser.id || claims.org !== appUser.organization_id) {
    return { ok: false, status: 403, error: "Autorisation de dépannage expirée ou invalide — rescannez le badge du collègue." };
  }
  return { ok: true, driverId: claims.colleague, helperId: appUser.id, db: createAdminSupabaseClient() };
}
