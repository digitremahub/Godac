import { garderApi } from "@/lib/acces/garde-api";
import { synchroniserGroupesEquipeSansErreur } from "@/lib/messenger/synchro-serveur";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { NextResponse } from "next/server";
import { journaliser } from "@/lib/audit/journal";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { assignDriverCodeFromBirthDate } from "@/lib/users/driver-code-serveur";
import { creerCodeActivation, revoquerSessions } from "@/lib/auth/code-activation-serveur";
import { verifierModificationParExploitation } from "@/lib/roles/perimetre";

const bodySchema = z.object({
  role: z.enum(["chauffeur", "manager", "exploitation", "comptable", "direction"]).optional(),
  role_title: z.string().nullable().optional(),
  // Manager qui conduit aussi (planning, tournées, pleins, app Livreur,
  // badge + PIN) — migration 20261021000002.
  can_drive: z.boolean().optional(),
  active: z.boolean().optional(),
  full_name: z.string().min(1).optional(),
  email: z.string().trim().email().optional(),
  phone: z.string().trim().max(40).nullable().optional(),
  address: z.string().trim().max(300).nullable().optional(),
  contact_email: z.string().trim().email().max(254).nullable().optional(),
  service_id: z.string().uuid().nullable().optional(),
  // Richer replacement for service_id above — several qualified
  // services per driver, each with its own status (titulaire/
  // formation/remplacement). Sent by DriverServicesPanel; service_id
  // stays for the admin table's quick single-service edit. Only one
  // of the two is expected per request.
  services: z
    .array(z.object({ service_id: z.string().uuid(), status: z.enum(["titulaire", "formation", "remplacement"]) }))
    .optional(),
  // Lot 7: forgets their PIN → direction clears it, next badge scan
  // offers "créez votre code" again instead of "entrez votre code".
  reset_pin: z.boolean().optional(),
  // Données du contrat, lues par la direction — le taux horaire s'en
  // déduit (lib/business/payroll.ts), voir /equipe/paie/heures.
  monthly_gross_salary: z.number().min(0).max(999999.99).nullable().optional(),
  monthly_net_salary: z.number().min(0).max(999999.99).nullable().optional(),
  contractual_monthly_hours: z.number().positive().max(999.99).optional(),
  // Dossier RH (employee_files) — profil complet visible direction
  // uniquement, voir app/(dashboard)/admin/users/[id]/page.tsx.
  // hr_status n'accepte que 'active'/'suspended'/'terminated' ici :
  // 'on_leave' est dérivé par compute_hr_status() à partir des congés
  // approuvés, jamais saisi à la main (voir 20260101000017).
  contract_type: z.enum(["cdi", "cdd", "interim", "apprentissage"]).nullable().optional(),
  hire_date: z.string().nullable().optional(),
  contract_end_date: z.string().nullable().optional(),
  hr_status: z.enum(["active", "suspended", "terminated"]).optional(),
  hr_notes: z.string().nullable().optional(),
  // Déclenche le recalcul du code de secours (users.driver_code) en
  // "initiales + mois/année" dès qu'elle est renseignée — voir
  // assignDriverCodeFromBirthDate ci-dessous.
  birth_date: z.string().nullable().optional(),
  // Identité complète affichée sur la fiche de paie (voir
  // lib/payslips/generate-pdf.tsx) — même périmètre direction-only que
  // le reste du dossier RH ci-dessus.
  matricule: z.string().trim().min(1).nullable().optional(),
  social_security_number: z.string().trim().min(1).nullable().optional(),
  classification: z.string().trim().min(1).nullable().optional(),
});


