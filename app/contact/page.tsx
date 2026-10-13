import Link from "next/link";
import { SiteFooter, SiteHeader } from "@/components/marketing/SiteChrome";
import { DemoRequestForm } from "@/components/marketing/DemoRequestForm";
import { EDITEUR } from "@/lib/legal/editeur";

export const metadata = { title: "Demander une démo — GODAC" };

const ETAPES = [
  ["30 min", "Démo personnalisée de votre quotidien : pleins, planning, tournées, paie."],
  ["Sous 10 jours ouvrés", "Mise en service : nous importons vos véhicules et vos chauffeurs, et formons votre équipe."],
  ["Dès le 1er jour", "Vos chauffeurs utilisent GODAC sur leur téléphone, sans formation."],
];

export default async function ContactPage({ searchParams }: { searchParams: Promise<{ plan?: string; modules?: string }> }) {
  const p = await searchParams;
  const modules = (p.modules ?? "").split(",").filter(Boolean).slice(0, 40);
  return (
    <div className="min-h-screen">
      <div className="relative overflow-hidden bg-marine text-[#F0F4FF]">
        <div aria-hidden="true" className="pointer-events-none absolute -right-40 top-10 h-96 w-96 rounded-full bg-teal/15 blur-3xl" />
        <SiteHeader />
        <div className="relative mx-auto max-w-3xl px-5 pb-16 pt-8 text-center sm:px-6">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-teal">Démonstration gratuite · sans engagement</p>
          <h1 className="mt-4 text-[32px] leading-tight sm:text-5xl">Voyons ensemble ce que GODAC change pour vous</h1>
          <p className="mx-auto mt-5 max-w-2xl text-pretty text-lg font-light text-white/75">
            Laissez vos coordonnées : nous vous rappelons sous un jour ouvré.
          </p>
        </div>
      </div>
      <main className="px-5 py-14 sm:px-6">
        <div className="mx-auto grid max-w-5xl gap-10 lg:grid-cols-[1fr_320px]">
          <DemoRequestForm plan={p.plan ?? null} modules={modules} />
          <aside className="flex flex-col gap-5">
            <ol className="flex flex-col gap-4">
              {ETAPES.map(([t, d], i) => (
                <li key={t} className="flex gap-3">
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-marine text-xs font-semibold text-teal">{i + 1}</span>
                  <div>
                    <p className="font-semibold">{t}</p>
                    <p className="text-sm text-navy/65">{d}</p>
                  </div>
                </li>
              ))}
            </ol>
            <div className="rounded-xl bg-navy/[0.04] p-4 text-sm text-navy/70">
              <p>
                Envie de voir tout de suite ?{" "}
                <Link href="/demo?as=direction" className="font-semibold text-teal-ink hover:underline">
                  Ouvrir la démo en ligne
                </Link>
              </p>
              <p className="mt-2">
                Par e-mail :{" "}
                <a href={`mailto:${EDITEUR.email}`} className="text-teal-ink hover:underline">
                  {EDITEUR.email}
                </a>
              </p>
              <p className="mt-2">
                Tarifs et simulateur :{" "}
                <Link href="/modules" className="text-teal-ink hover:underline">
                  Modules & tarifs
                </Link>
              </p>
            </div>
          </aside>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
