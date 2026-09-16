import "server-only";
import { cookies } from "next/headers";
import { createServerClient, type CookieOptions } from "@supabase/ssr";

/**
 * Server-side Supabase client for Server Components / Route Handlers
 * / Server Actions, bound to the signed-in visitor's own cookie-based
 * session — every query still runs under that user's Row Level
 * Security policies, never elevated (see lib/supabase/admin.ts for
 * the service-role escape hatch).
 */
export async function createServerSupabaseClient() {
  const cookieStore = await cookies();
  const supabaseUrl = requireEnv("NEXT_PUBLIC_SUPABASE_URL");
  const supabaseAnonKey = requireEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY");

  return createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet: { name: string; value: string; options: CookieOptions }[]) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        } catch {
          // Called from a Server Component that can't write cookies —
          // fine as long as middleware.ts is also refreshing the
          // session on every request (it is, see middleware.ts).
        }
      },
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
