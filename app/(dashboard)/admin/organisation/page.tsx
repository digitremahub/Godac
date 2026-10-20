import { garderPage } from "@/lib/acces/garde-page";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { isModuleEnabled } from "@/lib/organization/modules";
import { estPoleBureau } from "@/lib/organization/poles";
import { TRANCHES_EFFECTIF } from "@/lib/organization/recherche-entreprises";
import { paysDe } from "@/lib/pays/pays";
import { SiretPanel } from "@/components/organization/SiretPanel";
import { MiseEnPlaceCard } from "@/components/organization/MiseEnPlaceCard";
import { PageHeader } from "@/components/ui";
import { OrganizationSettingsForm } from "@/components/admin/OrganizationSettingsForm";
import { ServicesPanel } from "@/components/admin/ServicesPanel";
import { TanksPanel } from "@/components/admin/TanksPanel";
import { AssistantNotesPanel } from "@/components/admin/AssistantNotesPanel";
import { JoinLinkCard } from "@/components/admin/JoinLinkCard";
import { PayslipContributionLinesPanel } from "@/components/admin/PayslipContributionLinesPanel";

export default async function OrganizationSettingsPage() {
  const g = await garderPage("admin.organisation");
  if (!g.ok) return g.ecran;
  const appUser = g.appUser;
  const supabase = await createServerSupabaseClient();
  const isDirection = appUser.role === "direction";
  const [{ data: organization }, ocrEnabled, assistantEnabled, payslipsEnabled, { data: services }, { data: tanks }, { data: notes }, { data: contributionLines }, { data: memberships }, { data: activeUsers }] =
    await Promise.all([
      supabase
        .from("organizations")
        .select(
          "name, logo_url, accent_color, require_odometer_photo, auto_clock_enabled, emergency_phone, consumption_anomaly_threshold_percent, driver_signup_token, depot_address, siret, legal_address, legal_form, ape_code, convention_collective, urssaf_number, country, siren, legal_name, naf_label, idcc, effectif_tranche, company_created_on, siret_checked_at",
        )
        .eq("id", appUser.organization_id)
        .single(),
      isModuleEnabled(supabase, appUser.organization_id, "ocr"),
      isModuleEnabled(supabase, appUser.organization_id, "assistant"),
      isDirection ? isModuleEnabled(supabase, appUser.organization_id, "payslips") : Promise.resolve(false),
      supabase.from("services").select("id, name, code, pole, depot_address, team_leader_name, team_leader_phone, team_leader_email, team_leader_user_id").order("name"),
      supabase.from("tanks").select("id, name, fuel_type, capacity_liters, current_totalizer_index, service_id").order("name"),
      supabase.from("assistant_notes").select("id, title, content, roles").order("created_at", { ascending: false }),
      isDirection
        ? supabase.from("payslip_contribution_lines").select("id, label, salarial_rate, patronal_rate").order("created_at")
        : Promise.resolve({ data: null }),
      // Qui est dans quel pôle bureau — affiché sous chaque pôle.
      supabase.from("user_services").select("service_id, users(full_name, active)"),
      supabase.from("users").select("id, full_name").eq("organization_id", appUser.organization_id).eq("active", true).order("full_name"),
    ]);

  const membersByService = new Map<string, string[]>();
  for (const m of (memberships ?? []) as any[]) {
    if (!m.users?.full_name || m.users.active === false) continue;
    membersByService.set(m.service_id, [...(membersByService.get(m.service_id) ?? []), m.users.full_name]);
  }
  const servicesWithMembers = (services ?? []).map((s) => ({ ...s, members: membersByService.get(s.id) ?? [] }));
  // Les cuves sont du matériel transport : seuls les services d'exploitation leur sont proposés.
  const transportServices = (services ?? []).filter((s) => !estPoleBureau(s.pole));

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Organisation" description="Paramètres généraux de votre espace GODAC." />
      {isDirection && (
        <div className="grid items-start gap-6 lg:grid-cols-2">
          <SiretPanel
            actuel={{
              legal_name: organization?.legal_name,
              siret: organization?.siret,
              siren: organization?.siren,
              legal_form: organization?.legal_form,
              ape_code: organization?.ape_code,
              naf_label: organization?.naf_label,
              legal_address: organization?.legal_address,
              convention_collective: organization?.convention_collective,
              idcc: organization?.idcc,
              effectif_tranche: organization?.effectif_tranche,
              company_created_on: organization?.company_created_on,
              depot_address: organization?.depot_address,
              country: organization?.country,
            }}
            verifieLe={organization?.siret_checked_at ?? null}
          />
          {organization?.siret_checked_at && (
            <MiseEnPlaceCard
              idcc={(organization.idcc as string[] | null) ?? []}
              pays={paysDe(organization.country)}
              libelleEffectif={organization.effectif_tranche ? (TRANCHES_EFFECTIF[organization.effectif_tranche]?.libelle ?? null) : null}
            />
          )}
        </div>
      )}
      <OrganizationSettingsForm
        // Remonté après une lecture SIRET pour reprendre les valeurs écrites.
        key={organization?.siret_checked_at ?? "manuel"}
        organizationId={appUser.organization_id}
        name={organization?.name ?? ""}
        ocrEnabled={ocrEnabled}
        logoUrl={organization?.logo_url ?? null}
        accentColor={organization?.accent_color ?? null}
        requireOdometerPhoto={organization?.require_odometer_photo ?? false}
        autoClockEnabled={organization?.auto_clock_enabled ?? false}
        emergencyPhone={organization?.emergency_phone ?? null}
        consumptionAnomalyThresholdPercent={organization?.consumption_anomaly_threshold_percent ?? 20}
        depotAddress={organization?.depot_address ?? null}
        siret={organization?.siret ?? null}
        legalAddress={organization?.legal_address ?? null}
        legalForm={organization?.legal_form ?? null}
        apeCode={organization?.ape_code ?? null}
        conventionCollective={organization?.convention_collective ?? null}
        urssafNumber={organization?.urssaf_number ?? null}
        country={organization?.country ?? "FR"}
      />
      <ServicesPanel services={servicesWithMembers} users={activeUsers ?? []} />
      <TanksPanel tanks={tanks ?? []} services={transportServices} />
      {payslipsEnabled && (
        <PayslipContributionLinesPanel
          lines={(contributionLines ?? []).map((l) => ({ ...l, salarial_rate: Number(l.salarial_rate), patronal_rate: Number(l.patronal_rate) }))}
        />
      )}
      {assistantEnabled && <AssistantNotesPanel notes={(notes ?? []) as any} />}
      {appUser.role === "direction" && organization?.driver_signup_token && (
        <JoinLinkCard token={organization.driver_signup_token} />
      )}
    </div>
  );
}
