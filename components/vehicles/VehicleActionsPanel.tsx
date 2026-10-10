"use client";

import { useState } from "react";
import Link from "next/link";
import type { UserRole, VehicleType } from "@/lib/types/domain";
import { WashForm } from "@/components/vehicles/WashForm";
import { Card } from "@/components/ui";

export function VehicleActionsPanel({
  vehicleId,
  vehicleType,
  role,
  enabledModuleKeys,
  hasActiveTourHere,
}: {
  vehicleId: string;
  vehicleType: VehicleType;
  role: UserRole;
  enabledModuleKeys: string[];
  hasActiveTourHere: boolean;
}) {
  const [showWash, setShowWash] = useState(false);
  const enabled = new Set(enabledModuleKeys);
  const canDriveTours = role === "chauffeur" || role === "manager_chauffeur";

  if (showWash) {
    return (
      <div className="flex flex-col gap-3">
        <button className="self-start text-sm text-navy/50 hover:text-navy" onClick={() => setShowWash(false)}>
          ← Retour aux actions
        </button>
        <WashForm vehicleId={vehicleId} vehicleType={vehicleType} />
      </div>
    );
  }

  return (
    <Card className="flex flex-col gap-3">
      {canDriveTours && enabled.has("planning") && (
        <Link
          href={`/${hasActiveTourHere ? "tours/end" : "tours/start"}?vehicle=${vehicleId}`}
          className="btn-primary min-h-[52px] w-full justify-center text-base"
        >
          {hasActiveTourHere ? "🏁 Retour sur site" : "🚚 Départ de tournée"}
        </Link>
      )}

      <Link href={`/fuel?new=1&vehicle=${vehicleId}`} className="btn-secondary min-h-[52px] w-full justify-center text-base">
        ⛽ Plein
      </Link>

      {enabled.has("maintenance_requests") && (
        <Link href={`/maintenance?vehicle=${vehicleId}`} className="btn-secondary min-h-[52px] w-full justify-center text-base">
          🔧 Signaler un problème
        </Link>
      )}

      {enabled.has("washes") && (
        <button className="btn-secondary min-h-[52px] w-full justify-center text-base" onClick={() => setShowWash(true)}>
          🧽 Lavage
        </button>
      )}
    </Card>
  );
}
