"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createBrowserSupabaseClient } from "@/lib/supabase/client";
import { IconLogOut } from "@/components/layout/icons";

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
    <button
      type="button"
      className="btn-ghost !px-2.5 sm:!px-3"
      onClick={signOut}
      disabled={busy}
      aria-label={busy ? "Déconnexion…" : "Se déconnecter"}
    >
      <IconLogOut className="h-[18px] w-[18px]" />
      <span className="hidden sm:inline">{busy ? "Déconnexion…" : "Déconnexion"}</span>
    </button>
  );
}
