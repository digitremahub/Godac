"use client";

import { useState } from "react";
import { EditVehicleForm } from "@/components/vehicles/EditVehicleForm";

interface ServiceOption {
  id: string;
  name: string;
}

export function VehicleEditPanel({
  vehicleId,
  registration,
  type,
  tankCapacity,
  initialKm,
  status,
  serviceId,
  services,
}: {
  vehicleId: string;
  registration: string;
  type: "VL" | "PL" | "SPL";
  tankCapacity: number | null;
  initialKm: number | null;
  status: "active" | "maintenance" | "out_of_service";
  serviceId: string | null;
  services: ServiceOption[];
}) {
  const [editing, setEditing] = useState(false);

  if (editing) {
    return (
      <EditVehicleForm
        vehicleId={vehicleId}
        registration={registration}
        type={type}
        tankCapacity={tankCapacity}
        initialKm={initialKm}
        status={status}
        serviceId={serviceId}
        services={services}
        onClose={() => setEditing(false)}
      />
    );
  }

  return (
    <button className="btn-secondary" onClick={() => setEditing(true)}>
      Modifier
    </button>
  );
}
