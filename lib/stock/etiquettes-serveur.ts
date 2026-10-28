import "server-only";
import { NextResponse } from "next/server";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { journaliser } from "@/lib/audit/journal";
import { chargerReferentiel } from "@/lib/stock/chargement-serveur";
import { analyserCodeInterne } from "@/lib/stock/codes";
import { genererCodesInternes } from "@/lib/stock/codes-serveur";
import { libelleEmplacement } from "@/lib/stock/emplacements";
import { type ErreurStock } from "@/lib/stock/erreurs";
import { construireEtiquette, etiquetteVierge, type ContexteEtiquette, type DonneesEtiquette } from "@/lib/stock/etiquettes";
import { DEFINITION_FORMATS, ETIQUETTES_MAX, FORMAT_PAR_DEFAUT, FORMATS_ETIQUETTE, parPage, type CleFormatEtiquette } from "@/lib/stock/formats-etiquette";
import { reponseErreur } from "@/lib/stock/http";
import { DEFINITION_PROFILS, resoudreProfil, type CleProfil } from "@/lib/stock/profils";
import { lireParametresStock } from "@/lib/stock/serveur";
import { unitesParIds } from "@/lib/stock/unites-serveur";
import { parisDay } from "@/lib/utils/paris-time";

/**
 * Impression des étiquettes : étiquettes d'unités existantes (code interne s'il existe, sinon code
 * principal) ou planche d'étiquettes vierges numérotées (codes d'avance à coller ensuite). Le PDF est
 * produit côté serveur ; le QR code et le code-barres ne portent que le code. Journalisé (nombre,
 * format, mode : jamais de contenu). Les codes des en-têtes de réponse sont encodés (un code peut contenir des accents).
 */

export const schemaImpression = z.discriminatedUnion("mode", [
  z.object({
    mode: z.literal("unites"),
    ids: z.array(z.string().uuid()).min(1).max(ETIQUETTES_MAX),
    format: z.enum(FORMATS_ETIQUETTE).optional(),
    debut: z.number().int().min(0).max(100).optional(),
  }),
  z.object({
    mode: z.literal("vierges"),
    /** Génère `nombre` codes neufs (avec `cle`), puis les imprime. */
    nombre: z.number().int().min(1).max(ETIQUETTES_MAX).optional(),
    cle: z.string().min(8).max(100).optional(),
    /** Réimprime des codes déjà générés. */
    codes: z.array(z.string().min(1).max(80)).min(1).max(ETIQUETTES_MAX).optional(),
    format: z.enum(FORMATS_ETIQUETTE).optional(),
    debut: z.number().int().min(0).max(100).optional(),
  }),
]);
export type Impression = z.infer<typeof schemaImpression>;

