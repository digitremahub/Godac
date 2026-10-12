import Link from "next/link";
import { AuthForm } from "@/components/auth/AuthForm";
import { AuthLayout, LegalLinks } from "@/components/auth/AuthLayout";

export default function SignInPage() {
  return (
    <AuthLayout footer={<LegalLinks />}>
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
