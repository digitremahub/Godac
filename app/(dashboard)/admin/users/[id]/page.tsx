import { PRESENCE_STATUS, estPoleBureau, libelleServiceAvecPole } from "@/lib/organization/poles";
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
import { DriverContactForm } from "@/components/admin/DriverContactForm";
import { EmployeeFileForm } from "@/components/admin/EmployeeFileForm";
import { EmployeeDocumentsPanel, type EmployeeDocument } from "@/components/admin/EmployeeDocumentsPanel";
import { isModuleEnabled } from "@/lib/organization/modules";
import { computeHourlyRates } from "@/lib/business/payroll";

const LEAVE_STATUS_LABELS: Record<string, string> = { pending: "En attente", approved: "Approuvé", rejected: "Refusé" };
const STATUS_LABELS: Record<string, string> = { titulaire: "Titulaire", formation: "Formation", remplacement: "Remplacement" };
const HR_STATUS_LABELS: Record<string, string> = { active: "Actif", on_leave: "En congé", suspended: "Suspendu", terminated: "Sorti des effectifs" };
const CONTRACT_TYPE_LABELS: Record<string, string> = { cdi: "CDI", cdd: "CDD", interim: "Intérim", apprentissage: "Apprentissage" };
const TOUR_STATUS_LABELS: Record<string, string> = { planned: "Prévue", in_progress: "En cours", done: "Terminée" };
const PAYSLIP_MONTH_LABEL = new Intl.DateTimeFormat("fr-FR", { month: "long", year: "numeric" });

/**
 * A driver's "fiche" — visibility of each section depends on both the
 * viewer's role AND whether the org has bought the module behind it
 * (a client can own employee_files without hr_status, or buy neither):
 *
 *  - chauffeur (soi-même) : identité, son propre historique tournées/
 *    carburant et ses propres fiches de paie — jamais la rémunération
 *    (le brut/net du contrat) ni le dossier RH.
 *  - manager/manager_chauffeur (quelqu'un d'autre) : identité, congés et
 *    historiques tournées/carburant — RLS les scope déjà à leur(s)
 *    service(s), pas besoin de refiltrer ici. Jamais la rémunération,
 *    les coordonnées ou le dossier RH.
 *  - comptable : rémunération + dossier RH en lecture seule (contrat/
 *    dates, jamais les documents ni les notes RH "usage interne
 *    direction"). Jamais l'historique véhicule — hors de son périmètre.
 *  - direction : tout, en édition.
 *
 * "Historique des véhicules utilisés" vient de deux sources
 * complémentaires : planning_entries (qui a réellement pris quel
 * véhicule, et quand — alimenté par StartTourFlow/EndTourFlow) et
 * fuel_entries (le détail des pleins). La première est la trace
 * fiable, la seconde ne couvre que les chauffeurs qui font eux-mêmes
 * le plein.
 */
