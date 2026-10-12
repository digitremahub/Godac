import Link from "next/link";
import { ForgotPasswordForm } from "@/components/auth/ForgotPasswordForm";
import { AuthLayout } from "@/components/auth/AuthLayout";

export default function ForgotPasswordPage() {
  return (
    <AuthLayout>
      <ForgotPasswordForm />
      <p className="text-center text-sm">
        <Link href="/sign-in" className="font-semibold text-teal-ink hover:underline">
          Retour à la connexion
        </Link>
      </p>
    </AuthLayout>
  );
}
