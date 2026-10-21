import { garderPage } from "@/lib/acces/garde-page";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { PageHeader, EmptyState, Card } from "@/components/ui";
import { DriverFineActions } from "@/components/fines/DriverFineActions";
import { Commentaires } from "@/components/rattachement/Commentaires";
import { lireCommentaires } from "@/lib/rattachement/commentaires-serveur";
import { estSchemaManquant } from "@/lib/rattachement/tolerance";
import { dateParis, heureParis, montantEuros } from "@/lib/rattachement/format";

const COLONNES = "id, infraction_at, amount, reference, status, notified_at, photo_path, vehicles(registration)";

/**
 * Vue chauffeur (mobile d'abord) : uniquement SES amendes, avec l'avis,
 * les horaires de sa tournée, et la possibilité d'ajouter une explication
 * ou une photo (l'encadrement est notifié).
 */
export default async function MesAmendesPage({ searchParams }: { searchParams: Promise<{ amende?: string }> }) {
  const g = await garderPage("moi.amendes");
  if (!g.ok) return g.ecran;
  const user = g.appUser;
  const { amende: focusId } = await searchParams;
  const supabase = await createServerSupabaseClient();
  // Use service-role only after authenticating; scope strictly to this user and organization.
  const admin = createAdminSupabaseClient();
  const lister = (colonnes: string) =>
    admin.from("fines").select(colonnes).eq("organization_id", user.organization_id).eq("driver_id", user.id).order("infraction_at", { ascending: false }).limit(200);
  let lecture = await lister(`${COLONNES}, document_paths, location, reduced_amount, payment_deadline, planning:planning_entries!fines_planning_entry_id_fkey(tour_number, start_at, end_at)`);
  if (lecture.error && estSchemaManquant(lecture.error)) lecture = await lister(COLONNES);
  const fines = (lecture.data ?? []) as any[];
  const commentaires = await lireCommentaires(supabase, "fine", fines.map((f) => f.id));

  const label: Record<string, string> = {
    pending_identification: "En cours d’identification",
    identified: "À régler",
    contested: "Contestation en cours",
    paid: "Réglée",
    dismissed: "Classée",
  };
  return <div>
    <PageHeader title="Mes amendes" description="Les amendes qui vous sont attribuées, avec l’avis. Ajoutez une explication ou une photo si besoin : votre responsable est prévenu." />
    {fines.length === 0 ? <EmptyState title="Aucune amende attribuée" description="Les amendes qui vous seront attribuées par votre responsable apparaîtront ici." /> :
      <div className="flex flex-col gap-3">{fines.map((f) => {
        const docs = Array.isArray(f.document_paths) && f.document_paths.length ? f.document_paths.length : f.photo_path ? 1 : 0;
        const ouverte = f.status === "identified" || f.status === "contested";
        const echanges = commentaires.get(f.id) ?? [];
        return <div key={f.id} id={`amende-${f.id}`}><Card className={`flex flex-col gap-3 ${focusId === f.id ? "ring-2 ring-teal" : ""}`}>
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div><p className="font-display text-lg font-bold">{f.vehicles?.registration ?? "Véhicule non renseigné"}</p>
            <p className="text-sm text-navy/65">{dateParis(f.infraction_at)} à {heureParis(f.infraction_at)}{f.location ? ` · ${f.location}` : ""}</p></div>
            <span className="badge-neutral">{label[f.status] ?? f.status}</span>
          </div>
          <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
            <span><strong>Montant :</strong> {montantEuros(Number(f.amount))}{f.reduced_amount !== null && f.reduced_amount !== undefined ? ` (minoré ${montantEuros(Number(f.reduced_amount))})` : ""}</span>
            {f.payment_deadline && <span><strong>À régler avant le</strong> {dateParis(f.payment_deadline)}</span>}
            <span><strong>Avis n° :</strong> {f.reference ?? "—"}</span>
          </div>
          {f.planning && <p className="text-sm text-navy/70">Votre tournée{f.planning.tour_number ? ` n°${f.planning.tour_number}` : ""} : de {heureParis(f.planning.start_at)} à {f.planning.end_at ? heureParis(f.planning.end_at) : "—"}</p>}
          {docs > 0 && <div className="flex flex-wrap gap-2">{Array.from({ length: docs }, (_, i) => <a key={i} href={`/api/fines/${f.id}/piece?i=${i}`} target="_blank" rel="noreferrer" className="btn-secondary !py-2 text-sm">📄 Voir l’avis{docs > 1 ? ` ${i + 1}` : ""}</a>)}</div>}
          {f.notified_at && <p className="text-xs text-navy/55">Notification reçue le {dateParis(f.notified_at)}</p>}
          {f.status === "identified" && <DriverFineActions id={f.id} />}
          {(ouverte || echanges.length > 0) && <div className="border-t border-navy/10 pt-3">
            <p className="mb-2 text-sm font-semibold">Votre explication</p>
            <Commentaires api={`/api/fines/${f.id}`} routePiece="piece" commentaires={echanges.map((c) => ({ id: c.id, auteur: c.auteur, auteurId: c.auteurId, texte: c.texte, photos: c.photos, creeLe: c.creeLe }))} moi={user.id} placeholder="Ce qui s’est passé, qui avait le véhicule…" libelleEnvoi="Envoyer à mon responsable" ouvert={ouverte} />
          </div>}
        </Card></div>;
      })}</div>}
  </div>;
}
