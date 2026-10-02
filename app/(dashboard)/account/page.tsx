import { requireAppUser, hasRole } from "@/lib/auth/session";
import { ROLE_LABELS } from "@/lib/roles/labels";
import { PageHeader, Card } from "@/components/ui";
import { PasswordForm } from "@/components/account/PasswordForm";
import { EmailForm } from "@/components/account/EmailForm";
import { NameForm } from "@/components/account/NameForm";
import { QrCodeBadge } from "@/components/qr/QrCodeBadge";

export default async function AccountPage() {
  const appUser = await requireAppUser();
  const isFieldRole = hasRole(appUser.role, ["chauffeur", "manager_chauffeur"]);

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
        <div className="flex max-w-md flex-col gap-2">
          <p className="label">Mon badge chauffeur</p>
          <QrCodeBadge
            type="driver"
            id={appUser.id}
            title={appUser.full_name}
            subtitle="À présenter à la pompe ou pour se connecter"
          />
        </div>
      )}

      <NameForm currentName={appUser.full_name} currentPhone={appUser.phone} />
      <EmailForm currentEmail={appUser.email} />
      <PasswordForm />
    </div>
  );
}
