import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireAppUser, hasRole } from "@/lib/auth/session";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { ROLE_LABELS } from "@/lib/roles/labels";
import { PageHeader, Card } from "@/components/ui";
import { FuelHistoryTable } from "@/components/fuel/FuelHistoryTable";
import { QrCodeBadge } from "@/components/qr/QrCodeBadge";
import { ConvocationButton } from "@/components/intranet/ConvocationButton";
import { DriverServicesPanel } from "@/components/admin/DriverServicesPanel";
import { EmployeeFileForm } from "@/components/admin/EmployeeFileForm";
import { EmployeeDocumentsPanel, type EmployeeDocument } from "@/components/admin/EmployeeDocumentsPanel";
import { isModuleEnabled } from "@/lib/organization/modules";
import { computeHourlyRates } from "@/lib/business/payroll";

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
  const isDirection = appUser.role === "direction";
  const employeeFilesEnabled = isDirection && (await isModuleEnabled(supabase, appUser.organization_id, "employee_files"));

  const [{ data: user }, { data: fuelHistory }, { data: orgServices }, { data: contract }, { data: employeeFile }, { data: hrStatus }, { data: recentLeaves }] =
    await Promise.all([
      supabase
        .from("users")
        .select(
          "id, full_name, email, phone, address, contact_email, role, role_title, active, auth_method, pin_set_at, driver_code, user_services(service_id, status, services(name))",
        )
        .eq("id", id)
        .single(),
      supabase
        .from("fuel_entries")
        .select("id, occurred_at, liters, total_amount, status, gap_flagged, vehicles(registration)")
        .eq("driver_id", id)
        .order("occurred_at", { ascending: false })
        .limit(15),
      isDirection ? supabase.from("services").select("id, name").order("name") : Promise.resolve({ data: null }),
      isDirection
        ? supabase.from("user_contracts").select("monthly_gross_salary, monthly_net_salary, contractual_monthly_hours").eq("user_id", id).maybeSingle()
        : Promise.resolve({ data: null }),
      employeeFilesEnabled
        ? supabase
            .from("employee_files")
            .select("id, contract_type, hire_date, contract_end_date, hr_status, notes")
            .eq("user_id", id)
            .maybeSingle()
        : Promise.resolve({ data: null }),
      employeeFilesEnabled ? supabase.rpc("compute_hr_status", { p_user_id: id }) : Promise.resolve({ data: null }),
      isDirection
        ? supabase.from("leave_requests").select("start_date, end_date, status").eq("driver_id", id).order("start_date", { ascending: false }).limit(5)
        : Promise.resolve({ data: null }),
    ]);

  if (!user) notFound();
  const u = user as any;

  let employeeDocuments: EmployeeDocument[] = [];
  if (employeeFilesEnabled && employeeFile?.id) {
    const { data: docs } = await supabase
      .from("employee_documents")
      .select("id, doc_type, uploaded_at, file_path")
      .eq("employee_file_id", employeeFile.id)
      .order("uploaded_at", { ascending: false });
    employeeDocuments = await Promise.all(
      (docs ?? []).map(async (doc) => {
        const { data: signed } = await supabase.storage.from("employee-documents").createSignedUrl(doc.file_path, 300);
        return { id: doc.id, docType: doc.doc_type, uploadedAt: doc.uploaded_at, downloadUrl: signed?.signedUrl ?? null };
      }),
    );
  }

  const hourlyRates = contract
    ? computeHourlyRates({
        monthlyGrossSalary: contract.monthly_gross_salary !== null ? Number(contract.monthly_gross_salary) : null,
        monthlyNetSalary: contract.monthly_net_salary !== null ? Number(contract.monthly_net_salary) : null,
        contractualMonthlyHours: Number(contract.contractual_monthly_hours),
      })
    : null;

  const LEAVE_STATUS_LABELS: Record<string, string> = { pending: "En attente", approved: "Approuvé", rejected: "Refusé" };
  const STATUS_LABELS: Record<string, string> = { titulaire: "Titulaire", formation: "Formation", remplacement: "Remplacement" };
  const serviceNames = (u.user_services ?? [])
    .filter((us: any) => us.services?.name)
    .map((us: any) => `${us.services.name} (${STATUS_LABELS[us.status] ?? us.status})`)
    .join(", ");
  const serviceAssignments = (u.user_services ?? []).map((us: any) => ({ service_id: us.service_id, status: us.status }));

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

      {isDirection && (
        <div className="mb-6 flex flex-col gap-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Card className="flex flex-col gap-2">
              <p className="text-sm font-medium">Coordonnées</p>
              <div>
                <p className="text-xs text-navy/40">Téléphone</p>
                <p className="text-sm">{u.phone ?? "—"}</p>
              </div>
              <div>
                <p className="text-xs text-navy/40">Adresse</p>
                <p className="text-sm">{u.address ?? "—"}</p>
              </div>
              <div>
                <p className="text-xs text-navy/40">Email de contact</p>
                <p className="text-sm">{u.contact_email ?? "—"}</p>
              </div>
            </Card>

            <Card className="flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium">Rémunération</p>
                <Link href="/payroll" className="text-xs text-teal-ink hover:underline">
                  Modifier →
                </Link>
              </div>
              <div>
                <p className="text-xs text-navy/40">Salaire mensuel brut / net</p>
                <p className="text-sm">
                  {contract?.monthly_gross_salary !== null && contract?.monthly_gross_salary !== undefined
                    ? `${Number(contract.monthly_gross_salary).toLocaleString("fr-FR")} €`
                    : "—"}
                  {" / "}
                  {contract?.monthly_net_salary !== null && contract?.monthly_net_salary !== undefined
                    ? `${Number(contract.monthly_net_salary).toLocaleString("fr-FR")} €`
                    : "—"}
                </p>
              </div>
              <div>
                <p className="text-xs text-navy/40">Heures contractuelles mensuelles</p>
                <p className="text-sm">{contract ? Number(contract.contractual_monthly_hours) : "—"}</p>
              </div>
              <div>
                <p className="text-xs text-navy/40">Taux horaire brut / net</p>
                <p className="text-sm">
                  {hourlyRates?.grossPerHour !== null && hourlyRates?.grossPerHour !== undefined
                    ? `${hourlyRates.grossPerHour.toFixed(2)} €`
                    : "—"}
                  {" / "}
                  {hourlyRates?.netPerHour !== null && hourlyRates?.netPerHour !== undefined
                    ? `${hourlyRates.netPerHour.toFixed(2)} €`
                    : "—"}
                </p>
              </div>
            </Card>
          </div>

          <DriverServicesPanel userId={u.id} services={orgServices ?? []} initialAssignments={serviceAssignments} />

          {employeeFilesEnabled && (
            <>
              {hrStatus && (
                <p className="text-sm">
                  Statut RH actuel :{" "}
                  <span className={hrStatus === "active" ? "badge-teal" : hrStatus === "on_leave" ? "badge-gold" : "badge-orange"}>
                    {{ active: "Actif", on_leave: "En congé", suspended: "Suspendu", terminated: "Sorti des effectifs" }[hrStatus as string] ??
                      hrStatus}
                  </span>
                </p>
              )}
              <EmployeeFileForm
                userId={u.id}
                initialContractType={employeeFile?.contract_type ?? null}
                initialHireDate={employeeFile?.hire_date ?? null}
                initialContractEndDate={employeeFile?.contract_end_date ?? null}
                initialHrStatus={(employeeFile?.hr_status as "active" | "suspended" | "terminated" | undefined) ?? "active"}
                initialNotes={employeeFile?.notes ?? null}
              />
              <EmployeeDocumentsPanel userId={u.id} documents={employeeDocuments} />
            </>
          )}

          <Card className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium">Congés récents</p>
              <Link href="/leaves" className="text-xs text-teal-ink hover:underline">
                Voir tout →
              </Link>
            </div>
            {(recentLeaves ?? []).length === 0 ? (
              <p className="text-xs text-navy/40">Aucune demande de congé.</p>
            ) : (
              <ul className="flex flex-col gap-1">
                {(recentLeaves ?? []).map((lr: any, i: number) => (
                  <li key={i} className="flex items-center justify-between text-sm">
                    <span>
                      {new Date(lr.start_date).toLocaleDateString("fr-FR")} → {new Date(lr.end_date).toLocaleDateString("fr-FR")}
                    </span>
                    <span className="text-xs text-navy/40">{LEAVE_STATUS_LABELS[lr.status] ?? lr.status}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
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
