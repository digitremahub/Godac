import { Wordmark } from "@/components/brand/Wordmark";
import Link from "next/link";
import { VERSION_CONTRATS } from "@/lib/legal/editeur";

const DOCUMENTS = [
  { href: "/cgv", label: "Conditions générales de vente" },
  { href: "/cgu", label: "Conditions d'utilisation" },
  { href: "/dpa", label: "Accord de sous-traitance (RGPD)" },
  { href: "/sla", label: "Engagement de service" },
  { href: "/confidentialite", label: "Confidentialité" },
  { href: "/mentions-legales", label: "Mentions légales" },
];

export function LegalPageLayout({ title, children, contractuel = false }: { title: string; children: React.ReactNode; contractuel?: boolean }) {
  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col gap-6 px-6 py-10 print:py-0">
      <Link href="/" className="w-fit rounded-lg print:hidden" aria-label="GODAC — accueil">
        <Wordmark height={30} />
      </Link>
      <div>
        <h1 className="text-2xl">{title}</h1>
        {contractuel && <p className="mt-1 text-xs text-navy/55">Version {VERSION_CONTRATS}</p>}
      </div>
      <div className="legal flex flex-col gap-4 text-sm leading-relaxed text-navy/70">{children}</div>
      <nav aria-label="Documents légaux" className="mt-4 flex flex-wrap gap-x-4 gap-y-2 border-t border-navy/10 pt-4 text-xs print:hidden">
        {DOCUMENTS.filter((d) => d.label !== title).map((d) => (
          <Link key={d.href} href={d.href} className="text-teal-ink hover:underline">
            {d.label}
          </Link>
        ))}
      </nav>
      <Link href="/" className="text-sm text-teal-ink hover:underline print:hidden">
        ← Retour à l&apos;accueil
      </Link>
    </main>
  );
}

/** Article numéroté d'un contrat. */
export function Article({ n, titre, children }: { n: number | string; titre: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-2" id={`article-${n}`}>
      <h2 className="text-base text-navy">
        Article {n} — {titre}
      </h2>
      {children}
    </section>
  );
}

export const listeLegale = "flex list-disc flex-col gap-1 pl-5";
