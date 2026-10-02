import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireAppUser, hasRole } from "@/lib/auth/session";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { ROLE_LABELS } from "@/lib/roles/labels";
import { PageHeader, Card } from "@/components/ui";
import { FuelHistoryTable } from "@/components/fuel/FuelHistoryTable";
import { QrCodeBadge } from "@/components/qr/QrCodeBadge";
import { ConvocationButton } from "@/components/intranet/ConvocationButton";

/**
 * A driver's "fiche" — profile info plus their vehicle-usage history
 * (fuel_entries: the only table with a real per-day driver↔vehicle
 * record, since planning_entries exists in the schema but nothing
 * writes to it yet). manager-like/comptable/direction can open anyone's;
 * everyone else can only open their own.
 */
export default async function UserDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const appUser = await requireAppUser();
  const canViewOthers = hasRole(appUser.role, ["manager", "manager_chauffeur", "direction", "comptable"]);
  if (!canViewOthers && id !== appUser.id) {
    redirect("/dashboard");
  }

  const supabase = await createServerSupabaseClient();
  const [{ data: user }, { data: fuelHistory }] = await Promise.all([
    supabase
      .from("users")
      .select("id, full_name, email, role, role_title, active, auth_method, pin_set_at, driver_code, user_services(services(name))")
      .eq("id", id)
      .single(),
    supabase
      .from("fuel_entries")
      .select("id, occurred_at, liters, total_amount, status, gap_flagged, vehicles(registration)")
      .eq("driver_id", id)
      .order("occurred_at", { ascending: false })
      .limit(15),
  ]);

  if (!user) notFound();
  const u = user as any;
  const serviceNames = (u.user_services ?? []).map((us: any) => us.services?.name).filter(Boolean).join(", ");

  const isFieldRole = u.role === "chauffeur" || u.role === "manager_chauffeur";
  const canConvene = hasRole(appUser.role, ["manager", "manager_chauffeur", "direction"]) && id !== appUser.id;

  return (
    <div>
      <PageHeader
        title={u.full_name}
        description={ROLE_LABELS[u.role as keyof typeof ROLE_LABELS]}
        actions={canConvene ? <ConvocationButton employeeId={u.id} /> : undefined}
      />

      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <p className="text-sm text-navy/50">{u.auth_method === "pin" ? "Connexion" : "Email"}</p>
          <p>{u.auth_method === "pin" ? (u.pin_set_at ? "Badge + PIN" : "Badge — PIN non créé") : u.email}</p>
        </Card>
        <Card>
          <p className="text-sm text-navy/50">Titre affiché</p>
          <p>{u.role_title ?? "—"}</p>
        </Card>
        <Card>
          <p className="text-sm text-navy/50">Service</p>
          <p>{serviceNames || "—"}</p>
        </Card>
        <Card>
          <p className="text-sm text-navy/50">Statut</p>
          <span className={u.active ? "badge-teal" : "badge-neutral"}>{u.active ? "Actif" : "Inactif"}</span>
        </Card>
      </div>

      {isFieldRole && (
        <div className="mb-6 flex justify-center">
          <QrCodeBadge
            type="driver"
            id={u.id}
            title={u.full_name}
            subtitle={
              u.auth_method === "pin" ? (u.pin_set_at ? "Badge de connexion" : "Scannez pour créer votre code PIN") : "Badge chauffeur"
            }
            code={u.driver_code}
          />
        </div>
      )}

      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-base">Historique des véhicules utilisés</h3>
        <Link href={`/fuel?driver=${id}`} className="text-sm text-teal-ink hover:underline">
          Voir tout l&apos;historique →
        </Link>
      </div>
      <FuelHistoryTable
        entries={(fuelHistory ?? []) as any}
        showDriver={false}
        emptyDescription="Aucun ravitaillement enregistré pour ce chauffeur."
      />
    </div>
  );
}