export default async function UserDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const appUser = await requireAppUser();
  const canViewOthers = hasRole(appUser.role, ["manager", "manager_chauffeur", "direction", "comptable"]);
  if (!canViewOthers && id !== appUser.id) {
    redirect("/dashboard");
  }

  const supabase = await createServerSupabaseClient();
  const isSelf = id === appUser.id;
  const isDirection = appUser.role === "direction";
  const isComptable = appUser.role === "comptable";
  const isManagerLike = hasRole(appUser.role, ["manager", "manager_chauffeur"]) && !isSelf;
  const canSeeOperational = isDirection || isManagerLike || isSelf;
  const canSeePayrollAndHr = isDirection || isComptable;
  // Rémunération/dossier RH stay direction+comptable only — but a
  // chauffeur can always see their own payslips, same as /payslips
  // already lets them (this page is just a second place to find them,
  // on their own profile).
  const canSeePayslips = canSeePayrollAndHr || isSelf;

  const [employeeFilesEnabled, hrStatusEnabled, leaveManagementEnabled, planningEnabled, fuelTrackingEnabled, payslipsEnabled] = await Promise.all([
    canSeePayrollAndHr ? isModuleEnabled(supabase, appUser.organization_id, "employee_files") : Promise.resolve(false),
    canSeePayrollAndHr ? isModuleEnabled(supabase, appUser.organization_id, "hr_status") : Promise.resolve(false),
    isDirection || isManagerLike ? isModuleEnabled(supabase, appUser.organization_id, "leave_management") : Promise.resolve(false),
    canSeeOperational ? isModuleEnabled(supabase, appUser.organization_id, "planning") : Promise.resolve(false),
    canSeeOperational ? isModuleEnabled(supabase, appUser.organization_id, "fuel_tracking") : Promise.resolve(false),
    canSeePayslips ? isModuleEnabled(supabase, appUser.organization_id, "payslips") : Promise.resolve(false),
  ]);
  const showLeaves = (isDirection || isManagerLike) && leaveManagementEnabled;
  const showTourHistory = canSeeOperational && planningEnabled;
  const showFuelHistory = canSeeOperational && fuelTrackingEnabled;

  const [
    { data: user },
    { data: tourHistory },
    { data: fuelHistory },
    { data: orgServices },
    { data: contract },
    { data: employeeFile },
    { data: hrStatus },
    { data: recentLeaves },
    { data: payslips },
  ] = await Promise.all([
      supabase
        .from("users")
        .select(
          "id, full_name, email, phone, address, contact_email, role, role_title, active, auth_method, pin_set_at, driver_code, user_services(service_id, status, services(name, pole))",
        )
        .eq("id", id)
        .single(),
      showTourHistory
        ? supabase
            .from("planning_entries")
            .select("id, tour_number, start_at, status, vehicles(registration)")
            .eq("driver_id", id)
            // Les présences d'un pôle bureau ne sont pas des tournées.
            .neq("status", PRESENCE_STATUS)
            .order("start_at", { ascending: false })
            .limit(15)
        : Promise.resolve({ data: null }),
      showFuelHistory
        ? supabase
            .from("fuel_entries")
            .select("id, occurred_at, liters, total_amount, status, gap_flagged, product, station_name, tank_id, tanks(name), vehicles(registration)")
            .eq("driver_id", id)
            .order("occurred_at", { ascending: false })
            .limit(15)
        : Promise.resolve({ data: null }),
      isDirection ? supabase.from("services").select("id, name, pole").order("name") : Promise.resolve({ data: null }),
      canSeePayrollAndHr
        ? supabase.from("user_contracts").select("monthly_gross_salary, monthly_net_salary, contractual_monthly_hours").eq("user_id", id).maybeSingle()
        : Promise.resolve({ data: null }),
      employeeFilesEnabled
        ? supabase
            .from("employee_files")
            .select(
              "id, contract_type, hire_date, contract_end_date, hr_status, notes, birth_date, matricule, social_security_number, classification",
            )
            .eq("user_id", id)
            .maybeSingle()
        : Promise.resolve({ data: null }),
      hrStatusEnabled ? supabase.rpc("compute_hr_status", { p_user_id: id }) : Promise.resolve({ data: null }),
      showLeaves
        ? supabase.from("leave_requests").select("start_date, end_date, status").eq("driver_id", id).order("start_date", { ascending: false }).limit(5)
        : Promise.resolve({ data: null }),
      payslipsEnabled
        ? supabase
            .from("payslips")
            .select("id, period_start, period_end, gross_amount, net_amount, file_path")
            .eq("user_id", id)
            .order("period_start", { ascending: false })
            .limit(5)
        : Promise.resolve({ data: null }),
    ]);

  if (!user) notFound();
  const u = user as any;

  const payslipsWithUrls = await Promise.all(
    (payslips ?? []).map(async (p) => {
      const { data: signed } = await supabase.storage.from("payslips").createSignedUrl(p.file_path, 300);
      return { ...p, downloadUrl: signed?.signedUrl ?? null };
    }),
  );

  let employeeDocuments: EmployeeDocument[] = [];
  if (isDirection && employeeFilesEnabled && employeeFile?.id) {
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

  const serviceNames = (u.user_services ?? [])
    .filter((us: any) => us.services?.name)
    .map((us: any) =>
      estPoleBureau(us.services.pole)
        ? `Pôle ${libelleServiceAvecPole(us.services)}`
        : `${us.services.name} (${STATUS_LABELS[us.status] ?? us.status})`,
    )
    .join(", ");
  const serviceAssignments = (u.user_services ?? []).map((us: any) => ({ service_id: us.service_id, status: us.status }));
  // Titulaire/polyvalent n'est pas un champ à part : un chauffeur
  // qualifié sur 2+ services est de fait polyvalent entre eux (et
  // c'est ce qui autorise le Kanban "Par service" à le proposer en
  // glisser-déposer) ; qualifié sur un seul, il est titulaire de celui-ci.
  const qualificationCount = (u.user_services ?? []).filter((us: any) => !estPoleBureau(us.services?.pole)).length;
  const qualificationBadge =
    qualificationCount >= 2 ? { label: "Polyvalent", className: "badge-gold" } : qualificationCount === 1 ? { label: "Titulaire", className: "badge-neutral" } : null;

  const isFieldRole = u.role === "chauffeur" || u.role === "manager_chauffeur";
  const canConvene = hasRole(appUser.role, ["manager", "manager_chauffeur", "direction"]) && !isSelf;

  return (
    <div>
      <PageHeader
        title={u.full_name}
        description={ROLE_LABELS[u.role as keyof typeof ROLE_LABELS]}
        actions={canConvene ? <ConvocationButton employeeId={u.id} /> : undefined}
      />

      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <p className="text-sm text-navy/65">{u.auth_method === "pin" ? "Connexion" : "Email"}</p>
          <p>{u.auth_method === "pin" ? (u.pin_set_at ? "Badge + PIN" : "Badge — PIN non créé") : u.email}</p>
        </Card>
        <Card>
          <p className="text-sm text-navy/65">Titre affiché</p>
          <p>{u.role_title ?? "—"}</p>
        </Card>
        <Card>
          <div className="flex items-center justify-between">
            <p className="text-sm text-navy/65">Service / pôle</p>
            {qualificationBadge && <span className={qualificationBadge.className}>{qualificationBadge.label}</span>}
          </div>
          <p>{serviceNames || "—"}</p>
        </Card>
        <Card>
          <p className="text-sm text-navy/65">Statut</p>
          <span className={u.active ? "badge-teal" : "badge-neutral"}>{u.active ? "Actif" : "Inactif"}</span>
        </Card>
      </div>

      {isFieldRole && (isDirection || isManagerLike || isSelf) && (
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

      {(isDirection || isManagerLike) && isFieldRole && !isSelf && (
        <DriverContactForm
          userId={u.id}
          currentPhone={u.phone ?? null}
          currentAddress={u.address ?? null}
          currentContactEmail={u.contact_email ?? null}
          canEditAll={isDirection}
        />
      )}

      {canSeePayrollAndHr && (
        <div className="mb-6 flex flex-col gap-4">
          <Card className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium">Rémunération</p>
              {isDirection && (
                <Link href="/payroll" className="text-xs text-teal-ink hover:underline">
                  Modifier →
                </Link>
              )}
            </div>
            <div>
              <p className="text-xs text-navy/60">Salaire mensuel brut / net</p>
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
              <p className="text-xs text-navy/60">Heures contractuelles mensuelles</p>
              <p className="text-sm">{contract ? Number(contract.contractual_monthly_hours) : "—"}</p>
            </div>
            <div>
              <p className="text-xs text-navy/60">Taux horaire brut / net</p>
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

          {hrStatusEnabled && hrStatus && (
            <p className="text-sm">
              Statut RH actuel :{" "}
              <span className={hrStatus === "active" ? "badge-teal" : hrStatus === "on_leave" ? "badge-gold" : "badge-orange"}>
                {HR_STATUS_LABELS[hrStatus as string] ?? (hrStatus as string)}
              </span>
            </p>
          )}

          {employeeFilesEnabled &&
            (isDirection ? (
              <>
                <EmployeeFileForm
                  userId={u.id}
                  initialContractType={employeeFile?.contract_type ?? null}
                  initialHireDate={employeeFile?.hire_date ?? null}
                  initialContractEndDate={employeeFile?.contract_end_date ?? null}
                  initialHrStatus={(employeeFile?.hr_status as "active" | "suspended" | "terminated" | undefined) ?? "active"}
                  initialNotes={employeeFile?.notes ?? null}
                  initialBirthDate={employeeFile?.birth_date ?? null}
                  initialMatricule={employeeFile?.matricule ?? null}
                  initialSocialSecurityNumber={employeeFile?.social_security_number ?? null}
                  initialClassification={employeeFile?.classification ?? null}
                />
                <EmployeeDocumentsPanel userId={u.id} documents={employeeDocuments} />
              </>
            ) : (
              <Card className="flex flex-col gap-2">
                <p className="text-sm font-medium">Dossier RH</p>
                <div>
                  <p className="text-xs text-navy/60">Type de contrat</p>
                  <p className="text-sm">
                    {employeeFile?.contract_type ? CONTRACT_TYPE_LABELS[employeeFile.contract_type] ?? employeeFile.contract_type : "—"}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-navy/60">Date d&apos;embauche</p>
                  <p className="text-sm">
                    {employeeFile?.hire_date ? new Date(employeeFile.hire_date).toLocaleDateString("fr-FR", { timeZone: "Europe/Paris" }) : "—"}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-navy/60">Fin de contrat</p>
                  <p className="text-sm">
                    {employeeFile?.contract_end_date
                      ? new Date(employeeFile.contract_end_date).toLocaleDateString("fr-FR", { timeZone: "Europe/Paris" })
                      : "—"}
                  </p>
                </div>
              </Card>
            ))}
        </div>
      )}

      {payslipsEnabled && (
        <Card className="mb-6 flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium">Fiches de paie</p>
            <Link href="/payslips" className="text-xs text-teal-ink hover:underline">
              {isDirection ? "Générer / voir tout →" : "Voir tout →"}
            </Link>
          </div>
          {payslipsWithUrls.length === 0 ? (
            <p className="text-xs text-navy/60">{isSelf ? "Aucun bulletin généré." : "Aucun bulletin généré pour ce chauffeur."}</p>
          ) : (
            <ul className="flex flex-col gap-1">
              {payslipsWithUrls.map((p) => (
                <li key={p.id} className="flex items-center justify-between text-sm">
                  <span>{PAYSLIP_MONTH_LABEL.format(new Date(p.period_start))}</span>
                  <span className="flex items-center gap-3">
                    <span className="text-xs text-navy/60">
                      {Number(p.gross_amount).toLocaleString("fr-FR")} € brut / {Number(p.net_amount).toLocaleString("fr-FR")} € net
                    </span>
                    {p.downloadUrl && (
                      <a href={p.downloadUrl} target="_blank" rel="noreferrer" className="text-teal-ink underline">
                        Télécharger
                      </a>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}

      {isDirection && <DriverServicesPanel userId={u.id} services={orgServices ?? []} initialAssignments={serviceAssignments} />}

      {showLeaves && (
        <Card className="mb-6 flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium">Congés récents</p>
            <Link href="/leaves" className="text-xs text-teal-ink hover:underline">
              Voir tout →
            </Link>
          </div>
          {(recentLeaves ?? []).length === 0 ? (
            <p className="text-xs text-navy/60">Aucune demande de congé.</p>
          ) : (
            <ul className="flex flex-col gap-1">
              {(recentLeaves ?? []).map((lr: any, i: number) => (
                <li key={i} className="flex items-center justify-between text-sm">
                  <span>
                    {new Date(lr.start_date).toLocaleDateString("fr-FR", { timeZone: "Europe/Paris" })} →{" "}
                    {new Date(lr.end_date).toLocaleDateString("fr-FR", { timeZone: "Europe/Paris" })}
                  </span>
                  <span className="text-xs text-navy/60">{LEAVE_STATUS_LABELS[lr.status] ?? lr.status}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}

      {showTourHistory && (
        <div className="mb-6">
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-base">Historique des tournées</h3>
            <Link href={`/tours/history?driver=${id}`} className="text-sm text-teal-ink hover:underline">
              Voir tout →
            </Link>
          </div>
          {(tourHistory ?? []).length === 0 ? (
            <Card>
              <p className="text-xs text-navy/60">Aucune tournée enregistrée pour ce chauffeur.</p>
            </Card>
          ) : (
            <Card className="flex flex-col gap-1.5">
              {(tourHistory ?? []).map((t: any) => (
                <div key={t.id} className="flex items-center justify-between text-sm">
                  <span>
                    {new Date(t.start_at).toLocaleString("fr-FR", {
                      day: "2-digit",
                      month: "2-digit",
                      hour: "2-digit",
                      minute: "2-digit",
                      timeZone: "Europe/Paris",
                    })}{" "}
                    — n°{t.tour_number}
                    {t.vehicles ? ` (${t.vehicles.registration})` : ""}
                  </span>
                  <span className="text-xs text-navy/60">{TOUR_STATUS_LABELS[t.status] ?? t.status}</span>
                </div>
              ))}
            </Card>
          )}
        </div>
      )}

      {showFuelHistory && (
        <div>
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-base">Historique des ravitaillements</h3>
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
      )}
    </div>
  );
}
