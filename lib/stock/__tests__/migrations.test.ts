import { existsSync, readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Contrat des migrations du module Stock : numérotation, ajout seul, rejouabilité,
 * RLS par organisation, effacement avec l'organisation, registre immuable, droits
 * des fonctions, types d'alerte et policies d'alertes qui gardent TOUS les types existants.
 * Les migrations ne sont pas appliquées par le code : ce test relit leur texte.
 */
const DOSSIER = "supabase/migrations";
const lire = (f: string) => readFileSync(`${DOSSIER}/${f}`, "utf8");
const SCHEMA = "20261114000001_stock_schema.sql";
const FONCTIONS = "20261114000002_stock_fonctions.sql";
const TYPES = "20261114000003_alerte_stock_types.sql";
const LECTURE = "20261114000004_alerte_stock_lecture.sql";
const FICHIERS = [SCHEMA, FONCTIONS, TYPES, LECTURE];
const TABLES = ["stock_parametres", "stock_sites", "stock_emplacements", "stock_articles", "stock_unites", "stock_soldes", "stock_inventaires", "stock_inventaire_lignes", "stock_mouvements"];

/** SQL sans commentaires de ligne. */
const code = (f: string) => lire(f).split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");

describe("numérotation", () => {
  it("les fichiers existent et suivent la dernière migration précédente", () => {
    for (const f of FICHIERS) expect(existsSync(`${DOSSIER}/${f}`), f).toBe(true);
    const autres = readdirSync(DOSSIER).filter((f) => f.endsWith(".sql") && !FICHIERS.includes(f) && f < "20261114");
    expect(autres.sort().at(-1)! < SCHEMA).toBe(true);
  });
  it("aucun doublon de numéro entre les migrations du stock et les autres", () => {
    const tous = readdirSync(DOSSIER).filter((f) => f.endsWith(".sql"));
    for (const f of FICHIERS) expect(tous.filter((t) => t.slice(0, 14) === f.slice(0, 14))).toEqual([f]);
  });
});

describe("migrations additives et rejouables (l'outil d'application bloque les autres)", () => {
  it.each(FICHIERS)("%s : aucune suppression, aucun vidage, aucune mise à jour de masse", (f) => {
    const sql = code(f).toLowerCase();
    expect(sql).not.toMatch(/\bdrop\s+(policy|trigger|table|column|function|index|type|schema)\b/);
    expect(sql).not.toMatch(/\bdelete\s+from\b/);
    expect(sql).not.toMatch(/\btruncate\b/);
    // Toute mise à jour porte une condition (where) ou est un « on conflict do update ».
    for (const m of sql.matchAll(/\bupdate\s+(?:public\.)?\w+\s+set\b[^;]*;/g)) expect(m[0], m[0]).toMatch(/\bwhere\b/);
  });
  it("les tables et index se créent seulement s'ils n'existent pas", () => {
    const sql = code(SCHEMA).toLowerCase();
    for (const m of sql.matchAll(/create\s+table\s+(?!if not exists)/g)) throw new Error(`create table sans if not exists : ${m.index}`);
    for (const m of sql.matchAll(/create\s+(unique\s+)?index\s+(?!if not exists)/g)) throw new Error(`create index sans if not exists : ${m.index}`);
  });
  it("les policies et déclencheurs ne se créent que s'ils sont absents", () => {
    for (const f of [SCHEMA]) {
      const sql = code(f);
      const policies = [...sql.matchAll(/create policy "([^"]+)"/g)].map((m) => m[1]!);
      expect(policies.length).toBeGreaterThan(15);
      for (const nom of policies) expect(sql, nom).toContain(`policyname = '${nom}'`);
      expect((sql.match(/if not exists \(select 1 from pg_policies/g) ?? []).length).toBe(policies.length);
      const triggers = [...sql.matchAll(/create trigger (\w+)/g)].map((m) => m[1]!);
      expect(triggers.length).toBe(2);
      for (const t of triggers) expect(sql).toContain(`tgname = '${t}'`);
    }
  });
  it("les fonctions se remplacent (create or replace)", () => {
    for (const f of [SCHEMA, FONCTIONS]) expect(code(f)).not.toMatch(/create function/);
  });
  it("la fiche du module n'écrit aucun prix", () => {
    const sql = code(SCHEMA);
    expect(sql).toMatch(/insert into public\.modules[\s\S]*'stock'[\s\S]*on conflict \(key\) do nothing/);
    expect(sql).not.toMatch(/module_plan_prices/);
    expect(sql).not.toMatch(/stripe/i);
  });
});

describe("tables : organisation, effacement en fin de contrat, RLS", () => {
  const sql = code(SCHEMA);
  const bloc = (table: string) => {
    const i = sql.indexOf(`create table if not exists public.${table} (`);
    expect(i, table).toBeGreaterThan(-1);
    return sql.slice(i, sql.indexOf("\n);", i));
  };
  it.each(TABLES)("%s : organization_id vers organizations avec on delete cascade", (t) => {
    expect(bloc(t)).toMatch(/organization_id uuid (not null )?(primary key )?references public\.organizations \(id\) on delete cascade/);
  });
  it.each(TABLES)("%s : RLS activée et une policy de lecture bornée à l'organisation", (t) => {
    expect(sql).toContain(`alter table public.${t} enable row level security;`);
    expect(sql).toMatch(new RegExp(`create policy "${t}: read[^"]*"\\s+on public\\.${t} for select\\s+using \\([\\s\\S]*?organization_id = public\\.current_organization_id\\(\\)`));
  });
  it("lecture : jamais le comptable (rôles lecteurs explicites)", () => {
    expect(sql).toMatch(/create or replace function public\.stock_peut_lire\(\)[\s\S]*'chauffeur', 'manager', 'manager_chauffeur', 'exploitation', 'direction'/);
    expect(sql.match(/stock_peut_lire\(\) as/g)).toBeNull();
    const lecteur = sql.slice(sql.indexOf("function public.stock_peut_lire"), sql.indexOf("function public.stock_peut_parametrer"));
    expect(lecteur).not.toContain("comptable");
  });
  it("configuration : exploitation et direction seulement", () => {
    const param = sql.slice(sql.indexOf("function public.stock_peut_parametrer"), sql.indexOf("-- ──", sql.indexOf("function public.stock_peut_parametrer")));
    expect(param).toContain("('exploitation', 'direction')");
    for (const t of ["stock_parametres", "stock_sites", "stock_emplacements", "stock_articles"]) {
      expect(sql).toMatch(new RegExp(`create policy "${t}: insert by exploitation or direction"[\\s\\S]*?stock_peut_parametrer\\(\\)`));
      expect(sql).toMatch(new RegExp(`create policy "${t}: update by exploitation or direction"[\\s\\S]*?stock_peut_parametrer\\(\\)`));
    }
  });
  it("registre, unités, soldes, inventaires : AUCUNE policy d'écriture directe (seules les fonctions SQL écrivent)", () => {
    for (const t of ["stock_mouvements", "stock_unites", "stock_soldes", "stock_inventaires", "stock_inventaire_lignes"]) {
      expect(sql, t).not.toMatch(new RegExp(`on public\\.${t} for (insert|update|delete|all)`));
    }
  });
  it("un manager est borné à ses services par la lecture des dépôts", () => {
    expect(sql).toMatch(/function public\.stock_sites_visibles\(\)[\s\S]*current_user_service_ids\(\)/);
    for (const t of ["stock_sites", "stock_emplacements", "stock_unites", "stock_soldes", "stock_inventaires", "stock_mouvements"]) {
      expect(sql).toMatch(new RegExp(`create policy "${t}: read in scope"[\\s\\S]*?stock_sites_visibles\\(\\)`));
    }
  });
  it("contraintes check sur les statuts, types et quantités", () => {
    expect(sql).toMatch(/statut in \('dans_depot', 'en_tournee', 'livre', 'retour', 'perdu', 'endommage'\)/);
    expect(sql).toMatch(/type in \('entree', 'sortie', 'transfert', 'ajustement', 'casse', 'perte', 'retour'\)/);
    expect(sql).toMatch(/quantite numeric\(14, 3\) not null check \(quantite > 0\)/);
    expect(sql).toMatch(/quantite numeric\(14, 3\) not null default 0 check \(quantite >= 0\)/);
    expect(sql).toMatch(/sscc ~ '\^\[0-9\]\{18\}\$'/);
    expect(sql).toMatch(/profils <@ array\['messagerie', 'palettes', 'vrac'\]/);
  });
  it("idempotence : clé unique par organisation sur les mouvements et les inventaires", () => {
    expect(bloc("stock_mouvements")).toContain("unique (organization_id, cle_idempotence)");
    expect(bloc("stock_inventaires")).toContain("unique (organization_id, cle_idempotence)");
  });
  it("aucune donnée de destinataire dans le stock", () => {
    const tout = TABLES.map(bloc).join("\n").toLowerCase();
    for (const mot of ["recipient", "destinataire", "phone", "telephone", "address", "adresse_livraison", "email"]) expect(tout, mot).not.toContain(mot);
    // Le seul lien vers les colis : tournée et arrêt, par identifiant.
    expect(bloc("stock_unites")).toMatch(/run_id uuid references public\.delivery_runs \(id\) on delete set null/);
    expect(bloc("stock_unites")).toMatch(/stop_id uuid references public\.delivery_stops \(id\) on delete set null/);
  });
});

describe("registre des mouvements immuable", () => {
  const sql = code(SCHEMA);
  it("droits d'écriture retirés à tous les rôles applicatifs, service_role compris", () => {
    expect(sql).toMatch(/revoke all on public\.stock_mouvements from anon, authenticated, service_role;/);
    expect(sql).toMatch(/grant select on public\.stock_mouvements to authenticated, service_role;/);
  });
  it("déclencheur qui refuse toute modification, sauf l'effacement du lien vers une tournée supprimée", () => {
    expect(sql).toMatch(/before update on public\.stock_mouvements/);
    expect(sql).toContain("raise exception 'stock_registre_immuable'");
    expect(sql).toMatch(/\(to_jsonb\(new\) - 'run_id' - 'stop_id'\) = \(to_jsonb\(old\) - 'run_id' - 'stop_id'\)/);
    expect(sql).toMatch(/new\.run_id is null or new\.run_id is not distinct from old\.run_id/);
  });
  it("les autres tables d'état ne sont écrites que par les fonctions", () => {
    for (const t of ["stock_unites", "stock_soldes", "stock_inventaires", "stock_inventaire_lignes"]) expect(sql).toContain(`revoke all on public.${t} from anon, authenticated;`);
  });
});

describe("fonctions SQL", () => {
  const sql = code(FONCTIONS);
  it("toutes les fonctions appelables sont security definer et fixent le search_path", () => {
    const fonctions = [...sql.matchAll(/create or replace function public\.(\w+)\(([\s\S]*?)\)\s*(?:returns\s+\w+\s+)?language (\w+)([\s\S]*?)as \$\$/g)];
    expect(fonctions.map((m) => m[1])).toEqual(expect.arrayContaining(["stock_transition_autorisee", "stock__appliquer", "stock__contexte", "stock__site_autorise", "stock_enregistrer_mouvement", "stock_creer_inventaire", "stock_compter", "stock_valider_inventaire", "stock_annuler_inventaire"]));
    for (const m of fonctions) {
      if (m[1] === "stock_transition_autorisee") continue;
      expect(m[4], m[1]).toMatch(/security definer/);
      expect(m[4], m[1]).toMatch(/set search_path = public/);
    }
  });
  it("fonctions publiques : exécution retirée à public et anon, donnée à authenticated seulement", () => {
    for (const nom of ["stock_enregistrer_mouvement", "stock_creer_inventaire", "stock_compter", "stock_valider_inventaire", "stock_annuler_inventaire"]) {
      expect(sql, nom).toMatch(new RegExp(`revoke all on function public\\.${nom}\\([^)]*\\) from public, anon;`));
      expect(sql, nom).toMatch(new RegExp(`grant execute on function public\\.${nom}\\([^)]*\\) to authenticated;`));
    }
  });
  it("fonctions internes : aucune exécution pour les clients", () => {
    for (const nom of ["stock__appliquer", "stock__contexte", "stock__site_autorise"]) {
      expect(sql, nom).toMatch(new RegExp(`revoke all on function public\\.${nom}\\([^)]*\\) from public, anon, authenticated;`));
    }
  });
  it("chaque fonction publique revérifie l'authentification, le module actif et le rôle", () => {
    const contexte = sql.slice(sql.indexOf("function public.stock__contexte"), sql.indexOf("function public.stock__site_autorise"));
    expect(contexte).toContain("auth.uid()");
    expect(contexte).toContain("m.module_key = 'stock' and m.enabled");
    expect(contexte).toContain("stock_non_authentifie");
    for (const nom of ["stock_enregistrer_mouvement", "stock_creer_inventaire", "stock_compter", "stock_valider_inventaire", "stock_annuler_inventaire"]) {
      const i = sql.indexOf(`function public.${nom}(`);
      const corps = sql.slice(i, sql.indexOf("$$;", sql.indexOf("as $$", i)));
      expect(corps, nom).toContain("public.stock__contexte()");
      expect(corps, nom).toContain("stock_role_refuse");
    }
  });
  it("l'ajustement est refusé au chauffeur ; l'inventaire est ouvert et validé par l'encadrement seulement", () => {
    expect(sql).toMatch(/p_type = 'ajustement' and c\.o_role = 'chauffeur'/);
    for (const nom of ["stock_creer_inventaire", "stock_valider_inventaire", "stock_annuler_inventaire"]) {
      const i = sql.indexOf(`function public.${nom}(`);
      const corps = sql.slice(i, sql.indexOf("$$;", sql.indexOf("as $$", i)));
      expect(corps, nom).toMatch(/not in \('manager', 'manager_chauffeur', 'exploitation', 'direction'\)/);
    }
  });
  it("le solde d'un article ne devient jamais négatif et le registre est écrit dans la même fonction", () => {
    expect(sql).toContain("quantite >= v_quantite");
    expect(sql).toContain("raise exception 'stock_insuffisant'");
    expect(sql.match(/insert into public\.stock_mouvements/g)?.length).toBe(2);
  });
  it("idempotence : une clé déjà connue renvoie le mouvement existant sans rien modifier", () => {
    const i = sql.indexOf("function public.stock__appliquer");
    const debut = sql.slice(i, i + 3200);
    expect(debut).toMatch(/where organization_id = p_org and cle_idempotence = p_cle/);
    expect(debut).toMatch(/'doublon', true/);
    expect(debut.indexOf("'doublon', true")).toBeLessThan(debut.indexOf("stock_type_invalide"));
  });
  it("casse, perte et ajustement exigent un motif, quel que soit l'appelant (même en appelant la fonction directement)", () => {
    expect(sql).toMatch(/p_type in \('ajustement', 'casse', 'perte'\) and \(p_motif is null or btrim\(p_motif\) = ''\) then\s+raise exception 'stock_motif_requis'/);
  });
  it("la validation d'un inventaire est rejouable (même clé ou déjà validé)", () => {
    expect(sql).toMatch(/if v_inv\.statut = 'valide' then\s+return jsonb_build_object\('ok', true, 'doublon', true/);
  });
});

describe("types d'alerte et lecture", () => {
  it("trois valeurs d'enum ajoutées sans rien retirer", () => {
    const sql = code(TYPES);
    for (const t of ["stock_seuil", "stock_ecart", "stock_non_rentre"]) expect(sql).toContain(`add value if not exists '${t}'`);
    expect(sql).not.toMatch(/\bdrop\b|\brename\b/i);
  });
  it("les policies d'alertes gardent TOUS les types déjà listés par la migration précédente", () => {
    const precedente = code("20261111000006_alerte_planning_fusion_lecture.sql");
    const nouvelle = code(LECTURE);
    const listes = (s: string) => [...s.matchAll(/type::text not in \(([^)]*)\)/g)].map((m) => m[1]!.split(",").map((t) => t.trim()));
    const avant = listes(precedente);
    const apres = listes(nouvelle);
    expect(avant.length).toBe(3);
    expect(apres.length).toBe(3);
    for (let i = 0; i < avant.length; i++) {
      for (const t of avant[i]!) expect(apres[i], t).toContain(t);
      expect(apres[i]).toEqual(expect.arrayContaining(["'stock_seuil'", "'stock_ecart'", "'stock_non_rentre'"]));
    }
  });
  it("les deux policies sont re-déclarées à l'identique hors les nouveaux types", () => {
    const normaliser = (s: string) => s.replace(/,\s*'stock_seuil',\s*'stock_ecart',\s*'stock_non_rentre'/g, "").replace(/\s+/g, " ");
    const corps = (s: string) => s.slice(s.indexOf("alter policy"));
    expect(normaliser(corps(code(LECTURE)))).toBe(normaliser(corps(code("20261111000006_alerte_planning_fusion_lecture.sql"))));
  });
  it("le comptable et les managers hors service ne lisent pas les alertes du stock", () => {
    const sql = code(LECTURE);
    const comptable = sql.slice(sql.indexOf("current_role() = 'comptable'"), sql.indexOf("current_role() in ('manager', 'manager_chauffeur')"));
    expect(comptable).toContain("'stock_seuil'");
  });
});
