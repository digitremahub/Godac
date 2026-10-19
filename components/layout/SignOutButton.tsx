"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createBrowserSupabaseClient } from "@/lib/supabase/client";
import { IconLogOut } from "@/components/layout/icons";
import { clearOfflineQueue, listOfflineMutations } from "@/lib/offline/outbox";

export function SignOutButton() {
  const router = useRouter();
  const supabase = createBrowserSupabaseClient();
  const [busy, setBusy] = useState(false);

  async function signOut() {
    // La file hors ligne est propre au compte : vidée à la déconnexion pour
    // qu'aucune action ne parte ensuite avec la session d'un collègue.
    const enAttente = await listOfflineMutations().then((l) => l.length).catch(() => 0);
    if (enAttente > 0 && !window.confirm(`${enAttente} action(s) hors ligne ne sont pas encore envoyées et seront perdues. Se déconnecter quand même ?`)) return;
    setBusy(true);
    await clearOfflineQueue().catch(() => undefined);
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
