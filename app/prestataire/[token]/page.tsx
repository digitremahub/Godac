import type { Metadata } from "next";
import { headers } from "next/headers";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { resolveProviderAccess } from "@/lib/rental/public-access";
import { getVehicleLatestKmReading } from "@/lib/vehicles/odometer-reference";
import { EVENT_LABELS, RENTAL_STATUS_LABELS, isTerminal, type RentalRequestStatus } from "@/lib/rental/workflow";
import { formatKm } from "@/lib/rental/contract";
import { Card, EmptyState } from "@/components/ui";
import { ProviderResponseForm } from "@/components/rental/ProviderResponseForm";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Demande d'entretien — GODAC",
  robots: { index: false, follow: false },
  // Le jeton est dans l'URL : il ne doit pas fuiter via l'en-tête Referer.
  referrer: "no-referrer",
};

const URGENCY_LABELS: Record<string, string> = { low: "Faible", normal: "Normale", high: "Haute", critical: "Critique" };

const fmt = (iso: string, withTime = true) =>
  new Date(iso).toLocaleString("fr-FR", { timeZone: "Europe/Paris", dateStyle: "medium", ...(withTime ? { timeStyle: "short" } : {}) });

/**
 * Page publique du loueur / prestataire (sans compte GODAC). Le jeton
 * (32 octets, haché en base, 30 jours, une seule demande) est vérifié
 * par resolveProviderAccess ; seules les données de CETTE demande sont
 * lues, avec le client service-role, champ par champ.
 */
export default async function ProviderPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const admin = createAdminSupabaseClient();
  const access = await resolveProviderAccess(admin, token, await headers(), "lecture");

  if (!access.ok) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center bg-surface p-6">
        <EmptyState title={access.httpStatus === 429 ? "Trop de requêtes" : "Lien indisponible"} description={access.message} />
      </main>
    );
  }
  const r = access.request;

  const [{ data: detail }, { data: events }, km] = await Promise.all([
    admin
      .from("rental_maintenance_requests")
      .select(
        "status, slot_start, slot_end, provider_accepted_at, completed_at, invoice_paths, token_expires_at, organizations(name), rental_providers(name), vehicles(registration, brand, model, rental_contract_ref), vehicle_interventions(type, description, urgency, photo_paths, created_at), users!rental_maintenance_requests_validated_by_fkey(full_name, email, contact_email, phone)",
      )
      .eq("id", r.id)
      .single(),
    admin.from("rental_request_events").select("action, actor_kind, comment, created_at").eq("request_id", r.id).order("created_at"),
    getVehicleLatestKmReading(admin, r.vehicle_id),
  ]);
  const d = detail as any;
  const status = d.status as RentalRequestStatus;
  const intervention = d.vehicle_interventions ?? {};
  const photoUrls = (
    await Promise.all(
      ((intervention.photo_paths ?? []) as string[]).map(async (p) => (await admin.storage.from("intervention-photos").createSignedUrl(p, 3600)).data?.signedUrl ?? null),
    )
  ).filter((u): u is string => Boolean(u));
  const contact = d.users;

  return (
    <main className="min-h-screen bg-surface px-4 py-8">
      <div className="mx-auto flex max-w-2xl flex-col gap-4">
        <div>
          <p className="text-sm text-navy/60">Demande transmise par {d.organizations?.name ?? "l'entreprise"} à {d.rental_providers?.name ?? "votre société"}</p>
          <h1 className="mt-1 text-2xl font-bold">
            Entretien — {d.vehicles?.registration ?? "véhicule"}
          </h1>
          <span className="badge-teal mt-2 inline-block">{RENTAL_STATUS_LABELS[status] ?? status}</span>
        </div>

        <Card>
          <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-navy/60">Véhicule</dt>
              <dd>
                {d.vehicles?.registration}
                {d.vehicles?.brand || d.vehicles?.model ? ` · ${[d.vehicles?.brand, d.vehicles?.model].filter(Boolean).join(" ")}` : ""}
              </dd>
            </div>
            <div>
              <dt className="text-navy/60">Kilométrage actuel</dt>
              <dd>{km ? `${formatKm(km.km)} (relevé du ${fmt(km.at, false)})` : "Non renseigné"}</dd>
            </div>
            {d.vehicles?.rental_contract_ref && (
              <div>
                <dt className="text-navy/60">Contrat</dt>
                <dd>{d.vehicles.rental_contract_ref}</dd>
              </div>
            )}
            <div>
              <dt className="text-navy/60">Nature · urgence</dt>
              <dd>
                {intervention.type ?? "Entretien"} · {URGENCY_LABELS[intervention.urgency] ?? intervention.urgency}
              </dd>
            </div>
            <div>
              <dt className="text-navy/60">Signalée le</dt>
              <dd>{intervention.created_at ? fmt(intervention.created_at) : "—"}</dd>
            </div>
            {d.slot_start && (
              <div>
                <dt className="text-navy/60">Créneau prévu</dt>
                <dd>
                  {fmt(d.slot_start)}
                  {d.slot_end ? ` → ${fmt(d.slot_end)}` : ""}
                </dd>
              </div>
            )}
          </dl>
          {intervention.description && <p className="mt-4 whitespace-pre-wrap text-sm">{intervention.description}</p>}
          {photoUrls.length > 0 && (
            <div className="mt-4 grid grid-cols-3 gap-2 sm:grid-cols-4">
              {photoUrls.map((u, i) => (
                <a key={i} href={u} target="_blank" rel="noreferrer noopener" className="block aspect-square overflow-hidden rounded-md bg-navy/5">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={u} alt={`Photo ${i + 1} du signalement`} className="h-full w-full object-cover" />
                </a>
              ))}
            </div>
          )}
        </Card>

        {contact && (
          <Card>
            <p className="text-sm text-navy/60">Votre contact</p>
            <p className="font-semibold">{contact.full_name}</p>
            <p className="text-sm">{[contact.contact_email ?? contact.email, contact.phone].filter(Boolean).join(" · ")}</p>
          </Card>
        )}

        {isTerminal(status) ? (
          <EmptyState title="Demande clôturée" description="Cette demande est terminée. Merci pour votre intervention." />
        ) : (
          <ProviderResponseForm token={token} status={status} accepted={Boolean(d.provider_accepted_at)} />
        )}

        <Card>
          <p className="mb-2 text-sm font-semibold">Historique</p>
          <ul className="flex flex-col gap-2 text-sm">
            {((events ?? []) as any[]).map((e, i) => (
              <li key={i} className="border-t border-navy/5 pt-2 first:border-0 first:pt-0">
                <span className="text-navy/60">{fmt(e.created_at)}</span> · {EVENT_LABELS[e.action] ?? e.action}
                {e.actor_kind === "prestataire" && e.comment ? <span className="block text-navy/70">{e.comment}</span> : null}
              </li>
            ))}
          </ul>
          {(d.invoice_paths?.length ?? 0) > 0 && <p className="mt-3 text-xs text-navy/60">{d.invoice_paths.length} document(s) déposé(s).</p>}
        </Card>

        <p className="text-center text-xs text-navy/50">
          Lien personnel valable jusqu&apos;au {d.token_expires_at ? fmt(d.token_expires_at, false) : "—"}, limité à cette demande. Données traitées pour le
          compte de {d.organizations?.name ?? "l'entreprise"} via GODAC.
        </p>
      </div>
    </main>
  );
}
