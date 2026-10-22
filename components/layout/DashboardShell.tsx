"use client";

import { useEffect, useState } from "react";
import { Sidebar } from "@/components/layout/Sidebar";
import { TopBar } from "@/components/layout/TopBar";
import { MobileActionBar } from "@/components/layout/MobileActionBar";
import { FloatingChatWidget } from "@/components/chat/FloatingChatWidget";
import type { UserRole } from "@/lib/types/domain";
import { OfflineSyncStatus } from "@/components/offline/OfflineSyncStatus";
import { BandeauMenuReorganise } from "@/components/layout/BandeauMenuReorganise";
import { MARQUEUR_GO_NAVIGATION } from "@/lib/acces/catalogue";

export function DashboardShell({
  role,
  conduit = role === "chauffeur",
  enabledModuleKeys,
  organizationName,
  logoUrl,
  accentColor,
  fullName,
  roleTitle,
  hasActiveTour,
  assistantAvailable,
  messengerAvailable,
  currentUserId,
  organizationId,
  isDemo = false,
  children,
}: {
  role: UserRole;
  /** Chauffeur, ou manager qui conduit aussi (users.can_drive). */
  conduit?: boolean;
  enabledModuleKeys: string[];
  organizationName?: string;
  logoUrl?: string | null;
  accentColor?: string | null;
  fullName: string;
  roleTitle?: string | null;
  hasActiveTour: boolean;
  /** Module enabled AND ANTHROPIC_API_KEY configured — resolved server-side so the widget is absent, not just hidden, otherwise. */
  assistantAvailable: boolean;
  messengerAvailable: boolean;
  currentUserId: string;
  organizationId: string;
  /** « Transports Démo » — shows the demo banner with the way out to a real account. */
  isDemo?: boolean;
  children: React.ReactNode;
}) {
  const [drawerOpen, setDrawerOpen] = useState(false);

  // Escape closes the drawer regardless of which element has focus.
  useEffect(() => {
    if (!drawerOpen) return;
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setDrawerOpen(false);
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [drawerOpen]);

  const showActionBar = conduit;
  // Compte d'essai GO Navigation : menu réduit, pas de bandeau « menu
  // réorganisé » (il cite des sections que l'essai n'a pas).
  const goNavigation = enabledModuleKeys.includes(MARQUEUR_GO_NAVIGATION);

  return (
    <div className="flex min-h-screen">
      <a
        href="#contenu"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[60] focus:rounded-lg focus:bg-surface focus:px-4 focus:py-2 focus:font-semibold focus:shadow-lg"
      >
        Aller au contenu
      </a>
      {drawerOpen && (
        <div
          className="fixed inset-0 z-40 bg-marine/50 backdrop-blur-[2px] lg:hidden"
          onClick={() => setDrawerOpen(false)}
          aria-hidden="true"
        />
      )}
      <Sidebar
        role={role}
        conduit={conduit}
        enabledModuleKeys={enabledModuleKeys}
        organizationName={organizationName}
        logoUrl={logoUrl}
        accentColor={accentColor}
        open={drawerOpen}
        onNavigate={() => setDrawerOpen(false)}
      />
      <div className="flex min-w-0 flex-1 flex-col">
        {isDemo && (
          <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 bg-gold px-4 py-2 text-center text-sm text-marine">
            <span>
              <strong>Mode démo</strong> — entreprise et données fictives, remises à zéro chaque nuit.
            </span>
            <a href="/demo/exit" className="font-semibold underline underline-offset-2 hover:no-underline">
              Créer mon espace GODAC
            </a>
          </div>
        )}
        <TopBar fullName={fullName} role={role} roleTitle={roleTitle} onMenuClick={() => setDrawerOpen(true)} goNavigation={goNavigation} />
        <main id="contenu" tabIndex={-1} className={`flex-1 overflow-x-hidden px-4 py-6 focus:outline-none sm:px-6 lg:px-10 lg:py-8 ${showActionBar ? "pb-28 lg:pb-8" : ""}`}>
          <div className="mx-auto w-full max-w-7xl"><OfflineSyncStatus />{!goNavigation && <BandeauMenuReorganise userId={currentUserId} />}{children}</div>
        </main>
      </div>
      {showActionBar && <MobileActionBar role={role} conduit={conduit} enabledModuleKeys={enabledModuleKeys} hasActiveTour={hasActiveTour} onPlus={() => setDrawerOpen(true)} />}
      <FloatingChatWidget
        assistantAvailable={assistantAvailable}
        messengerAvailable={messengerAvailable}
        currentUserId={currentUserId}
        organizationId={organizationId}
      />
    </div>
  );
}
