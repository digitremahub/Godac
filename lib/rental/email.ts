/**
 * E-mail envoyé au loueur / prestataire quand un responsable valide une
 * demande d'entretien sur un véhicule loué. Pur (rendu HTML échappé),
 * testé ; l'envoi passe par lib/email/resend.ts.
 */

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

const URGENCY_LABELS: Record<string, string> = { low: "Faible", normal: "Normale", high: "Haute", critical: "Critique" };

export interface ProviderEmailInput {
  organizationName: string;
  providerName: string;
  registration: string;
  vehicleModel: string | null;
  currentKm: number | null;
  contractRef: string | null;
  requestType: string;
  urgency: string;
  description: string | null;
  createdAt: string;
  photoUrls: string[];
  contactName: string;
  contactEmail: string | null;
  contactPhone: string | null;
  providerLink: string;
  linkExpiresAt: string;
}

function frDate(iso: string, withTime = false): string {
  return new Date(iso).toLocaleString("fr-FR", {
    timeZone: "Europe/Paris",
    day: "numeric",
    month: "long",
    year: "numeric",
    ...(withTime ? { hour: "2-digit", minute: "2-digit" } : {}),
  });
}

export function renderProviderRequestEmail(d: ProviderEmailInput): { subject: string; html: string } {
  const e = escapeHtml;
  const urgency = URGENCY_LABELS[d.urgency] ?? d.urgency;
  const km = d.currentKm != null ? `${Math.round(d.currentKm).toLocaleString("fr-FR").replace(/[  ]/g, " ")} km` : "non renseigné";
  const rows: [string, string][] = [
    ["Immatriculation", d.registration],
    ["Modèle", d.vehicleModel ?? "—"],
    ["Kilométrage actuel", km],
    ...(d.contractRef ? ([["Contrat", d.contractRef]] as [string, string][]) : []),
    ["Nature", d.requestType],
    ["Urgence", urgency],
    ["Signalée le", frDate(d.createdAt, true)],
  ];
  const contact = [d.contactName, d.contactEmail, d.contactPhone].filter(Boolean).map((x) => e(x!)).join(" · ");
  const photos = d.photoUrls.length
    ? `<p style="margin:16px 0 4px;font-weight:700">Photos (liens valables 7 jours)</p><ul style="margin:0;padding-left:18px">${d.photoUrls
        .map((u, i) => `<li><a href="${e(u)}">Photo ${i + 1}</a></li>`)
        .join("")}</ul>`
    : "";

  return {
    subject: `Demande d'entretien — ${d.registration} (${d.organizationName})${d.urgency === "critical" || d.urgency === "high" ? ` — urgence ${urgency.toLowerCase()}` : ""}`,
    html: `
      <div style="font-family:-apple-system,Segoe UI,sans-serif;background:#f4f6f8;padding:24px;color:#0A0F1E">
        <div style="max-width:560px;margin:0 auto;background:#fff;border-radius:16px;padding:24px">
          <p style="font-size:13px;color:#555">Bonjour ${e(d.providerName)},</p>
          <p style="font-size:15px;line-height:1.5"><strong>${e(d.organizationName)}</strong> vous transmet une demande d'entretien validée par son responsable pour un véhicule loué.</p>
          <table style="width:100%;border-collapse:collapse;font-size:14px;margin-top:8px">
            ${rows.map(([k, v]) => `<tr><td style="padding:4px 8px 4px 0;color:#555;white-space:nowrap">${e(k)}</td><td style="padding:4px 0">${e(v)}</td></tr>`).join("")}
          </table>
          ${d.description ? `<p style="margin:16px 0 4px;font-weight:700">Description</p><p style="margin:0;white-space:pre-wrap">${e(d.description)}</p>` : ""}
          ${photos}
          <p style="margin:16px 0 4px;font-weight:700">Contact dans l'entreprise</p>
          <p style="margin:0">${contact}</p>
          <a href="${e(d.providerLink)}" style="display:inline-block;margin-top:20px;background:#1BE4C1;color:#0A0F1E;padding:12px 20px;border-radius:10px;text-decoration:none;font-weight:700">Répondre à la demande</a>
          <p style="font-size:12px;color:#777;margin-top:16px">Ce lien personnel donne accès à cette seule demande, sans compte, jusqu'au ${e(frDate(d.linkExpiresAt))}. Vous pourrez accepter, proposer un créneau, commenter et déposer votre facture. Ne le transférez pas.</p>
          <p style="font-size:11px;color:#999;margin-top:12px">Envoyé via GODAC pour le compte de ${e(d.organizationName)}, responsable du traitement des données de ce véhicule.</p>
        </div>
      </div>
    `,
  };
}
