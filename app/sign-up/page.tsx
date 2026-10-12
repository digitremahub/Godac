import Link from "next/link";
import { AuthForm } from "@/components/auth/AuthForm";
import { AuthLayout, LegalLinks } from "@/components/auth/AuthLayout";

export default function SignUpPage() {
  return (
    <AuthLayout footer={<LegalLinks />}>
      <AuthForm mode="sign-up" />
      <p className="text-center text-sm text-navy/65">
        Déjà un compte ?{" "}
        <Link href="/sign-in" className="font-semibold text-teal-ink hover:underline">
          Se connecter
        </Link>
      </p>
    </AuthLayout>
  );
}
