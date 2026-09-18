import { requireAppUser } from "@/lib/auth/session";
import { ROLE_LABELS } from "@/lib/roles/labels";
import { PageHeader, Card } from "@/components/ui";
import { PasswordForm } from "@/components/account/PasswordForm";
import { EmailForm } from "@/components/account/EmailForm";
import { NameForm } from "@/components/account/NameForm";

export default async function AccountPage() {
  const appUser = await requireAppUser();

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Mon compte" description="Vos informations de connexion GODAC." />

      <Card className="flex max-w-md flex-col gap-2">
        <div>
          <p className="text-sm text-navy/50">Rôle</p>
          <p>{ROLE_LABELS[appUser.role]}</p>
        </div>
      </Card>

      <NameForm currentName={appUser.full_name} />
      <EmailForm currentEmail={appUser.email} />
      <PasswordForm />
    </div>
  );
}
