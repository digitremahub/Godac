import { NextResponse } from "next/server";
import { z } from "zod";
import { garderApi } from "@/lib/acces/garde-api";
import { journaliser } from "@/lib/audit/journal";
import { actionAcompte, moisDe, moisDeDeduction, moisLisible, statutAcompte } from "@/lib/paie/acomptes";
import { MESSAGE_TABLE_ABSENTE, tableAcomptesAbsente } from "@/lib/paie/acomptes-serveur";

const dateIso = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const bodySchema = z.object({
  action: z.enum(["annuler", "preparer", "accepter", "refuser", "verser"]),
  montant: z.coerce.number().positive().max(100000).optional().nullable(),
  date_versement: dateIso.optional().nullable(),
  commentaire: z.string().trim().max(2000).optional().nullable(),
});

/**
 * Suite d'une demande d'acompte (lib/paie/acomptes.ts › actionAcompte) :
 * annulation par son auteur, préparation par le comptable, décision par
 * la direction, versement. La base (trigger de garde) refait les mêmes
 * contrôles et écrit qui a décidé et quand ; les alertes partent de la
 * base. Un acompte accepté pour un mois dont le bulletin est déjà validé
 * passe au premier mois suivant non validé.
 */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const g = await garderApi({ roles: "tous", modules: ["payslips"] });
  if (!g.ok) return g.reponse;
  const { appUser, supabase } = g;
  const { id } = await params;
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Requête invalide." }, { status: 400 });
  const { action, montant, date_versement: dateVersement, commentaire } = parsed.data;

  const { data: d, error: lectureError } = await supabase
    .from("salary_advance_requests")
    .select("id, user_id, period, status, amount_requested, amount_granted, paid_at, payslip_id")
    .eq("id", id)
    .eq("organization_id", appUser.organization_id)
    .maybeSingle();
  if (lectureError) {
    if (tableAcomptesAbsente(lectureError)) return NextResponse.json({ error: MESSAGE_TABLE_ABSENTE }, { status: 503 });
    return NextResponse.json({ error: lectureError.message }, { status: 500 });
  }
  if (!d) return NextResponse.json({ error: "Demande introuvable." }, { status: 404 });

  const montantRetenu = montant ?? (d.amount_granted === null ? Number(d.amount_requested) : Number(d.amount_granted));
  const verdict = actionAcompte({
    role: appUser.role,
    estAuteur: d.user_id === appUser.id,
    action,
    statut: statutAcompte(d.status),
    montant: action === "accepter" ? montantRetenu : montant,
    commentaire,
  });
  if (!verdict.ok) return NextResponse.json({ error: verdict.message }, { status: 403 });

  const patch: Record<string, unknown> = {};
  let avertissement: string | null = null;
  if (action === "annuler") patch.status = "annulee";
  if (action === "preparer") {
    if (montant) patch.amount_granted = Math.round(montant * 100) / 100;
    if (dateVersement !== undefined) patch.paid_at = dateVersement;
  }
  if (action === "refuser") {
    patch.status = "refusee";
    patch.decision_comment = commentaire!.trim();
  }
  if (action === "verser") {
    patch.status = "versee";
    patch.paid_at = dateVersement ?? d.paid_at ?? new Date().toISOString().slice(0, 10);
  }
  if (action === "accepter") {
    patch.status = "acceptee";
    patch.amount_granted = Math.round(montantRetenu * 100) / 100;
    if (dateVersement !== undefined) patch.paid_at = dateVersement;
    if (commentaire?.trim()) patch.decision_comment = commentaire.trim();
    // Bulletin du mois déjà validé : jamais modifié, l'acompte passe au mois suivant.
    const mois = moisDe(String(d.period));
    const { data: valides } = await supabase
      .from("payslips")
      .select("period_start")
      .eq("user_id", d.user_id)
      .eq("validation_status", "valide")
      .gte("period_start", `${mois}-01`);
    const deduction = moisDeDeduction(mois, new Set((valides ?? []).map((p) => String(p.period_start).slice(0, 7))));
    if (deduction !== mois) {
      patch.period = `${deduction}-01`;
      patch.original_period = d.period;
      avertissement = `Le bulletin de ${moisLisible(mois)} est déjà validé : l'acompte sera déduit du bulletin de ${moisLisible(deduction)}.`;
    }
  }

  const { error } = await supabase.from("salary_advance_requests").update(patch).eq("id", id);
  if (error) {
    if (tableAcomptesAbsente(error)) return NextResponse.json({ error: MESSAGE_TABLE_ABSENTE }, { status: 503 });
    // Refus du trigger de garde : message en français, lisible tel quel.
    return NextResponse.json({ error: error.message }, { status: error.code === "42501" || error.code === "23514" ? 403 : 500 });
  }

  if (action !== "annuler" || d.user_id !== appUser.id) {
    await journaliser({
      organizationId: appUser.organization_id,
      userId: appUser.id,
      action: "paie_acompte_decision",
      targetTable: "salary_advance_requests",
      targetId: id,
      details: { salarie: d.user_id, action, montant: patch.amount_granted ?? null, mois: String(patch.period ?? d.period).slice(0, 7), par: appUser.role },
    });
  }
  return NextResponse.json({ ok: true, statut: verdict.statut, avertissement });
}
