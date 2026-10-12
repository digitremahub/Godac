"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createBrowserSupabaseClient } from "@/lib/supabase/client";

export function SignOutButton() {
  const router = useRouter();
  const supabase = createBrowserSupabaseClient();
  const [busy, setBusy] = useState(false);

  async function signOut() {
    setBusy(true);
    await supabase.auth.signOut();
    router.push("/sign-in");
    router.refresh();
  }

  return (
    <button type="button" className="btn-secondary !px-3 !py-1.5 text-xs" onClick={signOut} disabled={busy}>
      {busy ? "Déconnexion…" : "Se déconnecter"}
    </button>
  );
}
