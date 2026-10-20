import { garderPage } from "@/lib/acces/garde-page";
import Link from "next/link";
import { isPlatformAdmin } from "@/lib/auth/platform";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { PageHeader, Card, EmptyState } from "@/components/ui";
import type { UserRole } from "@/lib/types/domain";

export default async function FaqPage() {
  const g = await garderPage("aide.faq");
  if (!g.ok) return g.ecran;
  const appUser = g.appUser;
  const supabase = await createServerSupabaseClient();
  const [{ data: rows }, platformAdmin] = await Promise.all([
    supabase.from("assistant_faq").select("id, question, answer, roles, asked_count").eq("status", "published").order("asked_count", { ascending: false }),
    isPlatformAdmin(appUser.id),
  ]);
  const entries = (rows ?? []).filter((r) => (r.roles as UserRole[]).length === 0 || (r.roles as UserRole[]).includes(appUser.role));

  return (
    <div>
      <PageHeader
        title="Questions fréquentes"
        description="Les réponses aux questions les plus posées par les équipes qui utilisent GODAC."
        actions={
          platformAdmin ? (
            <Link href="/admin/faq" className="btn-secondary !py-2 text-sm">
              Gérer la FAQ
            </Link>
          ) : undefined
        }
      />
      {entries.length === 0 ? (
        <EmptyState title="Pas encore de questions fréquentes" description="Posez votre question à l'assistant : les plus fréquentes apparaîtront ici." />
      ) : (
        <Card className="!p-0">
          <ul className="divide-y divide-navy/[0.07]">
            {entries.map((e) => (
              <li key={e.id}>
                <details className="group px-4 py-3.5 sm:px-5">
                  <summary className="flex cursor-pointer list-none items-start justify-between gap-3 font-semibold">
                    {e.question}
                    <span aria-hidden="true" className="mt-0.5 shrink-0 text-navy/50 transition-transform group-open:rotate-45">
                      +
                    </span>
                  </summary>
                  <p className="mt-2 whitespace-pre-line text-sm leading-relaxed text-navy/75">{e.answer}</p>
                </details>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
