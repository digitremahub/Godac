import { garderApi } from "@/lib/acces/garde-api";
import { NextResponse } from "next/server";
import { journaliser } from "@/lib/audit/journal";
import { randomUUID } from "crypto";
import { z } from "zod";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { calculerTicpe } from "@/lib/ticpe/calcul-serveur";
import { garderBloquants } from "@/lib/ticpe/garde-bloquants";
import { genererRecapPeriode } from "@/lib/ticpe/generation-serveur";
import { estSchemaManquant } from "@/lib/rattachement/tolerance";
import { isModuleEnabled } from "@/lib/organization/modules";

const bodySchema = z
  .object({
    period_start: z.string().date(),
    period_end: z.string().date(),
    /** Nombre de points bloquants que la personne choisit de passer (voir lib/ticpe/bloquants.ts). */
    forcer_malgre_bloquants: z.number().int().min(1).optional(),
  })
  .refine((b) => b.period_start <= b.period_end, { message: "La fin de période précède le début.", path: ["period_end"] });

export const maxDuration = 60;

/**
 * Récapitulatif TICPE d'une période (annexe 3310-TIC) — évolution de
 * l'export du module 7 : gazole uniquement (jamais d'AdBlue), pleins
 * validés, véhicules éligibles à la date du plein (lib/ticpe/eligibilite.ts),
 * taux du barème daté, plafond par véhicule, montant du remboursement.
 * Excel (récapitulatif, véhicules, pleins) et PDF. Les exports déjà
 * générés gardent leur format. Période en jours entiers, heure de Paris. Only
 * comptable/direction can reach this route in practice (RLS on
 * `ticpe_exports` would reject the insert otherwise), but we also
 * check the role up front so the error is immediate and clear.
 */