export async function produireEtiquettes(supabase: SupabaseClient, appUser: { id: string; organization_id: string }, demande: Impression): Promise<NextResponse> {
  const org = appUser.organization_id;
  const parametres = await lireParametresStock(supabase, org);
  if (parametres.schemaAbsent) return reponseErreur({ code: "stock_schema_absent", message: "Le module Stock n'est pas encore installé sur la base (mise à jour en attente).", status: 503 });
  const profilParDefaut: CleProfil = parametres.profils[0] ?? "personnalise";

  const [{ data: entreprise }, referentiel] = await Promise.all([supabase.from("organizations").select("name, logo_url").eq("id", org).maybeSingle(), chargerReferentiel(supabase, org)]);
  const nom = ((entreprise as { name?: string } | null)?.name ?? "").trim();
  const logoUrl = (entreprise as { logo_url?: string | null } | null)?.logo_url ?? null;
  const ctxBase: ContexteEtiquette = { entreprise: nom, date: parisDay().split("-").reverse().join("/"), logo: Boolean(logoUrl) };

  const etiquettes: DonneesEtiquette[] = [];
  let formatPropose: CleFormatEtiquette | null = null;
  let mode: "unites" | "vierges" = demande.mode;
  if (demande.mode === "unites") {
    if (!parametres.codesInstalles) return reponseErreur({ code: "stock_schema_absent", message: "Les étiquettes ne sont pas encore installées sur la base (mise à jour en attente).", status: 503 });
    const unites = await unitesParIds(supabase, org, demande.ids);
    if (unites.length !== new Set(demande.ids).size) return reponseErreur({ code: "stock_unite_inconnue", message: "Une unité est introuvable ou hors de votre périmètre.", status: 404 });
    for (const u of unites) {
      const profil = resoudreProfil((u.profil as CleProfil | null) && u.profil! in DEFINITION_PROFILS ? (u.profil as CleProfil) : profilParDefaut, parametres.config);
      formatPropose ??= profil.etiquette.format;
      const site = referentiel.sites.find((s) => s.id === u.site_id);
      const emp = referentiel.emplacements.find((e) => e.id === u.emplacement_id);
      etiquettes.push(construireEtiquette(u, { ...ctxBase, depot: site?.nom ?? null, emplacement: emp ? libelleEmplacement(emp, referentiel.emplacements) : null }, profil.etiquette.champs));
    }
  } else {
    let codes: string[];
    if (demande.codes?.length) {
      codes = demande.codes.map((c) => c.trim());
      if (codes.some((c) => !analyserCodeInterne(c))) return reponseErreur({ code: "stock_code_interne_invalide", message: "Seuls des codes internes (PREFIXE-AAAA-NNNNNN) peuvent être réimprimés sur une planche vierge.", status: 400 });
    } else if (demande.nombre && demande.cle) {
      if (!parametres.codesInstalles) return reponseErreur({ code: "stock_schema_absent", message: "Les codes internes ne sont pas encore installés sur la base (mise à jour en attente).", status: 503 });
      const r = await genererCodesInternes(supabase, appUser, demande.nombre, demande.cle, "planche");
      if (!r.ok) return reponseErreur(r.erreur satisfies ErreurStock);
      codes = r.codes;
    } else {
      return reponseErreur({ code: "stock_requete_invalide", message: "Indiquez un nombre de codes et une clé, ou des codes à réimprimer.", status: 400 });
    }
    const profil = resoudreProfil(profilParDefaut, parametres.config);
    formatPropose = profil.etiquette.format;
    for (const code of codes) etiquettes.push(etiquetteVierge(code, ctxBase, profil.etiquette.champs));
    mode = "vierges";
  }

  const cle: CleFormatEtiquette = demande.format ?? parametres.formatEtiquette ?? formatPropose ?? FORMAT_PAR_DEFAUT;
  const format = DEFINITION_FORMATS[cle];
  const logo = logoUrl && etiquettes.some((e) => e.logo) ? await (await import("@/lib/paie/pdf")).chargerLogo(logoUrl) : null;
  const { genererEtiquettesPdf } = await import("@/lib/stock/etiquettes-pdf");
  const pdf = await genererEtiquettesPdf({ format, etiquettes, logo, debut: format.planche ? (demande.debut ?? 0) : 0, titre: mode === "vierges" ? "Planche d'étiquettes numérotées" : "Étiquettes de stock", cadre: false });
  await journaliser({
    organizationId: org,
    userId: appUser.id,
    action: "stock_etiquettes_imprimees",
    targetTable: "stock_unites",
    details: { mode, nombre: etiquettes.length, format: cle, par_page: parPage(format) },
  });
  return new NextResponse(new Uint8Array(pdf), {
    headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="etiquettes-stock-${cle}.pdf"`, "Cache-Control": "no-store", "X-Etiquettes": String(etiquettes.length), "X-Code-Premier": encodeURIComponent(etiquettes[0]?.code ?? ""), "X-Code-Dernier": encodeURIComponent(etiquettes[etiquettes.length - 1]?.code ?? "") },
  });
}
