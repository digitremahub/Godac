import { garderPage } from "@/lib/acces/garde-page";
import Link from "next/link";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui";
import { RentalProvidersManager } from "@/components/rental/RentalProvidersManager";

export default async function RentalProvidersPage() {
  const g = await garderPage("flotte.loueurs");
  if (!g.ok) return g.ecran;
  const appUser = g.appUser;
  const supabase = await createServerSupabaseClient();

  const [{ data: providers }, { data: vehicles }] = await Promise.all([
    supabase.from("rental_providers").select("id, name, kind, contact_name, maintenance_emails, phone, contract_reference, notes, active").order("active", { ascending: false }).order("name"),
    supabase.from("vehicles").select("id, registration, rental_provider_id").not("rental_provider_id", "is", null),
  ]);

  const countByProvider = new Map<string, string[]>();
  for (const v of vehicles ?? []) {
    const list = countByProvider.get(v.rental_provider_id as string) ?? [];
    list.push(v.registration as string);
    countByProvider.set(v.rental_provider_id as string, list);
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Loueurs & prestataires"
        description="Loueurs, garages et loueurs avec entretien inclus. Ils reçoivent les demandes d'entretien des véhicules loués après validation d'un responsable."
        actions={
          <Link href="/flotte/loueurs" className="btn-secondary">
            Demandes transmises →
          </Link>
        }
      />
      <RentalProvidersManager
        providers={(providers ?? []).map((p: any) => ({ ...p, vehicles: countByProvider.get(p.id) ?? [] }))}
      />
      <p className="text-xs text-navy/60">
        Rattachez un véhicule à un loueur depuis sa fiche (encart « Location »). Les adresses e-mail saisies ici reçoivent les demandes validées :
        le prestataire devient destinataire des données du véhicule et de la demande (voir la politique de confidentialité).
      </p>
    </div>
  );
}