export async function POST(req: Request) {
  const g = await garderApi({ roles: ["direction", "exploitation", "comptable"], modules: ["ticpe_export"] });
  if (!g.ok) return g.reponse;
  const appUser = g.appUser;
  if (!["comptable", "direction", "exploitation"].includes(appUser.role)) {
    return NextResponse.json({ error: "Rôle non autorisé pour l'export TICPE" }, { status: 403 });
  }

  const parsed = bodySchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const { period_start, period_end, forcer_malgre_bloquants } = parsed.data;

  const supabase = await createServerSupabaseClient();
  const ticpeEnabled = await isModuleEnabled(supabase, appUser.organization_id, "ticpe_export");
  if (!ticpeEnabled) {
    return NextResponse.json({ error: "Module Export TICPE non activé pour votre organisation" }, { status: 403 });
  }

  const { data: organization } = await supabase
    .from("organizations")
    .select("id, name")
    .eq("id", appUser.organization_id)
    .single();
  if (!organization) {
    return NextResponse.json({ error: "Organisation introuvable" }, { status: 409 });
  }

  // Calcul TICPE (barème, éligibilité datée, plafond sur l'année entière)
  // puis récapitulatif 3310-TIC de la période, en jours entiers de Paris.
  const calcul = await calculerTicpe(supabase, organization.id, { anneeDebut: Number(period_start.slice(0, 4)), anneeFin: Number(period_end.slice(0, 4)) });
  if (calcul.tronque) return NextResponse.json({ error: "Trop de pleins sur la période : réduisez-la." }, { status: 413 });
  const garde = await garderBloquants(supabase, organization.id, calcul, { debut: period_start, fin: period_end }, forcer_malgre_bloquants);
  if (garde.reponse) return garde.reponse;
  const { rows, doc, xlsx: workbookBuffer, pdf: pdfBuffer } = await genererRecapPeriode(calcul, organization.name, period_start, period_end, garde.pointsNonResolus);

  const exportId = randomUUID();
  const filePath = `${organization.id}/${exportId}.xlsx`;
  const pdfFilePath = `${organization.id}/${exportId}.pdf`;

  const [{ error: uploadError }, { error: pdfUploadError }] = await Promise.all([
    supabase.storage.from("ticpe-exports").upload(filePath, workbookBuffer, {
      contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    }),
    supabase.storage.from("ticpe-exports").upload(pdfFilePath, pdfBuffer, { contentType: "application/pdf" }),
  ]);
  if (uploadError) {
    return NextResponse.json({ error: `Échec de l'upload: ${uploadError.message}` }, { status: 500 });
  }
  if (pdfUploadError) {
    return NextResponse.json({ error: `Échec de l'upload PDF: ${pdfUploadError.message}` }, { status: 500 });
  }

  const totalLiters = Math.round(rows.reduce((sum, r) => sum + r.totalLiters, 0) * 100) / 100;

  const ligneExport = {
    organization_id: organization.id,
    period_start,
    period_end,
    generated_by: appUser.id,
    file_path: filePath,
    pdf_file_path: pdfFilePath,
    vehicle_count: rows.length,
    total_liters: totalLiters,
  };
  // Colonnes du lot 6 (migration 20261031000005) ; sans elles, l'export reste au format historique.
  let { data: exportRow, error: insertError } = await supabase
    .from("ticpe_exports")
    .insert({ ...ligneExport, document_type: "periode", total_refund: doc.totalMontant, details: { recap: doc.recap, tauxManquants: doc.tauxManquants, pointsNonResolus: garde.pointsNonResolus } })
    .select("id")
    .single();
  const colonnesDocuments = !estSchemaManquant(insertError);
  if (!colonnesDocuments) ({ data: exportRow, error: insertError } = await supabase.from("ticpe_exports").insert(ligneExport).select("id").single());

  if (insertError || !exportRow) {
    await createAdminSupabaseClient().storage.from("ticpe-exports").remove([filePath, pdfFilePath]);
    return NextResponse.json({ error: insertError?.message ?? "Export non enregistré." }, { status: 500 });
  }

  // Export tout-ou-rien : si les lignes ne s'enregistrent pas, l'export et ses fichiers sont retirés.
  const exportId2 = exportRow.id as string;
  const annuler = async () => {
    const admin = createAdminSupabaseClient();
    await admin.from("ticpe_exports").delete().eq("id", exportId2);
    await admin.storage.from("ticpe-exports").remove([filePath, pdfFilePath]);
  };

  if (rows.length > 0) {
    const lignes = rows.map((r) => ({
      export_id: exportId2,
      organization_id: organization.id,
      vehicle_id: r.vehicleId,
      registration: r.registration,
      vehicle_type: r.vehicleType,
      entry_count: r.entryCount,
      computed_total_liters: r.totalLiters,
      computed_total_amount: r.totalAmount,
    }));
    let { error: linesError } = await supabase
      .from("ticpe_export_lines")
      .insert(colonnesDocuments ? lignes.map((l, i) => ({ ...l, refund_amount: rows[i]!.refundAmount, liters_over_cap: rows[i]!.litersOverCap })) : lignes);
    if (colonnesDocuments && estSchemaManquant(linesError)) ({ error: linesError } = await supabase.from("ticpe_export_lines").insert(lignes));
    if (linesError) {
      await annuler();
      return NextResponse.json({ error: `Export annulé : ${linesError.message}` }, { status: 500 });
    }
  }

  const { data: signedUrl } = await supabase.storage.from("ticpe-exports").createSignedUrl(filePath, 300);

  await journaliser({
    organizationId: organization.id,
    userId: appUser.id,
    action: "ticpe_export",
    targetTable: "ticpe_exports",
    targetId: exportId2,
    details: { period_start, period_end, vehicules: rows.length, litres: totalLiters, remboursement: doc.totalMontant },
  });
  if (garde.force) {
    await journaliser({
      organizationId: organization.id,
      userId: appUser.id,
      action: "ticpe_document_force",
      targetTable: "ticpe_exports",
      targetId: exportId2,
      details: { document: "3310-TIC", period_start, period_end, points_bloquants_non_resolus: garde.pointsNonResolus },
    });
  }
  return NextResponse.json({ exportId: exportId2, downloadUrl: signedUrl?.signedUrl });
}
