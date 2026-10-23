import { redirect } from "next/navigation";
import Link from "next/link";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { isGodacStaffEmail } from "@/lib/godac-staff/auth";
import { estSchemaManquant } from "@/lib/rattachement/tolerance";
import { PageHeader, Card } from "@/components/ui";
import { RecommandationsEmployeur, type PisteStaff } from "@/components/godac-staff/RecommandationsEmployeur";
import { grouperPistes, type LigneRecommandation, type StatutRecommandation } from "@/lib/recommandation/chaleur";

/**
 * Backoffice GODAC › Recommandations d'employeur : pistes envoyées par les
 * chauffeurs GO, regroupées par entreprise (company_key), pistes chaudes
 * (≥ 2 chauffeurs) d'abord. Même contrôle d'accès que app/godac-staff/page.tsx
 * (GODAC_STAFF_EMAILS) ; lecture hors RLS par le client service.
 */
export default async function RecommandationsPage() {
  const userClient = await createServerSupabaseClient();
  const {
    data: { user },
  } = await userClient.auth.getUser();
  if (!isGodacStaffEmail(user?.email)) redirect("/dashboard");

  const admin = createAdminSupabaseClient();
  const { data, error } = await admin
    .from("employer_referrals")
    .select("id, referrer_user_id, company_name, company_key, contact_name, contact_email, contact_phone, message, consent_at, consent_text, status, staff_notes, created_at, users(full_name)")
    .order("created_at", { ascending: false })
    .limit(1000);

  type Brut = LigneRecommandation & {
    contact_name: string | null;
    contact_email: string | null;
    contact_phone: string | null;
    message: string | null;
    consent_at: string;
    consent_text: string;
    staff_notes: string | null;
    users: { full_name: string | null } | null;
  };
  const pistes: PisteStaff[] = grouperPistes(((error ? [] : data) ?? []) as unknown as Brut[]).map((p) => ({
    companyKey: p.companyKey,
    companyName: p.companyName,
    chauffeurs: p.chauffeurs,
    chaleur: p.chaleur,
    lignes: p.lignes.map((r) => ({
      id: r.id,
      createdAt: r.created_at,
      contactName: r.contact_name,
      contactEmail: r.contact_email,
      contactPhone: r.contact_phone,
      message: r.message,
      consentAt: r.consent_at,
      consentText: r.consent_text,
      status: r.status as StatutRecommandation,
      staffNotes: r.staff_notes,
      recommandePar: r.users?.full_name ?? null,
    })),
  }));

  return (
    <main className="min-h-screen p-6">
      <PageHeader
        title="Recommandations d'employeur"
        description="Entreprises recommandées par les chauffeurs GO, avec leur accord. Deux chauffeurs ou plus pour la même entreprise : piste chaude. Rien n'est envoyé automatiquement aux employeurs."
      />
      <p className="mb-4 text-sm">
        <Link href="/godac-staff" className="text-teal-ink hover:underline">
          ← Backoffice opérateur
        </Link>
      </p>
      {error ? (
        <Card>
          <p className="text-sm text-navy/70">
            {estSchemaManquant(error) ? "Recommandations indisponibles : appliquez la migration 20261103000002_recommandations_employeur.sql." : "Lecture impossible pour le moment."}
          </p>
        </Card>
      ) : (
        <RecommandationsEmployeur pistes={pistes} />
      )}
    </main>
  );
}
