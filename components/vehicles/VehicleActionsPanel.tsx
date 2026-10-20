"use client";

import { useState } from "react";
import Link from "next/link";
import type { UserRole, VehicleType } from "@/lib/types/domain";
import { WashForm } from "@/components/vehicles/WashForm";
import { Card } from "@/components/ui";
import { IconDroplet, IconFlag, IconTruck, IconUsers, IconWashing, IconWrench } from "@/components/layout/icons";

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
        <button className="self-start text-sm text-navy/65 hover:text-navy" onClick={() => setShowWash(false)}>
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
          {hasActiveTourHere ? <><IconFlag className="inline-block h-4 w-4 shrink-0 align-[-0.2em]" /> Retour sur site</> : <><IconTruck className="inline-block h-4 w-4 shrink-0 align-[-0.2em]" /> Départ de tournée</>}
        </Link>
      )}

      <Link href={`/carburant/pleins?new=1&vehicle=${vehicleId}`} className="btn-secondary min-h-[52px] w-full justify-center text-base">
        <IconDroplet className="inline-block h-4 w-4 shrink-0 align-[-0.2em]" /> Plein
      </Link>

      {enabled.has("maintenance_requests") && (
        <Link href={`/maintenance?vehicle=${vehicleId}`} className="btn-secondary min-h-[52px] w-full justify-center text-base">
          <IconWrench className="inline-block h-4 w-4 shrink-0 align-[-0.2em]" /> Signaler un problème
        </Link>
      )}

      {canDriveTours && (
        <Link href={`/tours/help?vehicle=${vehicleId}`} className="btn-ghost min-h-[52px] w-full justify-center text-center text-base">
          <IconUsers className="inline-block h-4 w-4 shrink-0 align-[-0.2em]" /> J&apos;entre le départ / retour / ravitaillement d&apos;un collègue
        </Link>
      )}

      {enabled.has("washes") && (
        <button className="btn-secondary min-h-[52px] w-full justify-center text-base" onClick={() => setShowWash(true)}>
          <IconWashing className="inline-block h-4 w-4 shrink-0 align-[-0.2em]" /> Lavage
        </button>
      )}
    </Card>
  );
}
