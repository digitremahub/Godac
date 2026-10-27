import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { journaliser } from "@/lib/audit/journal";
import { estSchemaManquant, estValeurEnumInconnue } from "@/lib/rattachement/tolerance";
import { cleAlerteImpaye, messageImpaye, type FactureImpayee } from "@/lib/stripe/impaye";

/**
 * Enregistre un paiement échoué : état d'impayé sur l'organisation (bandeau des
 * réglages de facturation) et alerte de la direction (cloche, push et e-mail par
 * le webhook des alertes). Aucun blocage d'accès. Idempotent : la clé de
 * dédoublonnage de l'alerte est propre à la facture et à la tentative. Tolérant à
 * l'absence des migrations 20261109000001/2 (colonne ou type d'alerte absents).
 */
export async function enregistrerPaiementEchoue(admin: SupabaseClient, organizationId: string, facture: FactureImpayee): Promise<void> {
  const { error: errOrg } = await admin
    .from("organizations")
    .update({ payment_failed_at: new Date().toISOString(), payment_failed_invoice_id: facture.id })
    .eq("id", organizationId)
    .is("payment_failed_at", null);
  if (errOrg && !estSchemaManquant(errOrg)) throw new Error(`impayé : ${errOrg.message}`);
  // Un impayé déjà enregistré garde sa date de premier échec ; seule la facture suivie est mise à jour.
  if (!errOrg) await admin.from("organizations").update({ payment_failed_invoice_id: facture.id }).eq("id", organizationId).not("payment_failed_at", "is", null);

  const { error } = await admin.from("alerts").insert({
    organization_id: organizationId,
    type: "paiement_echoue",
    severity: "critical",
    message: messageImpaye(facture),
    related_table: "organizations",
    related_id: organizationId,
    recipient_roles: ["direction"],
    cle_dedoublonnage: cleAlerteImpaye(facture),
  });
  // 23505 : déjà créée (événement rejoué) ; type ou colonne absents : l'état d'impayé reste enregistré.
  if (error && error.code !== "23505" && !estSchemaManquant(error) && !estValeurEnumInconnue(error)) throw new Error(`alerte impayé : ${error.message}`);

  await journaliser({ organizationId, userId: null, action: "facturation_impaye", targetTable: "organizations", targetId: organizationId, details: { facture: facture.id, tentative: facture.attempt_count ?? 1 } });
}

/** Facture payée : l'état d'impayé est effacé et les alertes de paiement ouvertes sont closes. */
export async function effacerImpaye(admin: SupabaseClient, organizationId: string): Promise<void> {
  const { error } = await admin.from("organizations").update({ payment_failed_at: null, payment_failed_invoice_id: null }).eq("id", organizationId).not("payment_failed_at", "is", null);
  if (error && !estSchemaManquant(error)) throw new Error(`impayé : ${error.message}`);
  const { error: errAlertes } = await admin
    .from("alerts")
    .update({ status: "resolved", acknowledged_at: new Date().toISOString() })
    .eq("organization_id", organizationId)
    .eq("type", "paiement_echoue")
    .in("status", ["open", "acknowledged"]);
  if (errAlertes && !estSchemaManquant(errAlertes) && !estValeurEnumInconnue(errAlertes)) console.error("impayé : clôture des alertes", errAlertes.message);
}
