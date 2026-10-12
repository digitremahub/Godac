import Link from "next/link";
import { AuthForm } from "@/components/auth/AuthForm";
import { DriverBadgeLogin } from "@/components/auth/DriverBadgeLogin";
import { AuthLayout, LegalLinks } from "@/components/auth/AuthLayout";

export default function SignInPage() {
  return (
    <AuthLayout footer={<LegalLinks />}>
      <DriverBadgeLogin />
      <div className="flex items-center gap-3 text-xs font-semibold uppercase tracking-[0.12em] text-navy/50">
        <span className="h-px flex-1 bg-navy/10" />
        ou avec votre e-mail
        <span className="h-px flex-1 bg-navy/10" />
      </div>
      <AuthForm mode="sign-in" />
      <p className="text-center text-sm text-navy/65">
        Pas encore de compte ?{" "}
        <Link href="/sign-up" className="font-semibold text-teal-ink hover:underline">
          Créer un compte
        </Link>
      </p>
    </AuthLayout>
  );
}
