import { requireAppUser, hasRole } from "@/lib/auth/session";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { ROLE_LABELS } from "@/lib/roles/labels";
import { PageHeader, Card } from "@/components/ui";
import { PasswordForm } from "@/components/account/PasswordForm";
import { EmailForm } from "@/components/account/EmailForm";
import { NameForm } from "@/components/account/NameForm";
import { DriverPinForm } from "@/components/account/DriverPinForm";
import { QrCodeBadge } from "@/components/qr/QrCodeBadge";

export default async function AccountPage() {
  const appUser = await requireAppUser();
  const isFieldRole = hasRole(appUser.role, ["chauffeur", "manager_chauffeur"]);

  let pinAlreadySet = false;
  let driverCode: string | null = null;
  let address: string | null = null;
  if (isFieldRole) {
    const supabase = await createServerSupabaseClient();
    const { data } = await supabase.from("users").select("pin_set_at, driver_code, address").eq("id", appUser.id).maybeSingle();
    pinAlreadySet = Boolean(data?.pin_set_at);
    driverCode = data?.driver_code ?? null;
    address = data?.address ?? null;
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Mon compte" description="Vos informations de connexion GODAC." />

      <Card className="flex max-w-md flex-col gap-2">
        <div>
          <p className="text-sm text-navy/50">Rôle</p>
          <p>{ROLE_LABELS[appUser.role]}</p>
        </div>
      </Card>

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

      <NameForm currentName={appUser.full_name} currentPhone={appUser.phone} currentAddress={address} showAddress={isFieldRole} />
      <EmailForm currentEmail={appUser.email} />
      <PasswordForm />
    </div>
  );
}
