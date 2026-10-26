import Link from "next/link";
import { Wordmark } from "@/components/brand/Wordmark";
import { LogoGodacAnime } from "@/components/marketing/AnimationGodac";
import { MenuMobile } from "@/components/marketing/MenuMobile";
import { EDITEUR } from "@/lib/legal/editeur";

const LIEN_NAV = "rounded-lg px-3 py-2 text-sm font-medium text-white/75 transition-colors hover:text-white";

/**
 * En-tête du site public : collant, marine comme le hero de chaque page.
 * Doit être posé AVANT le bloc héros (et non dedans) pour rester collant
 * pendant tout le défilement.
 */
export function SiteHeader({ spaceHref }: { spaceHref?: string | null }) {
  const liens = [
    { href: "/modules", label: "Modules & tarifs" },
    { href: "/#demo", label: "Démo" },
    { href: "/contact", label: "Contact" },
    ...(spaceHref ? [] : [{ href: "/sign-in", label: "Se connecter" }]),
  ];
  return (
    <header className="sticky top-0 z-40 border-b border-white/10 bg-marine/90 text-[#F0F4FF] backdrop-blur-md">
      <div className="relative mx-auto flex max-w-6xl items-center justify-between gap-3 px-5 py-3 sm:px-6">
        <Link href="/" className="rounded-lg" aria-label="GODAC — accueil">
          <Wordmark inverted height={34} />
        </Link>
        <nav aria-label="Navigation du site" className="flex items-center gap-1 sm:gap-2">
          {liens.map((l) => (
            <Link key={l.href} href={l.href} className={`${LIEN_NAV} hidden lg:inline-block`}>
              {l.label}
            </Link>
          ))}
          <Link href={spaceHref ?? "/contact"} aria-label={spaceHref ? "Accéder à mon espace" : "Demander un essai"} className="btn-primary whitespace-nowrap !px-3.5 !py-2.5 sm:!px-4">
            {spaceHref ? "Mon espace" : (
              <>
                <span className="min-[420px]:hidden">Essai</span>
                <span className="hidden min-[420px]:inline">Demander un essai</span>
              </>
            )}
          </Link>
          <MenuMobile liens={liens} />
        </nav>
      </div>
    </header>
  );
}

const COLONNES_PIED = [
  {
    titre: "Le produit",
    liens: [
      { href: "/#ticpe", label: "TICPE et carburant" },
      { href: "/modules", label: "Modules & tarifs" },
      { href: "/#demo", label: "Démo en accès libre" },
      { href: "/sign-in", label: "Se connecter" },
    ],
  },
  {
    titre: "Cadre juridique",
    liens: [
      { href: "/cgv", label: "CGV" },
      { href: "/cgu", label: "CGU" },
      { href: "/confidentialite", label: "Confidentialité" },
      { href: "/dpa", label: "Accord de sous-traitance (DPA)" },
      { href: "/sla", label: "Engagement de service (SLA)" },
      { href: "/mentions-legales", label: "Mentions légales" },
    ],
  },
];

export function SiteFooter() {
  return (
    <footer className="bg-marine text-[#F0F4FF]">
      <div className="mx-auto grid max-w-6xl gap-10 px-5 py-14 sm:px-6 md:grid-cols-[minmax(0,1.4fr)_repeat(3,minmax(0,1fr))]">
        <div className="flex flex-col items-start gap-5">
          <Wordmark inverted height={34} />
          <LogoGodacAnime />
        </div>
        {COLONNES_PIED.map((c) => (
          <nav key={c.titre} aria-label={c.titre}>
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-teal">{c.titre}</p>
            <ul className="mt-4 flex flex-col gap-1">
              {c.liens.map((l) => (
                <li key={l.href}>
                  <Link href={l.href} className="inline-flex min-h-9 items-center rounded text-sm text-white/70 transition-colors hover:text-white hover:underline">
                    {l.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        ))}
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-teal">Contact</p>
          <ul className="mt-4 flex flex-col gap-1">
            <li>
              <Link href="/contact" className="inline-flex min-h-9 items-center rounded text-sm text-white/70 transition-colors hover:text-white hover:underline">
                Demander une démo
              </Link>
            </li>
            <li>
              <a href={`mailto:${EDITEUR.email}`} className="inline-flex min-h-9 items-center break-all rounded text-sm text-white/70 transition-colors hover:text-white hover:underline">
                {EDITEUR.email}
              </a>
            </li>
          </ul>
          <p className="mt-4 text-sm text-white/60">Données hébergées à Paris (France).</p>
        </div>
      </div>
      <div className="border-t border-white/10">
        <p className="mx-auto max-w-6xl px-5 py-5 text-xs text-white/60 sm:px-6">© {new Date().getFullYear()} GODAC · Tous droits réservés</p>
      </div>
    </footer>
  );
}
