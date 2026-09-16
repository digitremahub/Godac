"use client";

import { useMemo } from "react";
import { useSession } from "@clerk/nextjs";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Browser-side Supabase client bound to the current Clerk session.
 * Every call still runs through RLS — this client never has elevated
 * privileges, unlike lib/supabase/admin.ts.
 */
export function useSupabaseClient(): SupabaseClient {
  const { session } = useSession();

  return useMemo(() => {
    return createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        async accessToken() {
          return session?.getToken() ?? null;
        },
      },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.id]);
}
