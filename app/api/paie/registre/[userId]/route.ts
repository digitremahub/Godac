import { garderApi } from "@/lib/acces/garde-api";
import { NextResponse } from "next/server";
import { z } from "zod";
import { journaliser } from "@/lib/audit/journal";
import { TYPES_CONTRAT } from "@/lib/registre/personnel";
import { assignDriverCodeFromBirthDate } from "@/lib/users/driver-code-serveur";
import { dateNaissanceValide } from "@/lib/users/date-naissance";

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional();
const texte = (max: number) => z.string().trim().max(max).transform((v) => v || null).nullable().optional();

const bodySchema = z.object({
  last_name: texte(120),
  first_names: texte(160),
  sex: z.enum(["F", "M"]).nullable().optional(),
  role_title: texte(120),
  classification: texte(160),
  birth_date: date,
  hire_date: date,
  exit_date: date,
  contract_type: z.enum(TYPES_CONTRAT).nullable().optional(),
  temp_agency: texte(200),
  register_excluded: z.boolean().optional(),
  nationality: texte(80),
  work_permit_type: texte(120),
  work_permit_number: texte(60),
  work_permit_expiry: date,
});

const MIGRATION = "Les champs du registre ne sont pas encore disponibles (migration 20261026000001 à appliquer).";

/**
 * Fiche du registre unique du personnel d'un salarié (direction) :
 * mentions du dossier RH (employee_files) et données sensibles
 * (employee_register_private : nationalité, titre de travail).
 */
export async function PATCH(req: Request, { params }: { params: Promise<{ userId: string }> }) {
  const g = await garderApi({ ecran: "equipe.registre" });
  if (!g.ok) return g.reponse;
  const { appUser, supabase } = g;
  const { userId } = await params;
  const parsed = bodySchema.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: "Champs du registre invalides." }, { status: 400 });
  const b = parsed.data;
  if (b.birth_date && !dateNaissanceValide(b.birth_date)) return NextResponse.json({ error: "Date de naissance invalide." }, { status: 400 });
  if (b.exit_date && b.hire_date && b.exit_date < b.hire_date) return NextResponse.json({ error: "La date de sortie précède la date d'entrée." }, { status: 400 });

  const { data: salarie } = await supabase.from("users").select("id, full_name").eq("id", userId).eq("organization_id", appUser.organization_id).maybeSingle();
  if (!salarie) return NextResponse.json({ error: "Salarié introuvable." }, { status: 404 });

  const dossier: Record<string, unknown> = { user_id: userId, organization_id: appUser.organization_id };
  for (const k of ["last_name", "first_names", "sex", "classification", "birth_date", "hire_date", "exit_date", "contract_type", "temp_agency", "register_excluded"] as const) {
    if (b[k] !== undefined) dossier[k] = b[k];
  }
  const { error: e1 } = await supabase.from("employee_files").upsert(dossier, { onConflict: "user_id" });
  if (e1) return NextResponse.json({ error: /column|enum|invalid input value/i.test(e1.message) ? MIGRATION : e1.message }, { status: 500 });

  const prive: Record<string, unknown> = { user_id: userId, organization_id: appUser.organization_id };
  for (const k of ["nationality", "work_permit_type", "work_permit_number", "work_permit_expiry"] as const) {
    if (b[k] !== undefined) prive[k] = b[k];
  }
  if (Object.keys(prive).length > 2) {
    const { error: e2 } = await supabase.from("employee_register_private").upsert(prive, { onConflict: "user_id" });
    if (e2) return NextResponse.json({ error: /relation|does not exist|schema cache/i.test(e2.message) ? MIGRATION : e2.message }, { status: 500 });
  }

  if (b.role_title !== undefined) {
    const { error: e3 } = await supabase.from("users").update({ role_title: b.role_title }).eq("id", userId);
    if (e3) return NextResponse.json({ error: e3.message }, { status: 500 });
  }
  // Même effet que le dossier RH : la date de naissance donne le code de secours.
  if (b.birth_date) await assignDriverCodeFromBirthDate(supabase, appUser.organization_id, userId, salarie.full_name, b.birth_date);

  await journaliser({
    organizationId: appUser.organization_id,
    userId: appUser.id,
    action: "registre_personnel_modifie",
    targetTable: "employee_files",
    targetId: userId,
    // Jamais les valeurs (données sensibles) : seulement les champs touchés.
    details: { champs: Object.keys(b).filter((k) => b[k as keyof typeof b] !== undefined) },
  });
  return NextResponse.json({ ok: true });
}
