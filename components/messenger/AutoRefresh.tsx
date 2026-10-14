"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/**
 * Pas de temps réel dans GODAC (même choix que le widget de chat) :
 * la conversation ouverte se rafraîchit toutes les 20 s tant que
 * l'onglet est visible.
 */
export function AutoRefresh({ everyMs = 20000 }: { everyMs?: number }) {
  const router = useRouter();
  useEffect(() => {
    const id = setInterval(() => {
      if (document.visibilityState === "visible") router.refresh();
    }, everyMs);
    return () => clearInterval(id);
  }, [router, everyMs]);
  return null;
}
