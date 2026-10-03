"use client";

import { useEffect, useState } from "react";
import { Sidebar } from "@/components/layout/Sidebar";
import { TopBar } from "@/components/layout/TopBar";
import { MobileActionBar } from "@/components/layout/MobileActionBar";
import { AssistantWidget } from "@/components/assistant/AssistantWidget";
import type { UserRole } from "@/lib/types/domain";

export function DashboardShell({
  role,
  enabledModuleKeys,
  organizationName,
  logoUrl,
  accentColor,
  fullName,
  roleTitle,
  hasActiveTour,
  assistantAvailable,
  children,
}: {
  role: UserRole;
  enabledModuleKeys: string[];
  organizationName?: string;
  logoUrl?: string | null;
  accentColor?: string | null;
  fullName: string;
  roleTitle?: string | null;
  hasActiveTour: boolean;
  /** Module enabled AND ANTHROPIC_API_KEY configured — resolved server-side so the widget is absent, not just hidden, otherwise. */
  assistantAvailable: boolean;
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

  const showActionBar = role === "chauffeur" || role === "manager_chauffeur";

  return (
    <div className="flex min-h-screen">
      {drawerOpen && (
        <div
          className="fixed inset-0 z-40 bg-navy/40 lg:hidden"
          onClick={() => setDrawerOpen(false)}
          aria-hidden="true"
        />
      )}
      <Sidebar
        role={role}
        enabledModuleKeys={enabledModuleKeys}
        organizationName={organizationName}
        logoUrl={logoUrl}
        accentColor={accentColor}
        open={drawerOpen}
        onNavigate={() => setDrawerOpen(false)}
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar fullName={fullName} role={role} roleTitle={roleTitle} onMenuClick={() => setDrawerOpen(true)} />
        <main className={`flex-1 overflow-y-auto overflow-x-hidden p-4 sm:p-6 lg:p-8 ${showActionBar ? "pb-20 lg:pb-8" : ""}`}>
          {children}
        </main>
      </div>
      {showActionBar && <MobileActionBar role={role} enabledModuleKeys={enabledModuleKeys} hasActiveTour={hasActiveTour} />}
      {assistantAvailable && <AssistantWidget />}
    </div>
  );
}
