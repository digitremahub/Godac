/**
 * Recipient logic mirrors the V1 pattern described in the spec: the
 * primary recipient is whoever's role is listed first in
 * `alerts.recipient_roles` (typically the manager/gérant), with
 * direction and comptable kept informed for anything financial.
 */
const SEVERITY_LABELS: Record<string, string> = {
  info: "Information",
  warning: "Avertissement",
  critical: "Critique",
};

const SEVERITY_COLORS: Record<string, string> = {
  info: "#1BE4C1",
  warning: "#F5C842",
  critical: "#FF6B35",
};

export function renderAlertEmail({
  type,
  severity,
  message,
  organizationName,
  appUrl,
  linkPath,
}: {
  type: string;
  severity: string;
  message: string;
  organizationName: string;
  appUrl: string;
  /** Relative path to the page concerned by this alert (lib/alerts/resolve-url.ts) — falls back to the generic alert center, same as the push notification does. */
  linkPath?: string;
}): { subject: string; html: string } {
  const color = SEVERITY_COLORS[severity] ?? "#1BE4C1";
  const label = SEVERITY_LABELS[severity] ?? severity;

  return {
    subject: `[GODAC] ${label} — ${organizationName}`,
    html: `
      <div style="font-family: -apple-system, sans-serif; background: #0A0F1E; padding: 24px; color: #fff;">
        <div style="max-width: 480px; margin: 0 auto; background: #ffffff0d; border-radius: 16px; padding: 24px;">
          <p style="color: ${color}; font-weight: 700; text-transform: uppercase; font-size: 12px; letter-spacing: 0.05em;">
            ${label} · ${type}
          </p>
          <p style="font-size: 16px; line-height: 1.5;">${message}</p>
          <a href="${appUrl}${linkPath ?? "/alerts"}" style="display: inline-block; margin-top: 16px; background: #1BE4C1; color: #0A0F1E; padding: 10px 18px; border-radius: 10px; text-decoration: none; font-weight: 700;">
            Voir dans GODAC
          </a>
        </div>
      </div>
    `,
  };
}
