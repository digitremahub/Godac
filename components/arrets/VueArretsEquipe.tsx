import "server-only";
import Link from "next/link";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AppUser } from "@/lib/auth/session";
import { Card, EmptyState, PageHeader } from "@/components/ui";
import { DeclarerArret } from "@/components/arrets/DeclarerArret";
import { ActionsArret } from "@/components/arrets/ActionsArret";
import { urlDe } from "@/lib/acces/catalogue";
import { estEncadrement, servicesDuPerimetre } from "@/lib/roles/perimetre";
import { parisDay } from "@/lib/utils/paris-time";
import { LIBELLE_STATUT_ARRET, affectationsALiberer, arretsProlongeables, dateCourte, libelleTypeArret, nbJours } from "@/lib/arrets/declaration";
import { affectationsPendantArret, liensDocuments, lireArrets, type AffectationTouchee, type LigneArret } from "@/lib/arrets/serveur";
import { contexteHierarchie, rolesParId } from "@/lib/hierarchie/serveur";
import { droitsDecision } from "@/lib/hierarchie/demandes";

const BADGE: Record<LigneArret["statut"], string> = { recu: "badge-gold", valide: "badge-teal", refuse: "badge-orange" };
const heure = (iso: string) => new Date(iso).toLocaleString("fr-FR", { timeZone: "Europe/Paris", weekday: "short", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

/**
 * Équipe › Congés & absences › Arrêts de travail : arrêts reçus à
 * vérifier (avis joint, valider / refuser), en cours et à venir (tournées
 * à remplacer, « Libérer »), passés ; saisie d'un arrêt pour un salarié.
 * Périmètre : la RLS (manager : ses services ; exploitation, direction,
 * comptable : l'organisation). Les montants d'IJSS restent à la paie.
 */
export async function VueArretsEquipe({ appUser, supabase, modules, arretId }: { appUser: AppUser; supabase: SupabaseClient; modules: ReadonlySet<string>; arretId?: string }) {
  const aujourdhui = parisDay();
  const planningActif = modules.has("planning") && estEncadrement(appUser.role);
  const { lignes, declarationActive, tableActive } = await lireArrets(supabase, { limite: 300 });

  // Salariés du périmètre (saisie directe) et noms.
  let mesServices: string[] = [];
  if (appUser.role === "manager") {
    const { data } = await supabase.from("user_services").select("service_id").eq("user_id", appUser.id);
    mesServices = ((data ?? []) as { service_id: string }[]).map((s) => s.service_id);
  }
  const perimetre = appUser.role === "comptable" ? null : servicesDuPerimetre(appUser.role, mesServices);
  const [{ data: membres }, { data: rattachements }, { data: services }] = await Promise.all([
    supabase.from("users").select("id, full_name, active").eq("organization_id", appUser.organization_id).order("full_name"),
    perimetre ? supabase.from("user_services").select("user_id, service_id").in("service_id", perimetre.length ? perimetre : ["00000000-0000-0000-0000-000000000000"]) : Promise.resolve({ data: null }),
    supabase.from("services").select("id, name"),
  ]);
  const noms = new Map(((membres ?? []) as { id: string; full_name: string }[]).map((u) => [u.id, u.full_name]));
  const nomService = new Map(((services ?? []) as { id: string; name: string }[]).map((s) => [s.id, s.name]));
  const dansPerimetre = perimetre ? new Set(((rattachements ?? []) as { user_id: string }[]).map((r) => r.user_id)) : null;
  const salaries = ((membres ?? []) as { id: string; full_name: string; active: boolean }[])
    .filter((u) => u.active && u.id !== appUser.id && (!dansPerimetre || dansPerimetre.has(u.id)))
    .map((u) => ({ id: u.id, nom: u.full_name }));

  // Hiérarchie des demandes : tous les arrêts visibles, mais décidés seulement par le niveau au-dessus (le sien et ceux des pairs : lecture seule).
  const [{ directionCount }, rolesSalaries] = await Promise.all([contexteHierarchie(supabase, appUser.organization_id), rolesParId(supabase, appUser.organization_id, lignes.map((a) => a.userId))]);
  const droitsDe = (a: LigneArret) =>
    droitsDecision({ moi: { id: appUser.id, role: appUser.role }, demandeur: { id: a.userId, role: rolesSalaries.get(a.userId) ?? "chauffeur" }, directionCount, paie: appUser.role === "comptable" });
  const visibles = lignes;
  const aVerifier = visibles.filter((a) => a.statut === "recu");
  const enCours = visibles.filter((a) => a.statut === "valide" && a.au >= aujourdhui);
  const passes = visibles.filter((a) => a.statut === "refuse" || (a.statut === "valide" && a.au < aujourdhui)).slice(0, 40);

  // Tournées touchées (arrêts non terminés) et liens vers les avis.
  const actifs = [...aVerifier, ...enCours].filter((a) => a.au >= aujourdhui);
  const touchees = new Map<string, AffectationTouchee[]>(
    planningActif ? await Promise.all(actifs.map(async (a) => [a.id, await affectationsPendantArret(supabase, appUser.organization_id, a.userId, a.du, a.au)] as const)) : [],
  );
  const liens = await liensDocuments(supabase, [...aVerifier, ...enCours].flatMap((a) => a.documents));
  const prolongeables = arretsProlongeables(lignes, aujourdhui).map((a) => ({ id: a.id, userId: a.userId, type: a.type, du: a.du, au: a.au }));

  const carte = (a: LigneArret) => {
    const tournees = touchees.get(a.id) ?? [];
    const droits = droitsDe(a);
    const aLiberer = droits.peutDecider ? affectationsALiberer(tournees, a).length : 0;
    const peutDecider = declarationActive && droits.peutDecider;
    return (
      <Card key={a.id} className={`flex flex-col gap-2 !p-4 text-sm ${arretId === a.id ? "ring-2 ring-teal" : ""}`}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="font-semibold">{noms.get(a.userId) ?? "Salarié"}</span>
          <span className={BADGE[a.statut]}>{LIBELLE_STATUT_ARRET[a.statut]}</span>
        </div>
        <span>
          Du {dateCourte(a.du)} au {dateCourte(a.au)} · {nbJours(a.du, a.au)} j · {libelleTypeArret(a.type)}
          {a.extensionOf ? ` · prolongation (initial du ${dateCourte(a.extensionOf)})` : ""}
          {a.serviceId && nomService.get(a.serviceId) ? <span className="text-navy/60"> · {nomService.get(a.serviceId)}</span> : null}
        </span>
        {a.type === "at_mp" && a.statut !== "refuse" && <span className="text-orange-ink">Accident du travail : déclaration employeur (DAT) à faire sous 48 h.</span>}
        {a.statut === "refuse" && a.motifRefus && <span className="text-orange-ink">Motif du refus : {a.motifRefus}</span>}
        {a.documents.length > 0 ? (
          <span className="flex flex-wrap gap-3">
            {a.documents.map((d, i) =>
              liens.get(d) ? (
                <a key={d} href={liens.get(d)} target="_blank" rel="noreferrer" className="text-teal-ink underline">
                  Voir l&apos;avis{a.documents.length > 1 ? ` ${i + 1}` : ""}
                </a>
              ) : null,
            )}
          </span>
        ) : (
          a.statut === "recu" && <span className="text-navy/60">Aucune photo jointe.</span>
        )}
        {planningActif && a.au >= aujourdhui && (
          <div className="rounded-lg bg-navy/[0.04] px-3 py-2">
            {tournees.length === 0 ? (
              <span className="text-navy/70">Aucune tournée planifiée pendant l&apos;arrêt.</span>
            ) : (
              <>
                <span className="font-medium">
                  {tournees.length} tournée{tournees.length > 1 ? "s" : ""} à remplacer :
                </span>
                <ul className="mt-1 flex flex-col gap-0.5">
                  {tournees.slice(0, 8).map((e) => (
                    <li key={e.id}>
                      <Link className="text-teal-ink underline" href={`${urlDe("exploitation.planning")}?entry=${encodeURIComponent(e.id)}`}>
                        {heure(e.start_at)} — tournée n°{e.tour_number ?? "?"}
                      </Link>
                      {e.status === "in_progress" && <span className="text-navy/60"> (en cours)</span>}
                    </li>
                  ))}
                  {tournees.length > 8 && <li className="text-navy/60">… et {tournees.length - 8} autre(s), voir le planning.</li>}
                </ul>
              </>
            )}
          </div>
        )}
        {declarationActive && !droits.peutDecider && a.statut === "recu" && droits.mention && (
          <span className="rounded-lg bg-navy/[0.04] px-3 py-2 text-navy/70" data-testid="mention-hierarchie">
            {droits.mention} : en lecture seule pour vous.
          </span>
        )}
        {peutDecider && droits.autoValidee && a.statut === "recu" && <span className="text-navy/60">Votre propre arrêt : auto-validation (direction unique), tracée au journal.</span>}
        {(peutDecider || aLiberer > 0) && a.statut !== "refuse" && <ActionsArret id={a.id} statut={a.statut} peutDecider={peutDecider} aLiberer={planningActif ? aLiberer : 0} />}
        {peutDecider && a.statut === "refuse" && <ActionsArret id={a.id} statut={a.statut} peutDecider aLiberer={0} />}
      </Card>
    );
  };

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Arrêts de travail"
        description={`${aVerifier.length > 0 ? `${aVerifier.length} arrêt${aVerifier.length > 1 ? "s" : ""} reçu${aVerifier.length > 1 ? "s" : ""} à vérifier. ` : ""}Un arrêt non refusé entre automatiquement dans le bulletin du mois et retire les heures attendues des jours d'arrêt. Les montants d'IJSS se saisissent sur le bulletin.`}
      />
      {!tableActive ? (
        <EmptyState title="Arrêts de travail indisponibles" description="La mise à jour de la base de données est en attente." />
      ) : (
        <>
          {declarationActive && salaries.length > 0 && (
            <DeclarerArret organizationId={appUser.organization_id} moi={appUser.id} salaries={salaries} prolongeables={prolongeables} lectureAuto={modules.has("ocr")} />
          )}
          <section className="flex flex-col gap-2">
            <h2 className="text-base">À vérifier</h2>
            {aVerifier.length === 0 ? <p className="text-sm text-navy/60">Aucun arrêt en attente.</p> : aVerifier.map(carte)}
          </section>
          <section className="flex flex-col gap-2">
            <h2 className="text-base">En cours et à venir</h2>
            {enCours.length === 0 ? <p className="text-sm text-navy/60">Aucun arrêt en cours.</p> : enCours.map(carte)}
          </section>
          <section className="flex flex-col gap-2">
            <h2 className="text-base">Passés et refusés</h2>
            {passes.length === 0 ? <p className="text-sm text-navy/60">Aucun.</p> : passes.map(carte)}
          </section>
        </>
      )}
    </div>
  );
}
