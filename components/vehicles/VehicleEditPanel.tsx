"use client";

import { useState } from "react";
import { EditVehicleForm } from "@/components/vehicles/EditVehicleForm";

interface ServiceOption {
  id: string;
  name: string;
}

interface DriverOption {
  id: string;
  full_name: string;
}

type SpecSources = Record<string, { origin: "ia" | "saisie" | "import"; confirmed: boolean } | undefined>;

export function VehicleEditPanel({
  vehicleId,
  registration,
  type,
  tankCapacity,
  initialKm,
  status,
  serviceId,
  services,
  assignedDriverId,
  drivers,
  brand,
  model,
  modelYear,
  gearbox,
  fuelType,
  adblueCapacity,
  ptac,
  referenceConsumption,
  specSources,
}: {
  vehicleId: string;
  registration: string;
  type: "VL" | "PL" | "SPL";
  tankCapacity: number | null;
  initialKm: number | null;
  status: "active" | "maintenance" | "out_of_service";
  serviceId: string | null;
  services: ServiceOption[];
  assignedDriverId: string | null;
  drivers: DriverOption[];
  brand: string | null;
  model: string | null;
  modelYear: number | null;
  gearbox: string | null;
  fuelType: string | null;
  adblueCapacity: number | null;
  ptac: number | null;
  referenceConsumption: number | null;
  specSources: SpecSources;
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
        assignedDriverId={assignedDriverId}
        drivers={drivers}
        brand={brand}
        model={model}
        modelYear={modelYear}
        gearbox={gearbox}
        fuelType={fuelType}
        adblueCapacity={adblueCapacity}
        ptac={ptac}
        referenceConsumption={referenceConsumption}
        specSources={specSources}
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
