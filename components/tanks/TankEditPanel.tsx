"use client";

import { useState } from "react";
import { EditTankForm } from "@/components/tanks/EditTankForm";

interface ServiceOption {
  id: string;
  name: string;
}

export function TankEditPanel({
  tankId,
  name,
  fuelType,
  capacityLiters,
  serviceId,
  services,
}: {
  tankId: string;
  name: string;
  fuelType: "diesel" | "adblue";
  capacityLiters: number;
  serviceId: string | null;
  services: ServiceOption[];
}) {
  const [editing, setEditing] = useState(false);

  if (editing) {
    return (
      <EditTankForm
        tankId={tankId}
        name={name}
        fuelType={fuelType}
        capacityLiters={capacityLiters}
        serviceId={serviceId}
        services={services}
        onClose={() => setEditing(false)}
      />
    );
  }

  return (
    <button className="btn-secondary w-full" onClick={() => setEditing(true)}>
      Modifier
    </button>
  );
}