/**
 * Role changes are a plain update to `public.users.role` — nothing
 * external to keep in sync now that GODAC's 5 roles live only in our
 * own table (see supabase/migrations/20260101000002_core_tables.sql).
 */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const g = await garderApi({ roles: "tous" });
  if (!g.ok) return g.reponse;
  const appUser = g.appUser;
  const parsed = bodySchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const contactOnly = ["phone", "address", "contact_email"].some((key) => Object.prototype.hasOwnProperty.call(parsed.data, key))
    && Object.keys(parsed.data).every((key) => ["phone", "address", "contact_email"].includes(key));
  const estDirection = appUser.role === "direction";
  // Exploitation : gère les comptes chauffeur et manager (rôle chauffeur ↔
  // manager, activation, services, conduite, PIN, contact), jamais ceux de
  // la direction, du comptable ou de l'exploitation, ni salaire / contrat /
  // dossier RH (lib/roles/perimetre.ts).
  const estExploitation = appUser.role === "exploitation";
  if (!estDirection && !estExploitation && !contactOnly) {
    return NextResponse.json({ error: "Seule la direction peut modifier les rôles et les données administratives." }, { status: 403 });
  }

  const supabase = await createServerSupabaseClient();
  if (estExploitation) {
    const { data: target, error: targetError } = await supabase
      .from("users").select("id, organization_id, role").eq("id", id).eq("organization_id", appUser.organization_id).maybeSingle();
    if (targetError || !target) return NextResponse.json({ error: "Utilisateur introuvable dans votre organisation." }, { status: 404 });
    const verdict = verifierModificationParExploitation(target.role, Object.keys(parsed.data), parsed.data.role);
    if (!verdict.ok) return NextResponse.json({ error: verdict.error }, { status: verdict.status });
    // Services choisis : uniquement ceux de l'organisation (l'écriture se
    // fait ensuite par le client admin).
    const demandes = [...new Set([...(parsed.data.services ?? []).map((x) => x.service_id), ...(parsed.data.service_id ? [parsed.data.service_id] : [])])];
    if (demandes.length > 0) {
      const { data: connus } = await supabase.from("services").select("id").eq("organization_id", appUser.organization_id).in("id", demandes);
      if ((connus ?? []).length !== demandes.length) return NextResponse.json({ error: "Service inconnu dans votre organisation." }, { status: 400 });
    }
  } else if (!estDirection) {
    const { data: target, error: targetError } = await supabase
      .from("users").select("id, organization_id, role").eq("id", id).eq("organization_id", appUser.organization_id).maybeSingle();
    if (targetError || !target) return NextResponse.json({ error: "Utilisateur introuvable dans votre organisation." }, { status: 404 });
    if (target.role !== "chauffeur") return NextResponse.json({ error: "Modification réservée aux chauffeurs." }, { status: 403 });
    const { data: managedServices, error: servicesError } = await supabase
      .from("user_services").select("service_id").eq("user_id", appUser.id);
    if (servicesError) return NextResponse.json({ error: servicesError.message }, { status: 500 });
    const { data: targetServices, error: targetServicesError } = await supabase
      .from("user_services").select("service_id").eq("user_id", id);
    if (targetServicesError) return NextResponse.json({ error: targetServicesError.message }, { status: 500 });
    const scopes = new Set((managedServices ?? []).map((row) => row.service_id));
    if (!(targetServices ?? []).some((row) => scopes.has(row.service_id))) {
      return NextResponse.json({ error: "Ce chauffeur n'appartient pas à vos services." }, { status: 403 });
    }
  }

  // Guard against locking an organisation out of its own admin
  // panel: since only `direction` can change roles or deactivate
  // accounts, demoting or deactivating the last `direction` account
  // (including your own) would leave nobody able to undo it from the UI.
  const demotesOrDeactivates = (parsed.data.role && parsed.data.role !== "direction") || parsed.data.active === false;
  if (demotesOrDeactivates) {
    const { data: target } = await supabase.from("users").select("role").eq("id", id).single();
    if (target?.role === "direction") {
      const { count } = await supabase
        .from("users")
        .select("id", { count: "exact", head: true })
        .eq("organization_id", appUser.organization_id)
        .eq("role", "direction")
        .eq("active", true);
      if ((count ?? 0) <= 1) {
        return NextResponse.json(
          { error: "Impossible de retirer ou désactiver le dernier compte direction de l'organisation." },
          { status: 409 },
        );
      }
    }
  }

  const {
    service_id,
    services,
    reset_pin,
    monthly_gross_salary,
    monthly_net_salary,
    contractual_monthly_hours,
    contract_type,
    hire_date,
    contract_end_date,
    hr_status,
    hr_notes,
    birth_date,
    matricule,
    social_security_number,
    classification,
    ...userFields
  } = parsed.data;
  const { email, ...ordinaryUserFields } = userFields;
  const updateFields: Record<string, unknown> = { ...ordinaryUserFields };

  // « Passer manager » un chauffeur : il garde la conduite (planning,
  // tournées, badge + PIN) sauf si la direction décoche explicitement.
  if ((parsed.data.role === "manager" || parsed.data.role === "exploitation") && parsed.data.can_drive === undefined) {
    const { data: avant } = await supabase.from("users").select("role").eq("id", id).maybeSingle();
    if (avant?.role === "chauffeur") updateFields.can_drive = true;
  }
  /** E-mail Auth avant modification, pour compenser si l'écriture dans `users` échoue. */
  let emailAuthAncien: string | null = null;

  if (email !== undefined) {
    const { data: target, error: targetError } = await supabase
      .from("users")
      .select("id, organization_id, email, auth_method, role")
      .eq("id", id)
      .single();
    if (targetError || !target || target.organization_id !== appUser.organization_id) {
      return NextResponse.json({ error: "Utilisateur introuvable dans votre organisation." }, { status: 404 });
    }
    if (target.auth_method === "pin") {
      return NextResponse.json({ error: "Ce compte utilise un badge + PIN ; l'email de connexion ne se modifie pas depuis cette fiche." }, { status: 409 });
    }
    // Changer l'e-mail de connexion d'un autre compte direction permettrait
    // d'en prendre le contrôle : refusé (chacun le change depuis son compte).
    if (target.role === "direction" && id !== appUser.id) {
      return NextResponse.json({ error: "L'e-mail de connexion d'un compte direction ne se modifie que par son titulaire." }, { status: 403 });
    }
    const normalizedEmail = email.trim().toLowerCase();
    if (normalizedEmail !== String(target.email ?? "").toLowerCase()) {
      const admin = createAdminSupabaseClient();
      const { data: authUser } = await admin.auth.admin.getUserById(id);
      const { error: authError } = await admin.auth.admin.updateUserById(id, { email: normalizedEmail, email_confirm: false });
      if (authError) return NextResponse.json({ error: `Mise à jour de l'email de connexion impossible : ${authError.message}` }, { status: 400 });
      emailAuthAncien = authUser?.user?.email ?? target.email ?? null;
      updateFields.email = normalizedEmail;
    }
  }

  if (reset_pin) {
    const { data: target } = await supabase.from("users").select("auth_method").eq("id", id).single();
    if (target?.auth_method !== "pin") {
      return NextResponse.json({ error: "Ce compte ne se connecte pas par code PIN." }, { status: 409 });
    }
    updateFields.pin_set_at = null;
    updateFields.driver_recovery_code_hash = null;
  }

  // PIN réinitialisé : code d'activation à remettre au chauffeur (exigé
  // pour choisir le nouveau PIN depuis le badge) et sessions fermées.
  // Créé AVANT d'effacer pin_set_at, pour qu'il n'existe aucune fenêtre où
  // le badge seul suffirait.
  let activationCode: string | null = null;
  if (reset_pin) {
    const admin = createAdminSupabaseClient();
    try {
      activationCode = await creerCodeActivation(admin, { userId: id, organizationId: appUser.organization_id, createdBy: appUser.id });
      await revoquerSessions(admin, id);
    } catch (e) {
      return NextResponse.json({ error: e instanceof Error ? e.message : "Réinitialisation incomplète." }, { status: 500 });
    }
  }

  let targetUser: { id: string; role: string } | null = null;
  if (Object.keys(updateFields).length > 0) {
    // Manager en mode « contact seulement » : la RLS de `users` ne lui
    // permet pas d'écrire la fiche d'un chauffeur. Le périmètre (même
    // organisation, chauffeur de ses services, seuls téléphone/adresse/
    // e-mail de contact) est contrôlé plus haut : écriture par le client
    // admin, limitée à l'organisation.
    // Exploitation : même schéma (la RLS de `users` et la garde
    // users_guard_self_update réservent ces écritures à la direction) ; le
    // périmètre a été contrôlé plus haut (verifierModificationParExploitation).
    const ecrivain = estDirection ? supabase : createAdminSupabaseClient();
    const { data, error } = await ecrivain
      .from("users")
      .update(updateFields)
      .eq("id", id)
      .eq("organization_id", appUser.organization_id)
      .select("id, role, role_title")
      .single();
    if (error) {
      if (emailAuthAncien) {
        // Compensation : l'e-mail Auth a déjà changé, on le rétablit.
        const { error: retourError } = await createAdminSupabaseClient().auth.admin.updateUserById(id, { email: emailAuthAncien, email_confirm: true });
        if (retourError) console.error("compensation e-mail Auth impossible", id, retourError.message);
      }
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    targetUser = data;
  }

  // « user_services: direction manages » : l'exploitation écrit les
  // rattachements par le client admin, après le contrôle ci-dessus.
  const ecrivainServices = estDirection ? supabase : createAdminSupabaseClient();
  if (services !== undefined) {
    // Full replace: a driver qualified on several services, each with
    // its own status (titulaire/formation/remplacement) — see
    // DriverServicesPanel.
    const { error: clearError } = await ecrivainServices.from("user_services").delete().eq("user_id", id);
    if (clearError) return NextResponse.json({ error: clearError.message }, { status: 500 });
    if (services.length > 0) {
      const { error: insertError } = await ecrivainServices
        .from("user_services")
        .insert(services.map((s) => ({ user_id: id, service_id: s.service_id, status: s.status })));
      if (insertError) return NextResponse.json({ error: insertError.message }, { status: 500 });
    }
  } else if (service_id !== undefined) {
    // A user has at most one service through the admin table's quick
    // edit — replace rather than accumulate rows in the underlying
    // many-to-many table.
    const { error: clearError } = await ecrivainServices.from("user_services").delete().eq("user_id", id);
    if (clearError) return NextResponse.json({ error: clearError.message }, { status: 500 });
    if (service_id) {
      const { error: linkError } = await ecrivainServices.from("user_services").insert({ user_id: id, service_id });
      if (linkError) return NextResponse.json({ error: linkError.message }, { status: 500 });
    }
  }

  if (monthly_gross_salary !== undefined || monthly_net_salary !== undefined || contractual_monthly_hours !== undefined) {
    // Separate table (user_contracts), not `users` — RLS on `users`
    // lets any org member read any row (legitimate for a name/phone/
    // role, not for a salary); see 20260101000077.
    const contractFields: Record<string, unknown> = { user_id: id, updated_at: new Date().toISOString() };
    if (monthly_gross_salary !== undefined) contractFields.monthly_gross_salary = monthly_gross_salary;
    if (monthly_net_salary !== undefined) contractFields.monthly_net_salary = monthly_net_salary;
    if (contractual_monthly_hours !== undefined) contractFields.contractual_monthly_hours = contractual_monthly_hours;
    const { error: contractError } = await supabase.from("user_contracts").upsert(contractFields, { onConflict: "user_id" });
    if (contractError) return NextResponse.json({ error: contractError.message }, { status: 500 });
  }

  if (
    contract_type !== undefined ||
    hire_date !== undefined ||
    contract_end_date !== undefined ||
    hr_status !== undefined ||
    hr_notes !== undefined ||
    birth_date !== undefined ||
    matricule !== undefined ||
    social_security_number !== undefined ||
    classification !== undefined
  ) {
    const employeeFileFields: Record<string, unknown> = { organization_id: appUser.organization_id, user_id: id };
    if (contract_type !== undefined) employeeFileFields.contract_type = contract_type;
    if (hire_date !== undefined) employeeFileFields.hire_date = hire_date;
    if (contract_end_date !== undefined) employeeFileFields.contract_end_date = contract_end_date;
    if (hr_status !== undefined) employeeFileFields.hr_status = hr_status;
    if (hr_notes !== undefined) employeeFileFields.notes = hr_notes;
    if (birth_date !== undefined) employeeFileFields.birth_date = birth_date;
    if (matricule !== undefined) employeeFileFields.matricule = matricule;
    if (social_security_number !== undefined) employeeFileFields.social_security_number = social_security_number;
    if (classification !== undefined) employeeFileFields.classification = classification;
    const { error: employeeFileError } = await supabase.from("employee_files").upsert(employeeFileFields, { onConflict: "user_id" });
    if (employeeFileError) return NextResponse.json({ error: employeeFileError.message }, { status: 500 });

    if (birth_date) {
      // full_name peut venir d'être changé dans la même requête (userFields.full_name)
      // ou être simplement celui déjà en base — toujours relu pour éviter de se fier à
      // un `targetUser` dont le select ne porte pas forcément sur full_name.
      const { data: userRow } = await supabase.from("users").select("full_name").eq("id", id).single();
      if (userRow?.full_name) await assignDriverCodeFromBirthDate(supabase, appUser.organization_id, id, userRow.full_name, birth_date);
    }
  }

  if (parsed.data.role !== undefined || parsed.data.active !== undefined || reset_pin) {
    await journaliser({
      organizationId: appUser.organization_id,
      userId: appUser.id,
      action: reset_pin ? "pin_reinitialise" : parsed.data.role !== undefined ? "role_modifie" : "utilisateur_desactive",
      targetTable: "users",
      targetId: id,
      details: { role: parsed.data.role, active: parsed.data.active, reset_pin: reset_pin || undefined },
    });
  }
  await synchroniserGroupesEquipeSansErreur(createAdminSupabaseClient(), appUser.organization_id);
  return NextResponse.json({ user: targetUser ?? { id }, ...(activationCode ? { activationCode } : {}) });
}
