import { requireAppUser } from "@/lib/auth/session";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { PageHeader, Card, EmptyState } from "@/components/ui";
import { ACTIONS_AUDIT, type ActionAudit } from "@/lib/audit/journal";

const PAR_PAGE = 50;
const DATE = new Intl.DateTimeFormat("fr-FR", { timeZone: "Europe/Paris", dateStyle: "short", timeStyle: "short" });

/** Journal des actions sensibles (direction) — exports, corrections, droits, PIN bloqués. */
export default async function JournalAuditPage({ searchParams }: { searchParams: Promise<{ action?: string; page?: string }> }) {
  const appUser = await requireAppUser();
  if (appUser.role !== "direction") return <EmptyState title="Accès réservé" description="Le journal d'audit est réservé à la direction." />;
  const params = await searchParams;
  const action = params.action && params.action in ACTIONS_AUDIT ? (params.action as ActionAudit) : null;
  const page = Math.max(1, Number(params.page) || 1);
  const supabase = await createServerSupabaseClient();
  let q = supabase
    .from("audit_log")
    .select("id, action, target_table, details, created_at, users(full_name)", { count: "exact" })
    .order("created_at", { ascending: false })
    .range((page - 1) * PAR_PAGE, page * PAR_PAGE - 1);
  if (action) q = q.eq("action", action);
  const { data, count } = await q;
  const pages = Math.max(1, Math.ceil((count ?? 0) / PAR_PAGE));
  const lien = (p: number) => `?${new URLSearchParams({ ...(action ? { action } : {}), page: String(p) })}`;

  return (
    <div>
      <PageHeader title="Journal d'audit" description="Actions sensibles de l'entreprise, conservées 3 ans : exports TICPE, corrections, droits d'accès, codes PIN bloqués." />
      <form className="mb-4 flex flex-wrap items-center gap-2 text-sm">
        <select name="action" defaultValue={action ?? ""} className="input !w-auto !py-1.5">
          <option value="">Toutes les actions</option>
          {(Object.keys(ACTIONS_AUDIT) as ActionAudit[]).map((a) => (
            <option key={a} value={a}>
              {ACTIONS_AUDIT[a]}
            </option>
          ))}
        </select>
        <button className="btn-secondary !py-1.5 text-sm">Filtrer</button>
      </form>
      {!data?.length ? (
        <EmptyState title="Aucune action enregistrée" />
      ) : (
        <Card className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead className="text-left text-navy/60">
              <tr>
                <th className="pb-2">Date</th>
                <th className="pb-2">Action</th>
                <th className="pb-2">Par</th>
                <th className="pb-2">Détail</th>
              </tr>
            </thead>
            <tbody>
              {(data as any[]).map((l) => (
                <tr key={l.id} className="border-t border-navy/5 align-top">
                  <td className="py-2 whitespace-nowrap">{DATE.format(new Date(l.created_at))}</td>
                  <td className="py-2">{ACTIONS_AUDIT[l.action as ActionAudit] ?? l.action}</td>
                  <td className="py-2">{l.users?.full_name ?? "Système"}</td>
                  <td className="py-2 text-xs text-navy/65">
                    {l.details
                      ? Object.entries(l.details as Record<string, unknown>)
                          .filter(([, v]) => v !== undefined && v !== null)
                          .map(([k, v]) => `${k} : ${typeof v === "object" ? JSON.stringify(v) : String(v)}`)
                          .join(" · ")
                      : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {pages > 1 && (
            <div className="mt-3 flex items-center justify-between text-sm">
              {page > 1 ? <a href={lien(page - 1)} className="text-teal-ink underline">← Plus récentes</a> : <span />}
              <span className="text-navy/55">Page {page} / {pages}</span>
              {page < pages ? <a href={lien(page + 1)} className="text-teal-ink underline">Plus anciennes →</a> : <span />}
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
