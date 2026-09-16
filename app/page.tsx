import Link from "next/link";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { getCurrentAppUser } from "@/lib/auth/session";
import { redirect } from "next/navigation";

export default async function HomePage() {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user) {
    const appUser = await getCurrentAppUser();
    redirect(appUser ? "/dashboard" : "/onboarding");
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-8 px-6 text-center">
      <div className="flex items-center gap-3">
        <div className="h-10 w-10 rounded-xl bg-teal" />
        <span className="font-display text-2xl font-extrabold">GODAC</span>
      </div>
      <h1 className="max-w-2xl text-4xl md:text-5xl">
        L&apos;OS de backoffice pour le transport routier de marchandises
      </h1>
      <p className="max-w-xl text-white/60">
        Carburant, flotte, RH, planning et conformité TICPE — dans une seule
        plateforme pensée pour les PME de transport françaises.
      </p>
      <div className="flex gap-4">
        <Link href="/sign-in" className="btn-secondary">
          Connexion
        </Link>
        <Link href="/sign-up" className="btn-primary">
          Essayer GODAC
        </Link>
      </div>
    </main>
  );
}
