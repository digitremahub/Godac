"use client";

import { useRouter } from "next/navigation";
import { createBrowserSupabaseClient } from "@/lib/supabase/client";

export function SignOutButton() {
  const router = useRouter();
  const supabase = createBrowserSupabaseClient();

  async function signOut() {
    await supabase.auth.signOut();
    router.push("/sign-in");
    router.refresh();
  }

  return (
    <button className="btn-secondary !px-3 !py-1.5 text-xs" onClick={signOut}>
      Se déconnecter
    </button>
  );
}
