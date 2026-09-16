import "server-only";
import { auth } from "@clerk/nextjs/server";
import { createClient } from "@supabase/supabase-js";

/**
 * Server-side Supabase client for Server Components / Route Handlers
 * / Server Actions. Uses the signed-in Clerk session's JWT as the
 * Supabase "third-party auth" token, so every query runs under the
 * calling user's Row Level Security policies — never elevated.
 *
 * Requires the Supabase project to have Clerk configured under
 * Authentication > Third Party Auth (see README).
 */
export function createServerSupabaseClient() {
  const supabaseUrl = requireEnv("NEXT_PUBLIC_SUPABASE_URL");
  const supabaseAnonKey = requireEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY");

  return createClient(supabaseUrl, supabaseAnonKey, {
    async accessToken() {
      return (await auth()).getToken();
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
