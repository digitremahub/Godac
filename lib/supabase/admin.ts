import "server-only";
import { createClient } from "@supabase/supabase-js";

/**
 * Service-role Supabase client. Bypasses Row Level Security entirely
 * — only ever use this from trusted server contexts that have
 * already established the correct tenant scope themselves:
 * onboarding bootstrap (creating a new organisation), invitations,
 * webhooks (Stripe billing events), the OCR job that writes back
 * Mindee results, and cron jobs.
 *
 * NEVER import this module from a Client Component or expose the
 * underlying key to the browser.
 */
export function createAdminSupabaseClient() {
  const supabaseUrl = requireEnv("NEXT_PUBLIC_SUPABASE_URL");
  const serviceRoleKey = requireEnv("SUPABASE_SERVICE_ROLE_KEY");

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    // Same no-store fix as lib/supabase/server.ts — this client reads
    // current data too (webhooks, cron jobs, OCR writeback) and is just
    // as exposed to Next's default fetch Data Cache otherwise.
    global: {
      fetch: (input: RequestInfo | URL, init?: RequestInit) => fetch(input, { ...init, cache: "no-store" }),
    },
  });
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Missing environment variable ${name}. See .env.example / README.md.`,
    );
  }
  return value;
}
