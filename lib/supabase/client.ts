"use client";

import { createBrowserClient } from "@supabase/ssr";

/**
 * Browser-side Supabase client, cookie-based session (shared with the
 * server client via @supabase/ssr so a page load and a client-side
 * fetch see the same signed-in user). Still fully RLS-scoped — no
 * elevated privileges, unlike lib/supabase/admin.ts.
 */
export function createBrowserSupabaseClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
