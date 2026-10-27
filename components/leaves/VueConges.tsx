import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AppUser } from "@/lib/auth/session";
import { findOverlappingLeaves } from "@/lib/business/leave-overlap";
import { PageHeader } from "@/components/ui";
import { LeaveRequestForm } from "@/components/leaves/LeaveRequestForm";
import { LeaveRequestsList } from "@/components/leaves/LeaveRequestsList";
import { soldesConges } from "@/lib/paie/conges-serveur";
import { joursOuvrables } from "@/lib/paie/conges";
import Link from "next/link";
import { urlDe } from "@/lib/acces/catalogue";
import { lireArrets } from "@/lib/arrets/serveur";
import { contexteHierarchie, rolesParId } from "@/lib/hierarchie/serveur";
import { droitsDecision, libelleEnAttente } from "@/lib/hierarchie/demandes";
import { affectationsParConge } from "@/lib/leaves/planning-serveur";

/**
 * Congés : Équipe › Congés (encadrement : décisions sur son service, avec
 * détection de chevauchement) et Mon espace › Mes congés (ses demandes).
 */
export async function VueConges({ appUser, supabase, decision }: { appUser: AppUser; supabase: SupabaseClient; decision: boolean }) {
  const isDecisionMaker = decision;

  const [{ data: myServices }, { data: leaves }] = await Promise.all([
    supabase.from("user_services").select("services(id, name)").eq("user_id", appUser.id),
    supabase
      .from("leave_requests")
      .select("id, driver_id, service_id, start_date, end_date, status, reason, created_at, users!leave_requests_driver_id_fkey(full_name), services(name)")
      .order("start_date", { ascending: false })
      // Mes congés : ses propres demandes, même pour un manager.
      .match(decision ? {} : { driver_id: appUser.id }),
  ]);

  const serviceOptions = (myServices ?? [])
    .map((row: any) => row.services)
    .filter((s: any): s is { id: string; name: string } => Boolean(s));

  // Décision : les demandes à valider d'abord, puis les autres (les plus récentes en tête).
  const rows = ((leaves ?? []) as any[]).sort((a, b) => (decision ? Number(b.status === "pending") - Number(a.status === "pending") : 0));
  const enAttente = rows.filter((r) => r.status === "pending").length;
  const driverNameById = new Map(rows.map((r) => [r.driver_id, r.users?.full_name ?? "—"]));
  const overlapsByLeaveId = new Map<string, string[]>();
  if (isDecisionMaker) {
    for (const leave of rows) {
      if (leave.status !== "pending") continue;
      const sameService = rows.filter((r) => r.service_id === leave.service_id && r.id !== leave.id);
      const overlaps = findOverlappingLeaves(
        { driverId: leave.driver_id, startDate: leave.start_date, endDate: leave.end_date },
        sameService.map((r) => ({ driverId: r.driver_id, startDate: r.start_date, endDate: r.end_date })),
      );
      if (overlaps.length > 0) {
        const names = Array.from(new Set(overlaps.map((o) => driverNameById.get(o.driverId) ?? "—")));
        overlapsByLeaveId.set(leave.id, names);
      }
    }
  }

  // Soldes de congés payés (N-1 / N) : le sien pour le formulaire, ceux
  // des demandeurs pour la décision. Une demande en attente est comparée
  // au solde sans elle (les autres demandes en attente comptent).
  const aujourdhui = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris" }).format(new Date());
  const soldes = await soldesConges(supabase, appUser.organization_id, [appUser.id, ...(isDecisionMaker ? rows.map((r) => r.driver_id as string) : [])], aujourdhui);
  const monSolde = soldes.get(appUser.id) ?? null;
  const soldeLigne = (r: any) => {
    const s = soldes.get(r.driver_id);
    if (!s) return null;
    const jours = joursOuvrables(r.start_date, r.end_date);
    const sansElle = s.disponibleApresAttente + (r.status === "pending" ? jours : 0);
    return { disponible: s.disponible, jours, insuffisant: r.status === "pending" && sansElle - jours < 0 };
  };

  // Hiérarchie des demandes : qui peut décider quoi, et « En attente de … » pour le demandeur.
  const { effectifs, directionCount } = await contexteHierarchie(supabase, appUser.organization_id);
  const roles = await rolesParId(supabase, appUser.organization_id, rows.map((r) => r.driver_id as string));
  const droitsDe = (r: any) =>
    droitsDecision({ moi: { id: appUser.id, role: appUser.role }, demandeur: { id: r.driver_id, role: roles.get(r.driver_id) ?? "chauffeur" }, directionCount });

  // Congés approuvés à venir qui recouvrent des affectations déjà posées au planning (encadrement seulement).
  const touchees = decision ? await affectationsParConge(supabase, appUser.organization_id, rows, aujourdhui) : new Map<string, number>();

  // Arrêts de travail reçus, à vérifier (encadrement) : rappel en tête.
  const arretsRecus = decision ? (await lireArrets(supabase, { limite: 200 })).lignes.filter((a) => a.statut === "recu") : [];
  const rolesArrets = await rolesParId(supabase, appUser.organization_id, arretsRecus.map((a) => a.userId));
  const arretsAVerifier = arretsRecus.filter(
    (a) => droitsDecision({ moi: { id: appUser.id, role: appUser.role }, demandeur: { id: a.userId, role: rolesArrets.get(a.userId) ?? "chauffeur" }, directionCount, paie: appUser.role === "comptable" }).peutDecider,
  ).length;

  return (
    <div>
      <PageHeader
        title={decision ? "Congés & absences" : "Mes congés"}
        description={
          decision
            ? `${enAttente > 0 ? `${enAttente} demande${enAttente > 1 ? "s" : ""} à valider, en tête de liste. ` : "Aucune demande à valider. "}Les chevauchements au sein d'un même service sont signalés.`
            : "Vos demandes de congés et leur statut."
        }
      />

      {!decision && (
        <Link href={`${urlDe("moi.arrets")}?nouveau=1`} className="card mb-4 flex min-h-[48px] items-center justify-between gap-3 !py-3 text-sm hover:border-navy/15">
          <span>
            <span className="font-semibold">En arrêt de travail ?</span> <span className="text-navy/70">Envoyez votre avis d&apos;arrêt (sous 48 h).</span>
          </span>
          <span className="font-semibold text-teal-ink">Déclarer un arrêt →</span>
        </Link>
      )}
      {arretsAVerifier > 0 && (
        <Link href={urlDe("equipe.arrets")} className="card mb-4 flex min-h-[48px] items-center justify-between gap-3 !py-3 text-sm hover:border-navy/15">
          <span className="font-semibold">
            {arretsAVerifier} arrêt{arretsAVerifier > 1 ? "s" : ""} de travail reçu{arretsAVerifier > 1 ? "s" : ""}, à vérifier
          </span>
          <span className="font-semibold text-teal-ink">Voir →</span>
        </Link>
      )}

      {/* Ses propres congés se demandent dans Mon espace ; la direction, qui n'a pas cet écran, garde le formulaire en bas de page. */}
      {!decision && (
        <div className="mb-6">
          <LeaveRequestForm services={serviceOptions} solde={monSolde} />
        </div>
      )}

      <LeaveRequestsList
        leaves={rows.map((r) => ({
          id: r.id,
          driverName: r.users?.full_name ?? "—",
          serviceName: r.services?.name ?? "—",
          startDate: r.start_date,
          endDate: r.end_date,
          status: r.status,
          reason: r.reason,
          isOwn: r.driver_id === appUser.id,
          overlapWith: overlapsByLeaveId.get(r.id) ?? [],
          solde: soldeLigne(r),
          affectationsALiberer: touchees.get(r.id) ?? 0,
          peutDecider: decision ? droitsDe(r).peutDecider : false,
          autoValidee: decision ? droitsDe(r).autoValidee : false,
          mention: decision ? droitsDe(r).mention : null,
          libelleAttente: r.driver_id === appUser.id ? libelleEnAttente(appUser.role, effectifs) : libelleEnAttente(roles.get(r.driver_id) ?? "chauffeur", effectifs),
        }))}
        canDecide={isDecisionMaker}
      />

      {decision && appUser.role === "direction" && (
        <details className="mt-6">
          <summary className="min-h-[44px] cursor-pointer py-2 text-sm font-semibold text-teal-ink">Demander un congé pour moi</summary>
          <div className="mt-3">
            <LeaveRequestForm services={serviceOptions} solde={monSolde} />
          </div>
        </details>
      )}
    </div>
  );
}
