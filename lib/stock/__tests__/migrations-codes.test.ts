import { existsSync, readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { FORMATS_ETIQUETTE } from "@/lib/stock/formats-etiquette";
import { NATURES, TEMPERATURES, schemaAttributs } from "@/lib/stock/attributs";
import { CHAMPS_OUI_NON, DEFINITION_PROFILS, PROFILS } from "@/lib/stock/profils";
import { CODES_MAX_PAR_APPEL } from "@/lib/stock/codes";

/**
 * Contrat des migrations « codes internes, attributs, étiquettes, profils adaptables » (20261115) :
 * numérotation, ajout seul (ce que l'outil d'application accepte), RLS, droits des fonctions, absence du
 * piège RLS (policy de lecture qui relit sa propre table), concordance avec le code TypeScript.
 * Les migrations ne sont pas appliquées par le code : ce test relit leur texte.
 */
const DOSSIER = "supabase/migrations";
const lire = (f: string) => readFileSync(`${DOSSIER}/${f}`, "utf8");
const SCHEMA = "20261115000001_stock_codes_attributs_schema.sql";
const FONCTIONS = "20261115000002_stock_codes_fonctions.sql";
const TYPE = "20261115000003_alerte_stock_dlc_type.sql";
const LECTURE = "20261115000004_alerte_stock_dlc_lecture.sql";
const FICHIERS = [SCHEMA, FONCTIONS, TYPE, LECTURE];
const code = (f: string) => lire(f).split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
const bloc = (sql: string, nom: string) => {
  const i = sql.indexOf(`function public.${nom}(`);
  expect(i, nom).toBeGreaterThan(-1);
  return sql.slice(i, sql.indexOf("\n$$;", sql.indexOf("as $$", i)));
};

describe("numérotation et ordre d'application", () => {
  it("les quatre fichiers existent, après la dernière migration du stock, sans doublon de numéro", () => {
    for (const f of FICHIERS) expect(existsSync(`${DOSSIER}/${f}`), f).toBe(true);
    const tous = readdirSync(DOSSIER).filter((f) => f.endsWith(".sql"));
    for (const f of FICHIERS) expect(tous.filter((t) => t.slice(0, 14) === f.slice(0, 14)), f).toEqual([f]);
    const avant = tous.filter((f) => !FICHIERS.includes(f)).sort().at(-1)!;
    expect(avant < SCHEMA).toBe(true);
    expect(FICHIERS).toEqual([...FICHIERS].sort());
  });
  it("le type d'alerte est dans un fichier séparé, appliqué seul, avant les policies qui le citent", () => {
    expect(code(TYPE).trim()).toBe("alter type public.alert_type add value if not exists 'stock_dlc_proche';");
    expect(code(LECTURE)).not.toMatch(/alter type/);
    expect(FICHIERS.indexOf(TYPE)).toBeLessThan(FICHIERS.indexOf(LECTURE));
  });
});

describe("migrations additives, rejouables, acceptées par l'outil d'application", () => {
  it.each(FICHIERS)("%s : ni drop, ni delete, ni truncate, ni mise à jour sans where", (f) => {
    const sql = code(f).toLowerCase();
    expect(sql).not.toMatch(/\bdrop\s+/);
    expect(sql).not.toMatch(/\bdelete\s+from\b/);
    expect(sql).not.toMatch(/\btruncate\b/);
    for (const m of sql.matchAll(/\bupdate\s+(?:public\.)?\w+\s+set\b[^;]*;/g)) expect(m[0], m[0]).toMatch(/\bwhere\b/);
    expect(sql).not.toMatch(/alter\s+table[^;]*\b(drop|rename|alter\s+column)\b/);
    expect(sql).not.toMatch(/alter\s+table[^;]*\badd\s+constraint\b/);
  });
  it("colonnes, tables et index ne se créent que s'ils n'existent pas", () => {
    const sql = code(SCHEMA).toLowerCase();
    for (const m of sql.matchAll(/alter\s+table\s+public\.\w+\s+add\s+column\s+(?!if not exists)/g)) throw new Error(`add column sans if not exists : ${m.index}`);
    for (const m of sql.matchAll(/create\s+table\s+(?!if not exists)/g)) throw new Error(`create table sans if not exists : ${m.index}`);
    for (const m of sql.matchAll(/create\s+(unique\s+)?index\s+(?!if not exists)/g)) throw new Error(`create index sans if not exists : ${m.index}`);
    expect((sql.match(/add column if not exists/g) ?? []).length).toBeGreaterThanOrEqual(17);
  });
  it("policies et déclencheurs : créés seulement s'ils sont absents (pg_policies, pg_trigger)", () => {
    const sql = code(SCHEMA);
    const policies = [...sql.matchAll(/create policy "([^"]+)"/g)].map((m) => m[1]!);
    expect(policies).toHaveLength(2);
    for (const nom of policies) expect(sql).toContain(`policyname = '${nom}'`);
    expect((sql.match(/if not exists \(select 1 from pg_policies/g) ?? []).length).toBe(policies.length);
    const triggers = [...sql.matchAll(/create trigger (\w+)/g)].map((m) => m[1]!);
    expect(triggers).toEqual(["stock_unites_codes_coherents_trg"]);
    expect(sql).toContain("tgname = 'stock_unites_codes_coherents_trg'");
    // Aucune policy ne se crée hors d'un bloc « do $$ ».
    expect(sql.slice(0, sql.indexOf("do $$"))).not.toMatch(/create policy/);
  });
  it("les fonctions se remplacent (create or replace), jamais create function", () => {
    for (const f of [SCHEMA, FONCTIONS]) expect(code(f)).not.toMatch(/create function/);
    expect((code(FONCTIONS).match(/create or replace function/g) ?? []).length).toBeGreaterThanOrEqual(9);
  });
  it("aucun prix, aucune tarification, rien de Stripe", () => {
    for (const f of FICHIERS) expect(code(f)).not.toMatch(/stripe|module_plan_prices|base_price/i);
  });
  it("la fonction d'origine n'est pas modifiée : la nouvelle porte un autre nom (pas de surcharge ambiguë pour l'API)", () => {
    expect(code(FONCTIONS)).toContain("function public.stock_enregistrer_mouvement_v2(");
    expect(code(FONCTIONS)).not.toMatch(/function public\.stock_enregistrer_mouvement\(/);
    expect(code(FONCTIONS)).not.toMatch(/function public\.stock__appliquer\(/);
  });
});

describe("tables : organisation, effacement en fin de contrat, RLS", () => {
  const sql = code(SCHEMA);
  const table = (t: string) => {
    const i = sql.indexOf(`create table if not exists public.${t} (`);
    expect(i, t).toBeGreaterThan(-1);
    return sql.slice(i, sql.indexOf("\n);", i));
  };
  it.each(["stock_compteurs", "stock_generations"])("%s : organization_id vers organizations avec on delete cascade", (t) => {
    expect(table(t)).toMatch(/organization_id uuid not null references public\.organizations \(id\) on delete cascade/);
  });
  it.each(["stock_compteurs", "stock_generations"])("%s : RLS activée, une policy de lecture bornée à l'organisation, aucune policy d'écriture, droits en lecture seule", (t) => {
    expect(sql).toContain(`alter table public.${t} enable row level security;`);
    expect(sql).toMatch(new RegExp(`create policy "${t}: read within organization"\\s+on public\\.${t} for select\\s+using \\(organization_id = public\\.current_organization_id\\(\\) and public\\.stock_peut_parametrer\\(\\)\\)`));
    expect(sql).not.toMatch(new RegExp(`on public\\.${t} for (insert|update|delete|all)`));
    expect(sql).toContain(`revoke all on public.${t} from anon, authenticated;`);
    expect(sql).toContain(`grant select on public.${t} to authenticated;`);
  });
  it("compteur atomique : une ligne par organisation et par année, borné à 999 999", () => {
    const t = table("stock_compteurs");
    expect(t).toContain("primary key (organization_id, annee)");
    expect(t).toMatch(/dernier integer not null default 0 check \(dernier between 0 and 999999\)/);
  });
  it("journal des générations : clé unique par organisation (idempotence), au plus 500 codes", () => {
    const t = table("stock_generations");
    expect(t).toContain("unique (organization_id, cle)");
    expect(t).toMatch(/codes text\[\] not null check \(cardinality\(codes\) between 1 and 500\)/);
    expect(t).toMatch(/prefixe text not null check \(prefixe ~ '\^\[A-Z0-9\]\{2,6\}\$'\)/);
  });
  it("unicité du code interne par organisation (et celle du code principal existe déjà)", () => {
    expect(sql).toMatch(/create unique index if not exists stock_unites_code_interne_unique\s+on public\.stock_unites \(organization_id, code_interne\) where code_interne is not null/);
    expect(code("20261114000001_stock_schema.sql")).toContain("unique (organization_id, code)");
  });
  it("les écritures sur les unités restent réservées aux fonctions : toujours aucune policy d'écriture", () => {
    for (const f of ["20261114000001_stock_schema.sql", SCHEMA]) expect(code(f)).not.toMatch(/on public\.stock_unites for (insert|update|delete|all)/);
  });
  it("aucune donnée de patient ni de destinataire dans les nouvelles colonnes", () => {
    const colonnes = [...sql.matchAll(/add column if not exists (\w+)/g)].map((m) => m[1]!);
    expect(colonnes.join(" ")).not.toMatch(/patient|donneur|destinataire|phone|telephone|adresse|email|nom_|prenom/);
  });
});

describe("piège RLS : une policy de lecture ne relit jamais sa propre table", () => {
  const dossiers = readdirSync(DOSSIER).filter((f) => f.endsWith(".sql") && f >= "20261114000001" && f <= "20261115000099").sort();
  const sqlTout = dossiers.map(code).join("\n");
  /** Fonctions SQL définies dans les migrations du stock → tables relues dans leur corps. */
  const fonctions = new Map<string, string>();
  for (const m of sqlTout.matchAll(/create or replace function public\.(\w+)\([\s\S]*?\n\$\$;/g)) fonctions.set(m[1]!, m[0]);
  /** Policies de lecture finales (création, puis éventuelle correction par « alter policy »). */
  const policies = new Map<string, { table: string; using: string }>();
  for (const f of dossiers) {
    for (const m of code(f).matchAll(/create policy "([^"]+)"\s+on public\.(\w+) for select\s+using \(([\s\S]*?)\);\s*\n\s*end if;/g)) policies.set(m[1]!, { table: m[2]!, using: m[3]! });
    for (const m of code(f).matchAll(/alter policy "([^"]+)" on public\.(\w+)\s+using \(([\s\S]*?)\);\s*\n/g)) if (policies.has(m[1]!)) policies.set(m[1]!, { table: m[2]!, using: m[3]! });
  }
  it("on retrouve toutes les policies de lecture du stock", () => {
    expect(policies.size).toBeGreaterThanOrEqual(11);
    expect([...policies.keys()]).toEqual(expect.arrayContaining(["stock_sites: read in scope", "stock_compteurs: read within organization", "stock_generations: read within organization"]));
  });
  it("aucune policy de lecture n'appelle une fonction qui relit la table protégée", () => {
    for (const [nom, p] of policies) {
      for (const f of p.using.matchAll(/public\.(\w+)\(/g)) {
        const corps = fonctions.get(f[1]!);
        if (!corps) continue;
        expect(corps, `${nom} → ${f[1]}() relit ${p.table}`).not.toMatch(new RegExp(`from public\\.${p.table}\\b`));
      }
    }
  });
  it("la correction de stock_sites est bien prise en compte : sa policy finale ne passe plus par stock_sites_visibles()", () => {
    expect(policies.get("stock_sites: read in scope")!.using).not.toContain("stock_sites_visibles");
  });
  it("les nouvelles policies n'utilisent que des fonctions qui lisent public.users", () => {
    for (const nom of ["stock_compteurs: read within organization", "stock_generations: read within organization"]) {
      const fns = [...policies.get(nom)!.using.matchAll(/public\.(\w+)\(/g)].map((m) => m[1]);
      expect(fns.sort()).toEqual(["current_organization_id", "stock_peut_parametrer"]);
    }
    expect(fonctions.get("stock_peut_parametrer")).not.toMatch(/stock_compteurs|stock_generations|stock_parametres/);
  });
  it("insertion avec « returning » sur les tables à policy d'écriture directe : sa lecture ne dépend pas de la table elle-même", () => {
    // stock_parametres s'écrit par upsert (RLS) : sa policy de lecture ne doit relire aucune table du stock.
    const lecture = policies.get("stock_parametres: read within organization")!.using;
    expect(lecture).toMatch(/^\s*organization_id = public\.current_organization_id\(\) and public\.stock_peut_lire\(\)\s*$/);
  });
});

describe("colonnes et contraintes en phase avec le code TypeScript", () => {
  const sql = code(SCHEMA);
  const liste = (re: RegExp) => [...(re.exec(sql)?.[1] ?? "").matchAll(/'([a-z_0-9]+)'/g)].map((m) => m[1]!);
  it("nature, température, format d'étiquette, profil : mêmes listes que le code", () => {
    expect(liste(/add column if not exists nature text\s+check \(nature is null or nature in \(([^)]*)\)/)).toEqual([...NATURES]);
    expect(liste(/add column if not exists temperature text\s+check \(temperature is null or temperature in \(([^)]*)\)/)).toEqual([...TEMPERATURES]);
    expect(liste(/format_etiquette in \(([^)]*)\)/)).toEqual([...FORMATS_ETIQUETTE]);
    expect(liste(/alter table public\.stock_unites add column if not exists profil text\s+check \(profil is null or profil in \(([^)]*)\)/)).toEqual([...PROFILS]);
    expect(liste(/alter table public\.stock_articles add column if not exists profil text\s+check \(profil is null or profil in \(([^)]*)\)/)).toEqual([...PROFILS]);
  });
  it("limites : consigne 120, libellés libres 60, référence client 60, préfixe 2 à 6 caractères A-Z0-9, température relevée -100 à 100", () => {
    expect(sql).toMatch(/consigne text\s+check \(consigne is null or char_length\(consigne\) <= 120\)/);
    expect(sql).toMatch(/nature_libelle text\s+check \(nature_libelle is null or char_length\(nature_libelle\) <= 60\)/);
    expect(sql).toMatch(/temperature_libelle text\s+check \(temperature_libelle is null or char_length\(temperature_libelle\) <= 60\)/);
    expect(sql).toMatch(/reference_client text\s+check \(reference_client is null or char_length\(reference_client\) <= 60\)/);
    expect(sql).toMatch(/prefixe_code text\s+check \(prefixe_code is null or prefixe_code ~ '\^\[A-Z0-9\]\{2,6\}\$'\)/);
    expect(sql).toMatch(/temperature_releve numeric\(5, 1\)\s+check \(temperature_releve is null or \(temperature_releve >= -100 and temperature_releve <= 100\)\)/);
  });
  it("profils_config : contraintes de forme (objet, taille bornée, version 1, actifs en tableau, profils en objet)", () => {
    expect(sql).toMatch(/profils_config jsonb not null default '\{\}'::jsonb\s+check \(/);
    for (const k of ["jsonb_typeof(profils_config) = 'object'", "length(profils_config::text) <= 30000", "profils_config->'version' = '1'::jsonb", "jsonb_typeof(profils_config->'actifs') = 'array'", "jsonb_typeof(profils_config->'profils') = 'object'"]) expect(sql, k).toContain(k);
  });
  it("les anciennes contraintes ne sont pas touchées (colonne profils à trois familles)", () => {
    expect(code("20261114000001_stock_schema.sql")).toMatch(/profils <@ array\['messagerie', 'palettes', 'vrac'\]/);
    expect(sql).not.toMatch(/profils <@/);
  });
  it("les clés d'attributs acceptées par la fonction SQL sont celles du schéma zod", () => {
    const f = bloc(code(FONCTIONS), "stock__verifier_attributs");
    const cles = [...(/k not in \(([^)]*)\)/.exec(f)?.[1] ?? "").matchAll(/'([a-z_]+)'/g)].map((m) => m[1]!);
    expect(cles.sort()).toEqual(Object.keys(schemaAttributs.shape).sort());
  });
  it("champs obligatoires par défaut du catalogue = ceux de la fonction SQL", () => {
    const f = bloc(code(FONCTIONS), "stock__champs_requis");
    const defauts = Object.fromEntries([...f.matchAll(/when '(\w+)' then array\[([^\]]*)\]/g)].map((m) => [m[1]!, [...m[2]!.matchAll(/'(\w+)'/g)].map((x) => x[1]!)]));
    for (const cle of PROFILS) {
      const requis = Object.entries(DEFINITION_PROFILS[cle].champs).filter(([, m]) => m === "requis").map(([c]) => c);
      expect((defauts[cle] ?? []).sort(), cle).toEqual(requis.sort());
    }
    for (const c of CHAMPS_OUI_NON) expect(f).toContain(`'${c}'`); // jamais obligatoires
  });
  it("préfixe par défaut : mêmes mots écartés dans le TypeScript et dans SQL", () => {
    const sqlMots = [...(/m <> all \(array\[([^\]]*)\]/.exec(bloc(code(FONCTIONS), "stock__prefixe_defaut"))?.[1] ?? "").matchAll(/'(\w+)'/g)].map((m) => m[1]!);
    const ts = readFileSync("lib/stock/codes.ts", "utf8");
    const tsMots = [...(/new Set\(\[([^\]]*)\]\)/.exec(ts)?.[1] ?? "").matchAll(/"(\w+)"/g)].map((m) => m[1]!);
    expect(sqlMots.sort()).toEqual(tsMots.sort());
    expect(bloc(code(FONCTIONS), "stock__prefixe_defaut")).toContain("return 'STK'");
  });
});

describe("fonctions : sécurité", () => {
  const sql = code(FONCTIONS);
  const publiques = ["stock_generer_codes", "stock_definir_prefixe", "stock_enregistrer_mouvement_v2", "stock_modifier_unite"];
  const internes = ["stock__prefixe_defaut", "stock__prefixe_org", "stock__verifier_attributs", "stock__champs_requis", "stock__champ_renseigne"];
  it("fonctions appelables : security definer, search_path fixé, exécution retirée à public et anon, donnée à authenticated", () => {
    for (const nom of publiques) {
      const i = sql.indexOf(`function public.${nom}(`);
      const entete = sql.slice(i, sql.indexOf("as $$", i));
      expect(entete, nom).toMatch(/security definer/);
      expect(entete, nom).toMatch(/set search_path = public/);
      expect(sql, nom).toMatch(new RegExp(`revoke all on function public\\.${nom}\\([^)]*\\) from public, anon;`));
      expect(sql, nom).toMatch(new RegExp(`grant execute on function public\\.${nom}\\([^)]*\\) to authenticated;`));
    }
  });
  it("fonctions internes : aucune exécution pour les clients", () => {
    for (const nom of internes) expect(sql, nom).toMatch(new RegExp(`revoke all on function public\\.${nom}\\([^)]*\\) from public, anon, authenticated;`));
    expect(sql).not.toMatch(/grant execute on function public\.stock__/);
  });
  it("chaque fonction appelable revérifie l'authentification, le module actif et le rôle (stock__contexte)", () => {
    for (const nom of publiques) {
      const corps = bloc(sql, nom);
      expect(corps, nom).toContain("public.stock__contexte()");
      expect(corps, nom).toContain("stock_role_refuse");
    }
  });
  it("rôles : générer et enregistrer = chauffeur et au-dessus ; préfixe = exploitation et direction ; modifier = encadrement", () => {
    expect(bloc(sql, "stock_generer_codes")).toMatch(/c\.o_role not in \('chauffeur', 'manager', 'manager_chauffeur', 'exploitation', 'direction'\)/);
    expect(bloc(sql, "stock_definir_prefixe")).toMatch(/c\.o_role not in \('exploitation', 'direction'\)/);
    expect(bloc(sql, "stock_modifier_unite")).toMatch(/c\.o_role not in \('manager', 'manager_chauffeur', 'exploitation', 'direction'\)/);
    expect(bloc(sql, "stock_enregistrer_mouvement_v2")).toMatch(/p_type = 'ajustement' and c\.o_role = 'chauffeur'/);
    expect(bloc(sql, "stock_enregistrer_mouvement_v2")).toMatch(/c\.o_role not in \('chauffeur', 'manager', 'manager_chauffeur', 'exploitation', 'direction'\)/);
  });
  it("un manager n'agit que dans ses dépôts (stock__site_autorise)", () => {
    expect(bloc(sql, "stock_enregistrer_mouvement_v2")).toContain("public.stock__site_autorise(c.o_org, c.o_role, p_site)");
    expect(bloc(sql, "stock_modifier_unite")).toContain("public.stock__site_autorise(c.o_org, c.o_role, v_unite.site_id)");
  });
});

describe("génération de codes : atomique, limitée, idempotente, sans collision", () => {
  const f = bloc(code(FONCTIONS), "stock_generer_codes");
  it("limite de 500 codes par appel (même valeur que le code TypeScript)", () => {
    expect(CODES_MAX_PAR_APPEL).toBe(500);
    expect(f).toMatch(/if p_nombre > 500 then\s+raise exception 'stock_limite_depassee'/);
    expect(f).toMatch(/p_nombre is null or p_nombre < 1/);
  });
  it("compteur incrémenté par UNE instruction « insert … on conflict do update » (atomique), par organisation et par année de Paris", () => {
    expect(f).toMatch(/insert into public\.stock_compteurs \(organization_id, annee, dernier\)\s+values \(c\.o_org, v_annee, v_besoin\)\s+on conflict \(organization_id, annee\) do update set dernier = public\.stock_compteurs\.dernier \+ v_besoin/);
    expect(f).toMatch(/returning dernier into v_dernier/);
    expect(f).toContain("now() at time zone 'Europe/Paris'");
    expect(f).not.toMatch(/select\s+dernier[^;]*from public\.stock_compteurs/); // jamais « lire puis écrire »
  });
  it("format PREFIXE-AAAA-NNNNNN et dépassement du compteur refusé", () => {
    expect(f).toContain("v_prefixe || '-' || v_annee::text || '-' || lpad(v_n::text, 6, '0')");
    expect(f).toMatch(/exception when check_violation then\s+raise exception 'stock_compteur_epuise'/);
  });
  it("collision avec un code déjà saisi (code principal ou interne) : numéro sauté, nombre demandé respecté", () => {
    expect(f).toMatch(/not exists \(select 1 from public\.stock_unites u where u\.organization_id = c\.o_org and \(u\.code = v_code or u\.code_interne = v_code\)\)/);
    expect(f).toMatch(/v_besoin := p_nombre - cardinality\(v_codes\);\s+exit when v_besoin <= 0;/);
  });
  it("idempotence par clé : la clé connue renvoie les mêmes codes, avant toute écriture, sous verrou", () => {
    expect(f.indexOf("pg_advisory_xact_lock")).toBeLessThan(f.indexOf("from public.stock_generations where organization_id = c.o_org and cle = p_cle"));
    expect(f.indexOf("'doublon', true")).toBeLessThan(f.indexOf("insert into public.stock_compteurs"));
    expect(f).toMatch(/insert into public\.stock_generations/);
  });
  it("préfixe : enregistré au premier usage (défaut dérivé du nom), modifiable ensuite sans toucher aux anciens codes", () => {
    const org = bloc(code(FONCTIONS), "stock__prefixe_org");
    expect(org).toContain("stock__prefixe_defaut(v_nom)");
    expect(org).toMatch(/on conflict \(organization_id\) do update set prefixe_code = coalesce\(public\.stock_parametres\.prefixe_code, excluded\.prefixe_code\)/);
    const def = bloc(code(FONCTIONS), "stock_definir_prefixe");
    expect(def).toContain("'stock_prefixe_invalide'");
    expect(def).not.toMatch(/stock_compteurs|stock_generations\s+set|update public\.stock_unites/);
  });
});

describe("résolution et unicité des codes", () => {
  const sql = code(FONCTIONS);
  const v2 = bloc(sql, "stock_enregistrer_mouvement_v2");
  it("le scan résout le code principal OU le code interne", () => {
    expect(v2).toMatch(/where organization_id = c\.o_org and \(code = v_code or code_interne = v_code\)/);
    expect(v2).toMatch(/v_code := v_unite\.code/);
  });
  it("un code externe égal au code interne d'une autre unité est refusé, comme l'inverse", () => {
    expect(v2).toMatch(/u\.id is distinct from v_unite\.id and \(u\.code = v_interne or u\.code_interne = v_interne\)\)\s+then\s+raise exception 'stock_code_ambigu'/);
    const trig = bloc(code(SCHEMA), "stock_unites_codes_coherents");
    expect(trig).toMatch(/u\.code = new\.code_interne\)\s+then\s+raise exception 'stock_code_ambigu'/);
    expect(trig).toMatch(/u\.code_interne = new\.code\)\s+then\s+raise exception 'stock_code_ambigu'/);
  });
  it("seuls des codes générés pour l'entreprise peuvent être rattachés comme codes internes", () => {
    expect(v2).toMatch(/v_interne = any \(g\.codes\)/);
    expect(v2).toContain("'stock_code_interne_inconnu'");
    expect(v2).toContain("'stock_code_interne_invalide'");
    expect(v2).toContain("'stock_code_interne_deja'");
  });
  it("le code principal d'une unité ne change jamais (aucune mise à jour de la colonne code)", () => {
    for (const nom of ["stock_enregistrer_mouvement_v2", "stock_modifier_unite"]) {
      const corps = bloc(sql, nom);
      const maj = corps.slice(corps.indexOf("update public.stock_unites"));
      expect(maj, nom).not.toMatch(/\bset\s+code\s*=|,\s*code\s*=/);
    }
  });
  it("entrée par scan d'un code pré-imprimé inconnu : la fonction d'origine crée l'unité avec ce code (comportement conservé)", () => {
    const origine = code("20261114000002_stock_fonctions.sql");
    expect(origine).toMatch(/if not found then\s+if p_type <> 'entree' and not \(p_type = 'ajustement' and v_sens = 1\) then\s+raise exception 'stock_unite_inconnue'/);
    expect(origine).toMatch(/insert into public\.stock_unites \(organization_id, activite, code, type_unite/);
    // La v2 lui transmet le code lu tel quel quand aucune unité ne correspond.
    expect(v2).toMatch(/v_code := btrim\(p_unite_code\);/);
    expect(v2).toMatch(/if v_unite\.id is not null then\s+v_code := v_unite\.code;/);
    expect(v2).toContain("public.stock__appliquer(");
  });
});

describe("champs obligatoires imposés par la base", () => {
  const sql = code(FONCTIONS);
  const v2 = bloc(sql, "stock_enregistrer_mouvement_v2");
  it("à l'entrée d'une unité et d'un article, par la saisie de l'application seulement", () => {
    expect(v2).toMatch(/if v_entree and p_source = 'app' then\s+foreach k in array public\.stock__champs_requis\(c\.o_org, p_profil\) loop/);
    expect(v2).toContain("raise exception 'stock_champ_requis_%', k");
    expect(v2).toMatch(/elsif v_entree and p_source = 'app' then[\s\S]*k = 'lot' and coalesce\(btrim\(p_lot\), ''\) = ''[\s\S]*k = 'dlc' and p_dlc is null/);
  });
  it("une valeur déjà enregistrée sur l'unité compte (ré-entrée d'une unité connue)", () => {
    const f = bloc(sql, "stock__champ_renseigne");
    for (const champ of ["poids", "volume", "sscc", "lot", "dlc", "temperature", "temperature_releve", "nature", "consigne", "reference_client"]) expect(f, champ).toContain(`when '${champ}'`);
    expect(f).toContain("p_unite.poids_kg");
    expect(f).toContain("p_unite.temperature");
  });
  it("la modification d'une unité ne peut pas effacer un champ obligatoire de son profil", () => {
    const f = bloc(sql, "stock_modifier_unite");
    expect(f).toMatch(/foreach k in array public\.stock__champs_requis\(c\.o_org, v_unite\.profil\) loop/);
    expect(f).toContain("raise exception 'stock_champ_requis_%', k");
  });
  it("les attributs ne s'écrivent qu'à l'entrée (aucun changement d'attribut par une sortie ou un transfert)", () => {
    expect(v2).toMatch(/not coalesce\(\(v_res->>'doublon'\)::boolean, false\) and v_entree then\s+update public\.stock_unites/);
  });
  it("idempotence : une clé déjà connue ne modifie ni attributs ni code interne", () => {
    expect(v2.indexOf("'doublon', true")).toBeLessThan(v2.indexOf("stock__verifier_attributs"));
    expect(v2.indexOf("'doublon', true")).toBeLessThan(v2.indexOf("public.stock__appliquer("));
  });
});

describe("alerte DLC proche : policies qui gardent TOUS les types existants", () => {
  const avant = code("20261114000004_alerte_stock_lecture.sql");
  const apres = code(LECTURE);
  const types = (sql: string) => [...new Set([...sql.matchAll(/type::text not in \(([^)]*)\)/g)].flatMap((m) => [...m[1]!.matchAll(/'(\w+)'/g)].map((x) => x[1]!)))];
  it("les deux policies sont redéclarées (alter policy) et la liste ne perd aucun type", () => {
    expect(apres.match(/alter policy "alerts: read within org for manager-like and comptable"/g)).toHaveLength(1);
    expect(apres.match(/alter policy "alerts: manager-like can acknowledge"/g)).toHaveLength(1);
    const anciens = types(avant);
    expect(anciens).toEqual(expect.arrayContaining(["tournee_retard", "tournee_non_demarree", "tournee_sans_chauffeur", "echeance_vehicule", "echeance_rh", "pointage_a_regulariser", "paiement_echoue", "planning_a_confirmer", "planning_fusion", "stock_seuil", "stock_ecart", "stock_non_rentre"]));
    for (const t of anciens) expect(types(apres), t).toContain(t);
    expect(types(apres)).toContain("stock_dlc_proche");
    expect(types(apres)).toHaveLength(anciens.length + 1);
  });
  it("chaque occurrence de la liste porte le nouveau type", () => {
    const listes = [...apres.matchAll(/type::text not in \(([^)]*)\)/g)].map((m) => m[1]!);
    expect(listes).toHaveLength(3);
    for (const l of listes) expect(l).toContain("'stock_dlc_proche'");
  });
  it("même structure que la version précédente, au type près", () => {
    const norm = (s: string) => s.replace(/, 'stock_dlc_proche'/g, "").replace(/\s+/g, " ");
    expect(norm(apres.slice(apres.indexOf("alter policy")))).toBe(norm(avant.slice(avant.indexOf("alter policy"))));
  });
});
