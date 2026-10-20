import { garderPage } from "@/lib/acces/garde-page";
import Link from "next/link";
import { notFound } from "next/navigation";
import { BadgeValidation, ValidationBulletins } from "@/components/paie/ValidationBulletins";
import { paieIndisponible, paysOrganisation } from "@/lib/pays/serveur";
import { Card, PageHeader, EmptyState } from "@/components/ui";
import { contextePaie, moisValide } from "@/lib/paie/donnees";
import { currentMonth } from "@/lib/planning/dates";
import { PaieEditor } from "@/components/paie/PaieEditor";
import { fusionnerRetenues } from "@/lib/paie/acomptes";

export default async function PaieSalariePage({ params, searchParams }: { params: Promise<{ userId: string }>; searchParams: Promise<{ mois?: string }> }) {
  const g = await garderPage("equipe.paie_salarie");
  if (!g.ok) return g.ecran;
  const { appUser, supabase } = g;
  const direction = appUser.role === "direction";
  const pays = await paysOrganisation(supabase, appUser.organization_id);
  if (!pays.paie.moteur) return <EmptyState title={`Paie : ${pays.drapeau} ${pays.nom}`} description={paieIndisponible(pays)} />;
  const { userId } = await params;
  const sp = await searchParams;
  const mois = moisValide(sp.mois) ? sp.mois : currentMonth();

  const { data: salarie } = await supabase.from("users").select("id, full_name, role_title").eq("id", userId).eq("organization_id", appUser.organization_id).maybeSingle();
  if (!salarie) notFound();

  const ctx = await contextePaie(supabase, appUser.organization_id, userId, mois);
  const label = new Date(`${ctx.debut}T12:00:00Z`).toLocaleDateString("fr-FR", { month: "long", year: "numeric", timeZone: "UTC" });
  const { joursTravailles, ...prefill } = ctx.prefill;
  // Un bulletin déjà généré ce mois-ci : on reprend ses variables.
  // Les acomptes acceptés sont toujours relus en base (ajoutés, retirés ou reportés).
  const variables = ctx.bulletinExistant?.variables
    ? { ...prefill, ...ctx.bulletinExistant.variables, retenues: fusionnerRetenues(ctx.bulletinExistant.variables.retenues, ctx.acomptes.retenues) }
    : prefill;

  return (
    <div>
      <PageHeader
        title={`${salarie.full_name} — ${label}`}
        description={salarie.role_title ?? undefined}
        actions={
          <Link href={`/equipe/paie?mois=${mois}`} className="btn-secondary !py-2 text-sm">
            ← Tous les salariés
          </Link>
        }
      />
      {ctx.bulletinExistant && (
        <Card className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex flex-col gap-1 text-sm">
            <span className="flex flex-wrap items-center gap-2">
              Bulletin du mois : <BadgeValidation statut={ctx.bulletinExistant.validation} />
            </span>
            {ctx.bulletinExistant.validation === "refuse" && ctx.bulletinExistant.commentaire && (
              <span className="text-orange-ink">Motif du refus : {ctx.bulletinExistant.commentaire}</span>
            )}
            {ctx.bulletinExistant.validation === "en_attente" && (
              <span className="text-navy/60">Invisible pour le salarié tant que la direction ne l&apos;a pas validé.</span>
            )}
            {ctx.bulletinExistant.validation === "valide" && ctx.bulletinExistant.valideLe && (
              <span className="text-navy/60">
                Validé le {new Date(ctx.bulletinExistant.valideLe).toLocaleString("fr-FR", { timeZone: "Europe/Paris", dateStyle: "short", timeStyle: "short" })}. Une
                régénération le repasse en attente.
              </span>
            )}
          </div>
          {direction && ctx.bulletinExistant.validation !== "valide" && <ValidationBulletins ids={[ctx.bulletinExistant.id]} compact />}
        </Card>
      )}
      <PaieEditor
        peutModifierProfil={direction}
        key={`${userId}-${mois}`}
        userId={userId}
        mois={mois}
        legal={ctx.legal}
        entreprise={ctx.entreprise}
        profil={ctx.salarie}
        coefficient={ctx.coefficient}
        profilComplet={ctx.profilComplet}
        prefill={variables}
        joursTravailles={joursTravailles}
        dejaGenere={Boolean(ctx.bulletinExistant)}
        avertissementsAcomptes={ctx.acomptes.avertissements}
      />
    </div>
  );
}
