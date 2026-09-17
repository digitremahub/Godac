import Link from "next/link";
import { AuthForm } from "@/components/auth/AuthForm";

export default function SignUpPage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 p-6">
      <Link href="/" className="flex items-center gap-2.5">
        <div className="h-8 w-8 rounded-lg bg-teal shadow-[0_2px_12px_-2px_rgba(27,228,193,0.6)]" />
        <span className="font-display text-xl font-extrabold">GODAC</span>
      </Link>
      <AuthForm mode="sign-up" />
      <p className="text-sm text-white/40">
        Déjà un compte ?{" "}
        <Link href="/sign-in" className="text-teal hover:underline">
          Se connecter
        </Link>
      </p>
    </main>
  );
}
