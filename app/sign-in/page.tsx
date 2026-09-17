import Link from "next/link";
import { AuthForm } from "@/components/auth/AuthForm";

export default function SignInPage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 p-6">
      <Link href="/" className="flex items-center gap-2.5">
        <div className="h-8 w-8 rounded-lg bg-teal shadow-[0_2px_12px_-2px_rgba(27,228,193,0.6)]" />
        <span className="font-display text-xl font-extrabold">GODAC</span>
      </Link>
      <AuthForm mode="sign-in" />
      <p className="text-sm text-navy/40">
        Pas encore de compte ?{" "}
        <Link href="/sign-up" className="text-teal-ink hover:underline">
          Créer un compte
        </Link>
      </p>
    </main>
  );
}
