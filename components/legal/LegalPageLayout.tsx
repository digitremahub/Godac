import Link from "next/link";

export function LegalPageLayout({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col gap-6 px-6 py-10">
      <Link href="/" className="flex w-fit items-center gap-2.5">
        <div className="h-8 w-8 rounded-lg bg-teal shadow-[0_2px_12px_-2px_rgba(27,228,193,0.6)]" />
        <span className="font-display text-xl font-extrabold">GODAC</span>
      </Link>
      <h1 className="text-2xl">{title}</h1>
      <div className="flex flex-col gap-4 text-sm leading-relaxed text-navy/70">{children}</div>
      <Link href="/" className="text-sm text-teal-ink hover:underline">
        ← Retour à l&apos;accueil
      </Link>
    </main>
  );
}
