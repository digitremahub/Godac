import { requireAppUser, hasRole } from "@/lib/auth/session";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { ROLE_LABELS } from "@/lib/roles/labels";
import { PageHeader, Card } from "@/components/ui";
import { PasswordForm } from "@/components/account/PasswordForm";
import { EmailForm } from "@/components/account/EmailForm";
import { NameForm } from "@/components/account/NameForm";
import { DriverPinForm } from "@/components/account/DriverPinForm";
import { PasskeyManager } from "@/components/account/PasskeyManager";
import { PushNotificationToggle } from "@/components/account/PushNotificationToggle";
import { QrCodeBadge } from "@/components/qr/QrCodeBadge";
import { isModuleEnabled } from "@/lib/organization/modules";
import Link from "next/link";

const PAYSLIP_MONTH_LABEL = new Intl.DateTimeFormat("fr-FR", { month: "long", year: "numeric" });

export default async function AccountPage() {
  const appUser = await requireAppUser();
  const isFieldRole = hasRole(appUser.role, ["chauffeur", "manager_chauffeur"]);

  let pinAlreadySet = false;
  let driverCode: string | null = null;
  let address: string | null = null;
  let contactEmail: string | null = null;
  let authMethod: string | null = null;
  const supabase = await createServerSupabaseClient();
  if (isFieldRole) {
    const { data } = await supabase
      .from("users")
      .select("pin_set_at, driver_code, address, contact_email, auth_method")
      .eq("id", appUser.id)
      .maybeSingle();
    pinAlreadySet = Boolean(data?.pin_set_at);
    driverCode = data?.driver_code ?? null;
    address = data?.address ?? null;
    contactEmail = data?.contact_email ?? null;
    authMethod = data?.auth_method ?? null;
  }
  const pushEnabled = await isModuleEnabled(supabase, appUser.organization_id, "push_notifications");

  // Raccourci de téléchargement directement accessible sur son propre
  // profil — en plus de /payslips (déjà rôle-scopé à "mes bulletins"
  // pour tout le monde), pour qu'un chauffeur n'ait jamais besoin de
  // chercher où trouver sa fiche générée.
  const payslipsEnabled = await isModuleEnabled(supabase, appUser.organization_id, "payslips");
  const payslips = payslipsEnabled
    ? (
        await supabase
          .from("payslips")
          .select("id, period_start, gross_amount, net_amount, file_path")
          .eq("user_id", appUser.id)
          .order("period_start", { ascending: false })
          .limit(5)
      ).data
    : null;
  const payslipsWithUrls = await Promise.all(
    (payslips ?? []).map(async (p) => {
      const { data: signed } = await supabase.storage.from("payslips").createSignedUrl(p.file_path, 300);
      return { ...p, downloadUrl: signed?.signedUrl ?? null };
    }),
  );

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Mon compte" description="Vos informations de connexion GODAC." />

      <Card className="flex max-w-md flex-col gap-2">
        <div>
          <p className="text-sm text-navy/50">Rôle</p>
          <p>{ROLE_LABELS[appUser.role]}</p>
        </div>
      </Card>

      {pushEnabled && <PushNotificationToggle />}

      {payslipsEnabled && (
        <Card className="flex max-w-md flex-col gap-2">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium">Mes fiches de paie</p>
            <Link href="/payslips" className="text-xs text-teal-ink hover:underline">
              Voir tout →
            </Link>
          </div>
          {payslipsWithUrls.length === 0 ? (
            <p className="text-xs text-navy/40">Aucun bulletin généré.</p>
          ) : (
            <ul className="flex flex-col gap-1">
              {payslipsWithUrls.map((p) => (
                <li key={p.id} className="flex items-center justify-between text-sm">
                  <span>{PAYSLIP_MONTH_LABEL.format(new Date(p.period_start))}</span>
                  {p.downloadUrl && (
                    <a href={p.downloadUrl} target="_blank" rel="noreferrer" className="text-teal-ink underline">
                      Télécharger
                    </a>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}

      {isFieldRole && (
        <>
          <div className="flex max-w-md flex-col gap-2">
            <p className="label">Mon badge chauffeur</p>
            <QrCodeBadge
              type="driver"
              id={appUser.id}
              title={appUser.full_name}
              subtitle={pinAlreadySet ? "Scannez pour vous connecter" : "À présenter à la pompe"}
              code={driverCode ?? undefined}
            />
          </div>
          <DriverPinForm pinAlreadySet={pinAlreadySet} />
        </>
      )}

      <NameForm
        currentName={appUser.full_name}
        currentPhone={appUser.phone}
        currentAddress={address}
        showAddress={isFieldRole}
        currentContactEmail={contactEmail}
        showContactEmail={authMethod === "pin"}
      />
      {authMethod !== "pin" && <EmailForm currentEmail={appUser.email} />}
      <PasswordForm />
      <PasskeyManager />
    </div>
  );
}
