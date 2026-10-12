import Link from "next/link";
import { IconCheck } from "@/components/layout/icons";
import { Wordmark } from "@/components/brand/Wordmark";

const POINTS = [
  "Carburant, flotte, entretiens et documents au même endroit",
  "Planning et tournées partagés avec vos chauffeurs",
  "Exports TICPE et fiches de paie prêts pour la comptabilité",
];

// Decorative product glimpse (aria-hidden) — illustrative figures.
const PREVIEW = [
  { label: "Véhicules actifs", value: "42", note: "3 entretiens à prévoir", tone: "text-gold" },
  { label: "Carburant", value: "−12 %", note: "vs mois dernier", tone: "text-teal" },
  { label: "Chauffeurs", value: "18", note: "en tournée", tone: "text-teal" },
];

export function BrandMark({ inverted = false }: { inverted?: boolean }) {
  return <Wordmark inverted={inverted} className="text-2xl" />;
}

/**
 * Sign-in / sign-up / PIN / join shell: brand panel on the left from
 * `lg` up, the form alone (with the logo above it) on smaller screens.
 */
export function AuthLayout({
  children,
  footer,
  linkLogo = true,
}: {
  children: React.ReactNode;
  footer?: React.ReactNode;
  /** The join/PIN flows are reached by QR code, not from the site — no link back. */
  linkLogo?: boolean;
}) {
  return (
    <div className="grid min-h-screen lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
      <aside className="relative hidden overflow-hidden bg-marine text-white lg:flex lg:flex-col lg:justify-between lg:p-12 xl:p-16">
        <div aria-hidden="true" className="pointer-events-none absolute -left-24 top-1/3 h-80 w-80 rounded-full bg-teal/20 blur-3xl" />
        <div aria-hidden="true" className="pointer-events-none absolute -right-20 -top-20 h-72 w-72 rounded-full bg-orange/10 blur-3xl" />
        {linkLogo ? (
          <Link href="/" className="relative w-fit rounded-lg">
            <BrandMark inverted />
          </Link>
        ) : (
          <span className="relative">
            <BrandMark inverted />
          </span>
        )}

        <div className="relative flex flex-col gap-8">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-teal">Le back-office du transport routier</p>
            <p className="mt-4 max-w-md font-display text-3xl font-bold leading-tight xl:text-4xl">
              Moins d&apos;imprévus, plus de routes à parcourir.
            </p>
          </div>
          <ul className="flex flex-col gap-3">
            {POINTS.map((p) => (
              <li key={p} className="flex items-start gap-3 text-[15px] text-white/80">
                <span aria-hidden="true" className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-teal/15 text-teal">
                  <IconCheck className="h-3.5 w-3.5" />
                </span>
                {p}
              </li>
            ))}
          </ul>
          <div aria-hidden="true" className="grid max-w-md grid-cols-3 gap-3">
            {PREVIEW.map((c) => (
              <div key={c.label} className="rounded-xl bg-white/[0.06] p-3.5 ring-1 ring-inset ring-white/10 backdrop-blur">
                <p className="text-[11px] font-medium leading-tight text-white/60">{c.label}</p>
                <p className="mt-2 text-xl font-bold tabular-nums">{c.value}</p>
                <p className={`mt-1 text-[11px] font-semibold ${c.tone}`}>{c.note}</p>
              </div>
            ))}
          </div>
        </div>

        <p className="relative text-xs text-white/60">© {new Date().getFullYear()} GODAC</p>
      </aside>

      <main className="flex flex-col items-center justify-center gap-6 px-5 py-10 sm:px-8">
        <div className="lg:hidden">
          {linkLogo ? (
            <Link href="/" className="rounded-lg">
              <BrandMark />
            </Link>
          ) : (
            <BrandMark />
          )}
        </div>
        <div className="flex w-full max-w-sm flex-col items-stretch gap-6">{children}</div>
        {footer}
      </main>
    </div>
  );
}

export function LegalLinks() {
  return (
    <div className="flex gap-4 text-xs text-navy/60">
      <Link href="/mentions-legales" className="hover:text-navy hover:underline">
        Mentions légales
      </Link>
      <Link href="/cgu" className="hover:text-navy hover:underline">
        CGU
      </Link>
      <Link href="/confidentialite" className="hover:text-navy hover:underline">
        Confidentialité
      </Link>
    </div>
  );
}
