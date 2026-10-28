import { NextResponse } from "next/server";
import { z } from "zod";
import { garderApi } from "@/lib/acces/garde-api";
import { LECTEURS_STOCK, PARAMETREURS_STOCK } from "@/lib/acces/catalogue";
import { journaliser } from "@/lib/audit/journal";
import { prefixeParDefaut } from "@/lib/stock/codes";
import { traduireErreurStock } from "@/lib/stock/erreurs";
import { FORMATS_ETIQUETTE } from "@/lib/stock/formats-etiquette";
import { lireCorps, reponseErreur, REQUETE_INVALIDE } from "@/lib/stock/http";
import { PROFILS, famillesDe, normaliserProfils, schemaConfigProfil, type ProfilsConfig } from "@/lib/stock/profils";
import { lireParametresStock } from "@/lib/stock/serveur";

/** Profils d'activité activés, leur personnalisation, préfixe des codes et format d'étiquette de l'organisation. */
export async function GET() {
  const g = await garderApi({ roles: LECTEURS_STOCK, modules: ["stock"] });
  if (!g.ok) return g.reponse;
  const parametres = await lireParametresStock(g.supabase, g.appUser.organization_id);
  const { data: org } = await g.supabase.from("organizations").select("name").eq("id", g.appUser.organization_id).maybeSingle();
  return NextResponse.json({ ...parametres, prefixeParDefaut: prefixeParDefaut((org as { name?: string } | null)?.name) });
}

const corps = z
  .object({
    /** Profils activés (catalogue : messagerie, palettes, sante, pharmacie, alimentaire, vrac, personnalise). */
    profils: z.array(z.enum(PROFILS)).max(PROFILS.length).optional(),
    /** Ajustements par profil (vocabulaire, champs, alertes, étiquette, FEFO) : seules les différences avec le catalogue. */
    config: z.record(z.enum(PROFILS), schemaConfigProfil).optional(),
    /** Préfixe des codes internes (2 à 6 caractères A-Z0-9). */
    prefixe_code: z.string().trim().min(1).max(20).optional(),
    format_etiquette: z.enum(FORMATS_ETIQUETTE).nullable().optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: "Rien à enregistrer." });

/**
 * Enregistre les paramètres. Désactiver un profil ne supprime rien : les unités et articles
 * restent consultables, seuls les nouveaux mouvements de ce profil sont refusés. Chaque
 * changement est journalisé (avant / après, jamais de contenu libre autre que le vocabulaire).
 * Le préfixe des codes passe par la fonction SQL stock_definir_prefixe (modifiable à tout
 * moment ; les codes déjà générés restent valides).
 */
export async function PUT(req: Request) {
  const g = await garderApi({ roles: PARAMETREURS_STOCK, modules: ["stock"] });
  if (!g.ok) return g.reponse;
  const parsed = corps.safeParse(await lireCorps(req));
  if (!parsed.success) return reponseErreur({ ...REQUETE_INVALIDE, message: parsed.error.issues[0]?.message ?? REQUETE_INVALIDE.message });
  const { appUser, supabase } = g;
  const org = appUser.organization_id;
  const avant = await lireParametresStock(supabase, org);
  const v = parsed.data;

  const actifs = v.profils !== undefined ? normaliserProfils(v.profils) : avant.profils;
  const profilsConfig = v.config !== undefined ? { ...avant.config.profils, ...v.config } : avant.config.profils;
  // Seule la configuration des profils activés est gardée.
  const gardes = Object.fromEntries(Object.entries(profilsConfig).filter(([cle]) => (actifs as string[]).includes(cle)));
  const config: ProfilsConfig = { version: 1, actifs, profils: gardes };
  const touchePourProfils = v.profils !== undefined || v.config !== undefined;
  const nouveauxProfils = actifs.some((p) => !["messagerie", "palettes", "vrac"].includes(p)) || Object.keys(gardes).length > 0;

  if (!avant.codesInstalles && (v.prefixe_code !== undefined || v.format_etiquette !== undefined || nouveauxProfils)) {
    return reponseErreur({ code: "stock_schema_absent", message: "Les profils adaptables, les codes et les étiquettes ne sont pas encore installés sur la base (mise à jour en attente).", status: 503 });
  }

  if (v.prefixe_code !== undefined) {
    const { data, error } = await supabase.rpc("stock_definir_prefixe", { p_prefixe: v.prefixe_code });
    if (error) return reponseErreur(traduireErreurStock(error));
    const r = (data ?? {}) as { prefixe?: string; avant?: string | null; codes_generes?: boolean };
    await journaliser({ organizationId: org, userId: appUser.id, action: "stock_prefixe_modifie", targetTable: "stock_parametres", targetId: org, details: { avant: r.avant ?? null, apres: r.prefixe ?? null, codes_deja_generes: Boolean(r.codes_generes) } });
  }

  if (touchePourProfils || v.format_etiquette !== undefined) {
    const ligne: Record<string, unknown> = { organization_id: org, updated_by: appUser.id, updated_at: new Date().toISOString() };
    if (touchePourProfils) {
      ligne.profils = famillesDe(actifs, config);
      if (avant.codesInstalles) ligne.profils_config = config;
    }
    if (v.format_etiquette !== undefined && avant.codesInstalles) ligne.format_etiquette = v.format_etiquette;
    const { error } = await supabase.from("stock_parametres").upsert(ligne, { onConflict: "organization_id" });
    if (error) return reponseErreur(traduireErreurStock(error));
    if (v.profils !== undefined) {
      await journaliser({ organizationId: org, userId: appUser.id, action: "stock_profils_modifies", targetTable: "stock_parametres", targetId: org, details: { avant: avant.profils, apres: actifs } });
    }
    if (v.config !== undefined) {
      await journaliser({ organizationId: org, userId: appUser.id, action: "stock_profil_config_modifie", targetTable: "stock_parametres", targetId: org, details: { profils: Object.keys(v.config) } });
    }
    if (v.format_etiquette !== undefined) {
      await journaliser({ organizationId: org, userId: appUser.id, action: "stock_format_etiquette_modifie", targetTable: "stock_parametres", targetId: org, details: { avant: avant.formatEtiquette, apres: v.format_etiquette } });
    }
  }
  return NextResponse.json({ ...(await lireParametresStock(supabase, org)) });
}
