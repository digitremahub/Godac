import Link from "next/link";
import { Wordmark } from "@/components/brand/Wordmark";

/** Public-site header — sits on the navy hero band of each marketing page. */
export function SiteHeader({ spaceHref }: { spaceHref?: string | null }) {
  return (
    <header className="relative mx-auto flex max-w-6xl items-center justify-between gap-4 px-5 py-5 sm:px-6">
      <Link href="/" className="rounded-lg" aria-label="GODAC — accueil">
        <Wordmark inverted className="text-[26px]" />
      </Link>
      <nav aria-label="Navigation du site" className="flex items-center gap-1 sm:gap-2">
        <Link href="/modules" className="hidden rounded-lg px-3 py-2 text-sm font-medium text-white/75 hover:text-white sm:inline-block">
          Modules & tarifs
        </Link>
        {!spaceHref && (
          <Link href="/sign-in" className="hidden rounded-lg px-3 py-2 text-sm font-medium text-white/75 hover:text-white sm:inline-block">
            Se connecter
          </Link>
        )}
        <Link href={spaceHref ?? "/sign-up"} className="btn-primary !py-2.5">
          {spaceHref ? "Accéder à mon espace" : "Essayer GODAC"}
        </Link>
      </nav>
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer className="border-t border-navy/[0.08] bg-surface">
      <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-5 py-8 text-sm text-navy/65 sm:flex-row sm:px-6">
        <div className="flex flex-col items-center gap-2 sm:flex-row sm:gap-3">
          <Wordmark className="text-lg" />
          <span>© {new Date().getFullYear()} · Gestion et Optimisation Des Assets et Carburant</span>
        </div>
        <nav aria-label="Liens légaux" className="flex gap-5">
          <Link href="/mentions-legales" className="hover:text-navy hover:underline">
            Mentions légales
          </Link>
          <Link href="/cgu" className="hover:text-navy hover:underline">
            CGU
          </Link>
          <Link href="/confidentialite" className="hover:text-navy hover:underline">
            Confidentialité
          </Link>
        </nav>
      </div>
    </footer>
  );
}
