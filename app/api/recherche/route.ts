import { NextResponse } from "next/server";
import { garderApi } from "@/lib/acces/garde-api";
import { urlDe } from "@/lib/acces/catalogue";
import { modulesActifs } from "@/lib/acces/modules-requete";
import { MIN_ENTITES, categoriesEntites, chercherPages, limiter, motifIlike, nettoyerSaisie, type CategorieEntite, type ResultatEntite } from "@/lib/recherche/recherche";
import { chargerPerimetreColis } from "@/lib/exploitation/perimetre-serveur";

export const dynamic = "force-dynamic";

const un = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? (v[0] ?? null) : (v ?? null));

/**
 * Recherche globale (Ctrl+K) : pages autorisées pour le rôle (catalogue) et,
 * avec 2 caractères au moins, chauffeurs, véhicules et tournées du
 * périmètre (manager : ses services ; exploitation, direction : toute
 * l'organisation ; chauffeur, comptable : pages seulement). Lectures sous la
 * RLS de la personne connectée, 8 résultats au plus par catégorie.
 */
export async function GET(req: Request) {
  const g = await garderApi({ roles: "tous" });
  if (!g.ok) return g.reponse;
  const { appUser, supabase } = g;
  const saisie = nettoyerSaisie(new URL(req.url).searchParams.get("q"));
  const ctx = { role: appUser.role, modules: await modulesActifs(appUser.organization_id), conduit: appUser.conduit };

  const pages = chercherPages(ctx, saisie);
  const entites: Partial<Record<CategorieEntite, ResultatEntite[]>> = {};
  const motif = saisie.length >= MIN_ENTITES ? motifIlike(saisie) : null;
  const categories = motif ? categoriesEntites(ctx) : [];

  if (motif && categories.length > 0) {
    const perimetre = await chargerPerimetreColis(supabase, appUser);
    const manager = appUser.role === "manager";
    let mesServices: string[] = [];
    if (manager) {
      const { data } = await supabase.from("user_services").select("service_id").eq("user_id", appUser.id);
      mesServices = ((data ?? []) as { service_id: string }[]).map((x) => x.service_id);
    }
    const sansService = manager && mesServices.length === 0;

    await Promise.all(
      categories.map(async (cat) => {
        if (cat === "chauffeurs") {
          let q = supabase.from("users").select("id, full_name, role").eq("organization_id", appUser.organization_id).eq("active", true).ilike("full_name", motif).order("full_name").limit(8);
          if (perimetre.chauffeurs) q = q.in("id", [...perimetre.chauffeurs]);
          const { data } = await q;
          entites.chauffeurs = limiter(((data ?? []) as { id: string; full_name: string; role: string }[]).map((u) => ({ id: u.id, libelle: u.full_name, detail: null, href: urlDe("equipe.utilisateur_fiche", { id: u.id }) })));
        } else if (cat === "vehicules") {
          if (sansService) return void (entites.vehicules = []);
          let q = supabase.from("vehicles").select("id, registration, type").eq("organization_id", appUser.organization_id).ilike("registration", motif).order("registration").limit(8);
          if (manager) q = q.in("service_id", mesServices);
          const { data } = await q;
          entites.vehicules = limiter(((data ?? []) as { id: string; registration: string; type: string | null }[]).map((v) => ({ id: v.id, libelle: v.registration, detail: v.type, href: urlDe("flotte.vehicule_fiche", { id: v.id }) })));
        } else {
          if (sansService) return void (entites.tournees = []);
          let q = supabase
            .from("planning_entries")
            .select("id, tour_number, start_at, vehicles(registration), users!planning_entries_driver_id_fkey(full_name)")
            .eq("organization_id", appUser.organization_id)
            .ilike("tour_number", motif)
            .order("start_at", { ascending: false })
            .limit(8);
          if (manager) q = q.in("service_id", mesServices);
          const { data } = await q;
          entites.tournees = limiter(
            ((data ?? []) as any[]).map((t) => ({
              id: t.id as string,
              libelle: `Tournée ${t.tour_number}`,
              detail: [new Date(t.start_at).toLocaleDateString("fr-FR", { timeZone: "Europe/Paris", day: "2-digit", month: "2-digit" }), un<{ full_name: string }>(t.users)?.full_name, un<{ registration: string }>(t.vehicles)?.registration].filter(Boolean).join(" · "),
              href: `${urlDe("exploitation.planning")}?entry=${t.id}`,
            })),
          );
        }
      }),
    );
  }
  return NextResponse.json({ pages, entites }, { headers: { "Cache-Control": "no-store" } });
}
