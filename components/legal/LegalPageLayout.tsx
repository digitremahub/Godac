import { Wordmark } from "@/components/brand/Wordmark";
import Link from "next/link";

export function LegalPageLayout({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col gap-6 px-6 py-10">
      <Link href="/" className="w-fit rounded-lg" aria-label="GODAC — accueil">
        <Wordmark height={30} />
      </Link>
      <h1 className="text-2xl">{title}</h1>
      <div className="flex flex-col gap-4 text-sm leading-relaxed text-navy/70">{children}</div>
      <Link href="/" className="text-sm text-teal-ink hover:underline">
        ← Retour à l&apos;accueil
      </Link>
    </main>
  );
}
