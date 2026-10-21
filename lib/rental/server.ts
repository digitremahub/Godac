import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AppUser } from "@/lib/auth/session";
import { sendTransactionalEmail } from "@/lib/email/resend";
import { getVehicleLatestKmReading } from "@/lib/vehicles/odometer-reference";
import { renderProviderRequestEmail } from "@/lib/rental/email";
import { generateProviderToken, hashProviderToken, SIGNED_LINK_SECONDS, tokenExpiry } from "@/lib/rental/token";
import { nextStatusAfterManager, type RentalRequestStatus } from "@/lib/rental/workflow";

export const MANAGER_ROLES = ["manager", "exploitation", "direction"] as const;

export function appBaseUrl(): string {
  return (process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
}

export async function addRentalEvent(
  client: SupabaseClient,
  e: {
    organization_id: string;
    request_id: string;
    actor_kind: "utilisateur" | "prestataire" | "systeme";
    actor_user_id?: string | null;
    action: string;
    status_from?: string | null;
    status_to?: string | null;
    comment?: string | null;
  },
): Promise<void> {
  await client.from("rental_request_events").insert({ actor_user_id: null, status_from: null, status_to: null, comment: null, ...e });
}

export interface TransmitResult {
  status: RentalRequestStatus;
  emailSent: boolean;
  reason?: string;
  providerLink: string;
  expiresAt: string;
}

/**
 * Génère un nouveau lien prestataire (le précédent est révoqué : seul le
 * dernier hash est conservé), envoie l'e-mail au loueur et fait passer
 * la demande « validée » à « transmise ». Appelé avec le client de
 * l'utilisateur : la RLS (manager-like de l'organisation) s'applique.
 */
export async function transmitRentalRequest(supabase: SupabaseClient, appUser: AppUser, requestId: string): Promise<TransmitResult | { error: string; httpStatus: number }> {
  const { data: req } = await supabase
    .from("rental_maintenance_requests")
    .select(
      "id, organization_id, status, vehicle_id, intervention_id, rental_providers(name, maintenance_emails, active), vehicles(registration, brand, model, rental_contract_ref), vehicle_interventions(type, description, urgency, photo_paths, created_at)",
    )
    .eq("id", requestId)
    .maybeSingle();
  if (!req) return { error: "Demande introuvable.", httpStatus: 404 };
  const r = req as any;
  const status = r.status as RentalRequestStatus;
  const provider = r.rental_providers;
  if (!provider) return { error: "Aucun loueur / prestataire rattaché à ce véhicule.", httpStatus: 400 };

  const now = new Date();
  const token = generateProviderToken();
  const expiresAt = tokenExpiry(now).toISOString();
  const providerLink = `${appBaseUrl()}/prestataire/${token}`;

  const [{ data: org }, km, photoUrls] = await Promise.all([
    supabase.from("organizations").select("name, is_demo").eq("id", r.organization_id).single(),
    getVehicleLatestKmReading(supabase, r.vehicle_id),
    Promise.all(
      ((r.vehicle_interventions?.photo_paths ?? []) as string[]).map(
        async (p) => (await supabase.storage.from("intervention-photos").createSignedUrl(p, SIGNED_LINK_SECONDS)).data?.signedUrl ?? null,
      ),
    ),
  ]);

  const recipients = ((provider.maintenance_emails ?? []) as string[]).filter(Boolean);
  let emailSent = false;
  let reason: string | undefined;
  if (org?.is_demo) {
    reason = "Organisation de démonstration : aucun e-mail n'est envoyé.";
  } else if (recipients.length === 0) {
    reason = "Aucune adresse e-mail renseignée pour ce prestataire : transmettez le lien vous-même.";
  } else {
    const { subject, html } = renderProviderRequestEmail({
      organizationName: org?.name ?? "GODAC",
      providerName: provider.name,
      registration: r.vehicles?.registration ?? "—",
      vehicleModel: [r.vehicles?.brand, r.vehicles?.model].filter(Boolean).join(" ") || null,
      currentKm: km?.km ?? null,
      contractRef: r.vehicles?.rental_contract_ref ?? null,
      requestType: r.vehicle_interventions?.type ?? "Entretien",
      urgency: r.vehicle_interventions?.urgency ?? "normal",
      description: r.vehicle_interventions?.description ?? null,
      createdAt: r.vehicle_interventions?.created_at ?? now.toISOString(),
      photoUrls: photoUrls.filter((u): u is string => Boolean(u)),
      contactName: appUser.full_name,
      contactEmail: appUser.email ?? null,
      contactPhone: appUser.phone ?? null,
      providerLink,
      linkExpiresAt: expiresAt,
    });
    const result = await sendTransactionalEmail({ to: recipients, subject, html });
    emailSent = result.sent;
    reason = result.reason;
  }

  const next = nextStatusAfterManager(status, "transmettre", emailSent) ?? status;
  const { error } = await supabase
    .from("rental_maintenance_requests")
    .update({
      token_hash: hashProviderToken(token),
      token_expires_at: expiresAt,
      status: next,
      updated_at: now.toISOString(),
      ...(emailSent ? { transmitted_by: appUser.id, transmitted_at: now.toISOString(), transmitted_to: recipients } : {}),
    })
    .eq("id", requestId);
  if (error) return { error: error.message, httpStatus: 500 };

  await addRentalEvent(supabase, {
    organization_id: r.organization_id,
    request_id: requestId,
    actor_kind: "utilisateur",
    actor_user_id: appUser.id,
    action: "transmettre",
    status_from: status,
    status_to: next,
    comment: emailSent ? `E-mail envoyé à ${recipients.join(", ")}` : `Lien généré, e-mail non envoyé${reason ? ` (${reason})` : ""}`,
  });

  return { status: next, emailSent, reason, providerLink, expiresAt };
}
