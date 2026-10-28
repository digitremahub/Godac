-- Module « Stock » : fonctions SQL des codes internes, des attributs et des profils
-- (suite de 20261115000001).
--
--   stock__prefixe_defaut         interne : préfixe dérivé du nom de l'entreprise
--   stock__prefixe_org            interne : préfixe de l'organisation (défaut enregistré au premier usage)
--   stock_generer_codes           N codes internes uniques (compteur atomique, limite 500, idempotence par clé)
--   stock_definir_prefixe         préfixe des codes (exploitation, direction)
--   stock__verifier_attributs     interne : forme des attributs reçus
--   stock__champs_requis          interne : champs obligatoires d'un profil (défauts du catalogue + profils_config)
--   stock_enregistrer_mouvement_v2  mouvement avec code interne complémentaire, profil et attributs
--   stock_modifier_unite          modification des attributs d'une unité existante (encadrement)
--
-- Toutes les fonctions publiques sont « security definer » : elles revérifient
-- l'authentification, l'activation du module, le rôle et le périmètre de service
-- (stock__contexte, stock__site_autorise de 20261114000002). Erreurs : codes
-- « stock_xxx », traduits en français par lib/stock/erreurs.ts. Un champ
-- obligatoire manquant lève « stock_champ_requis_<champ> ».
--
-- Pourquoi « _v2 » : stock_enregistrer_mouvement (20261114000002) garde sa signature
-- (les liens avec les tournées l'appellent) ; ajouter des paramètres sous le même nom
-- créerait une surcharge ambiguë pour l'API. v2 contrôle, puis délègue à stock__appliquer
-- (inchangée) dans la même transaction.
--
-- ADDITIVE et rejouable (create or replace). Aucune suppression de données.

-- ── 1. Préfixe ─────────────────────────────────────────────────────────

-- Même logique que prefixeParDefaut (lib/stock/codes.ts) : initiales de 2 à 3 mots
-- significatifs, sinon 3 premières lettres du seul mot, secours « STK ».
create or replace function public.stock__prefixe_defaut(p_nom text)
returns text
language plpgsql
immutable
set search_path = public
as $$
declare
  v_texte text;
  v_mots text[];
  v_res text := '';
begin
  v_texte := upper(translate(lower(coalesce(p_nom, '')), 'àâäáãåçéèêëíìîïñóòôöõúùûüýÿ', 'aaaaaaceeeeiiiinooooouuuuyy'));
  v_texte := btrim(regexp_replace(v_texte, '[^A-Z0-9]+', ' ', 'g'));
  select array_agg(m order by ord) into v_mots
    from unnest(string_to_array(v_texte, ' ')) with ordinality as t(m, ord)
   where m <> '' and m <> all (array['DE', 'DU', 'DES', 'LA', 'LE', 'LES', 'ET', 'AU', 'AUX', 'SA', 'SAS', 'SASU', 'SARL', 'EURL', 'SCOP', 'GROUPE', 'STE', 'SOCIETE', 'ETS', 'ETABLISSEMENTS', 'THE', 'AND', 'LTD', 'GMBH']);
  if coalesce(cardinality(v_mots), 0) >= 2 then
    select string_agg(left(x.m, 1), '' order by x.ord) into v_res
      from (select m, ord from unnest(v_mots) with ordinality as t(m, ord) order by ord limit 3) x;
  elsif coalesce(cardinality(v_mots), 0) = 1 then
    v_res := left(v_mots[1], 3);
  end if;
  if char_length(coalesce(v_res, '')) < 2 then
    return 'STK';
  end if;
  return v_res;
end;
$$;

revoke all on function public.stock__prefixe_defaut(text) from public, anon, authenticated;

-- Préfixe de l'organisation ; à défaut, le préfixe par défaut est ENREGISTRÉ (il reste stable ensuite).
create or replace function public.stock__prefixe_org(p_org uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_prefixe text;
  v_nom text;
begin
  select prefixe_code into v_prefixe from public.stock_parametres where organization_id = p_org;
  if v_prefixe is null then
    select name into v_nom from public.organizations where id = p_org;
    insert into public.stock_parametres (organization_id, prefixe_code)
    values (p_org, public.stock__prefixe_defaut(v_nom))
    on conflict (organization_id) do update set prefixe_code = coalesce(public.stock_parametres.prefixe_code, excluded.prefixe_code), updated_at = now()
    returning prefixe_code into v_prefixe;
  end if;
  return v_prefixe;
end;
$$;

revoke all on function public.stock__prefixe_org(uuid) from public, anon, authenticated;

-- ── 2. Génération de codes ─────────────────────────────────────────────

-- Renvoie p_nombre codes PREFIXE-AAAA-NNNNNN uniques. Le compteur (organisation,
-- année de Paris) est incrémenté par une seule instruction « insert … on conflict
-- do update » : deux appels simultanés ne reçoivent jamais le même numéro. Les
-- numéros dont le code existe déjà (code saisi à la main) sont sautés. Une clé
-- d'idempotence déjà connue renvoie les mêmes codes sans toucher au compteur.
-- Chauffeur et au-dessus (codes d'avance sur le terrain) ; comptable exclu.
create or replace function public.stock_generer_codes(p_nombre integer, p_cle text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  c record;
  v_exist public.stock_generations%rowtype;
  v_annee integer;
  v_prefixe text;
  v_codes text[] := '{}';
  v_besoin integer;
  v_dernier integer;
  v_n integer;
  v_code text;
begin
  select * into c from public.stock__contexte();
  if c.o_role not in ('chauffeur', 'manager', 'manager_chauffeur', 'exploitation', 'direction') then
    raise exception 'stock_role_refuse' using errcode = 'P0001';
  end if;
  if p_nombre is null or p_nombre < 1 then
    raise exception 'stock_nombre_invalide' using errcode = 'P0001';
  end if;
  if p_nombre > 500 then
    raise exception 'stock_limite_depassee' using errcode = 'P0001';
  end if;
  if p_cle is not null then
    if char_length(p_cle) < 8 or char_length(p_cle) > 100 then
      raise exception 'stock_cle_invalide' using errcode = 'P0001';
    end if;
    -- Deux requêtes simultanées de même clé se suivent : la seconde relit la première.
    perform pg_advisory_xact_lock(hashtextextended(c.o_org::text || ':' || p_cle, 0));
    select * into v_exist from public.stock_generations where organization_id = c.o_org and cle = p_cle;
    if found then
      return jsonb_build_object('ok', true, 'doublon', true, 'codes', to_jsonb(v_exist.codes), 'prefixe', v_exist.prefixe, 'annee', v_exist.annee, 'nombre', v_exist.nombre);
    end if;
  end if;

  v_annee := extract(year from (now() at time zone 'Europe/Paris'))::integer;
  v_prefixe := public.stock__prefixe_org(c.o_org);
  v_besoin := p_nombre;
  loop
    begin
      insert into public.stock_compteurs (organization_id, annee, dernier)
      values (c.o_org, v_annee, v_besoin)
      on conflict (organization_id, annee) do update set dernier = public.stock_compteurs.dernier + v_besoin, updated_at = now()
      returning dernier into v_dernier;
    exception when check_violation then
      raise exception 'stock_compteur_epuise' using errcode = 'P0001';
    end;
    for v_n in (v_dernier - v_besoin + 1)..v_dernier loop
      v_code := v_prefixe || '-' || v_annee::text || '-' || lpad(v_n::text, 6, '0');
      -- Collision avec un code déjà saisi : numéro sauté.
      if not exists (select 1 from public.stock_unites u where u.organization_id = c.o_org and (u.code = v_code or u.code_interne = v_code)) then
        v_codes := array_append(v_codes, v_code);
      end if;
    end loop;
    v_besoin := p_nombre - cardinality(v_codes);
    exit when v_besoin <= 0;
  end loop;

  insert into public.stock_generations (organization_id, cle, annee, prefixe, nombre, codes, auteur_id, auteur_nom)
  values (c.o_org, coalesce(p_cle, 'auto-' || gen_random_uuid()::text), v_annee, v_prefixe, p_nombre, v_codes, c.o_user, c.o_nom);
  return jsonb_build_object('ok', true, 'doublon', false, 'codes', to_jsonb(v_codes), 'prefixe', v_prefixe, 'annee', v_annee, 'nombre', p_nombre);
end;
$$;

revoke all on function public.stock_generer_codes(integer, text) from public, anon;
grant execute on function public.stock_generer_codes(integer, text) to authenticated;

-- Préfixe des codes internes : exploitation et direction. Modifiable à tout moment ;
-- les codes déjà générés restent valides (le compteur et les unités ne changent pas).
create or replace function public.stock_definir_prefixe(p_prefixe text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  c record;
  v_prefixe text;
  v_avant text;
  v_generes boolean;
begin
  select * into c from public.stock__contexte();
  if c.o_role not in ('exploitation', 'direction') then
    raise exception 'stock_role_refuse' using errcode = 'P0001';
  end if;
  v_prefixe := upper(regexp_replace(coalesce(p_prefixe, ''), '[\s-]+', '', 'g'));
  if v_prefixe !~ '^[A-Z0-9]{2,6}$' then
    raise exception 'stock_prefixe_invalide' using errcode = 'P0001';
  end if;
  select prefixe_code into v_avant from public.stock_parametres where organization_id = c.o_org;
  insert into public.stock_parametres (organization_id, prefixe_code, updated_by)
  values (c.o_org, v_prefixe, c.o_user)
  on conflict (organization_id) do update set prefixe_code = excluded.prefixe_code, updated_by = excluded.updated_by, updated_at = now();
  select exists (select 1 from public.stock_generations g where g.organization_id = c.o_org) into v_generes;
  return jsonb_build_object('ok', true, 'prefixe', v_prefixe, 'avant', v_avant, 'codes_generes', v_generes);
end;
$$;

revoke all on function public.stock_definir_prefixe(text) from public, anon;
grant execute on function public.stock_definir_prefixe(text) to authenticated;

-- ── 3. Attributs et champs obligatoires ────────────────────────────────

create or replace function public.stock__verifier_attributs(p_attr jsonb)
returns void
language plpgsql
immutable
set search_path = public
as $$
declare
  k text;
  v jsonb;
begin
  if p_attr is null then
    return;
  end if;
  if jsonb_typeof(p_attr) <> 'object' then
    raise exception 'stock_attribut_invalide' using errcode = 'P0001';
  end if;
  for k, v in select key, value from jsonb_each(p_attr) loop
    if k not in ('nature', 'nature_libelle', 'temperature', 'temperature_libelle', 'temperature_releve', 'fragile', 'urgent', 'consigne', 'reference_client', 'lot', 'dlc') then
      raise exception 'stock_attribut_invalide' using errcode = 'P0001';
    end if;
    if k in ('fragile', 'urgent') and jsonb_typeof(v) <> 'boolean' then
      raise exception 'stock_attribut_invalide' using errcode = 'P0001';
    end if;
    if k = 'temperature_releve' and (jsonb_typeof(v) not in ('number', 'null') or (jsonb_typeof(v) = 'number' and ((v #>> '{}')::numeric < -100 or (v #>> '{}')::numeric > 100))) then
      raise exception 'stock_attribut_invalide' using errcode = 'P0001';
    end if;
    if k not in ('fragile', 'urgent', 'temperature_releve') and jsonb_typeof(v) not in ('string', 'null') then
      raise exception 'stock_attribut_invalide' using errcode = 'P0001';
    end if;
    if k = 'nature' and jsonb_typeof(v) = 'string' and (v #>> '{}') not in ('colis', 'palette', 'prelevement', 'medicament', 'alimentaire', 'pharmaceutique', 'autre') then
      raise exception 'stock_attribut_invalide' using errcode = 'P0001';
    end if;
    if k = 'temperature' and jsonb_typeof(v) = 'string' and (v #>> '{}') not in ('ambiante', 'frais', 'congele', 'autre') then
      raise exception 'stock_attribut_invalide' using errcode = 'P0001';
    end if;
    if k in ('nature_libelle', 'temperature_libelle', 'reference_client', 'lot') and jsonb_typeof(v) = 'string' and char_length(v #>> '{}') > 60 then
      raise exception 'stock_attribut_invalide' using errcode = 'P0001';
    end if;
    if k = 'consigne' and jsonb_typeof(v) = 'string' and char_length(v #>> '{}') > 120 then
      raise exception 'stock_attribut_invalide' using errcode = 'P0001';
    end if;
    if k = 'dlc' and jsonb_typeof(v) = 'string' and (v #>> '{}') !~ '^\d{4}-\d{2}-\d{2}$' then
      raise exception 'stock_attribut_invalide' using errcode = 'P0001';
    end if;
  end loop;
end;
$$;

revoke all on function public.stock__verifier_attributs(jsonb) from public, anon, authenticated;

-- Champs obligatoires d'un profil : valeurs par défaut du catalogue (lib/stock/profils.ts,
-- comparées dans les tests) puis ajustements de l'entreprise (profils_config->'profils'->profil->'champs').
-- Un champ « requis » est obligatoire ; « affiche » ou « masque » lève l'obligation par défaut.
-- Les champs oui / non (fragile, urgent) ne sont jamais obligatoires.
create or replace function public.stock__champs_requis(p_org uuid, p_profil text)
returns text[]
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_res text[];
  v_champs jsonb;
  k text;
  v text;
begin
  v_res := case p_profil
    when 'sante' then array['temperature']
    when 'pharmacie' then array['lot', 'dlc']
    when 'alimentaire' then array['lot', 'dlc']
    else array[]::text[]
  end;
  select profils_config->'profils'->p_profil->'champs' into v_champs from public.stock_parametres where organization_id = p_org;
  if v_champs is not null and jsonb_typeof(v_champs) = 'object' then
    for k, v in select key, value #>> '{}' from jsonb_each(v_champs) loop
      v_res := array_remove(v_res, k);
      if v = 'requis' and k not in ('fragile', 'urgent') then
        v_res := array_append(v_res, k);
      end if;
    end loop;
  end if;
  return v_res;
end;
$$;

revoke all on function public.stock__champs_requis(uuid, text) from public, anon, authenticated;

-- Le champ obligatoire est-il renseigné (valeur reçue, sinon valeur déjà enregistrée) ?
create or replace function public.stock__champ_renseigne(p_champ text, p_attr jsonb, p_unite public.stock_unites, p_poids numeric, p_volume numeric, p_sscc text)
returns boolean
language sql
immutable
set search_path = public
as $$
  select case p_champ
    when 'poids' then coalesce(p_poids, p_unite.poids_kg) is not null
    when 'volume' then coalesce(p_volume, p_unite.volume_m3) is not null
    when 'sscc' then coalesce(nullif(btrim(coalesce(p_sscc, '')), ''), p_unite.sscc) is not null
    when 'lot' then coalesce(nullif(btrim(coalesce(p_attr->>'lot', '')), ''), p_unite.lot) is not null
    when 'dlc' then coalesce(nullif(p_attr->>'dlc', ''), p_unite.dlc::text) is not null
    when 'temperature' then coalesce(nullif(p_attr->>'temperature', ''), p_unite.temperature) is not null
    when 'temperature_releve' then coalesce(nullif(p_attr->>'temperature_releve', ''), p_unite.temperature_releve::text) is not null
    when 'nature' then coalesce(nullif(p_attr->>'nature', ''), p_unite.nature) is not null
    when 'consigne' then coalesce(nullif(btrim(coalesce(p_attr->>'consigne', '')), ''), p_unite.consigne) is not null
    when 'reference_client' then coalesce(nullif(btrim(coalesce(p_attr->>'reference_client', '')), ''), p_unite.reference_client) is not null
    else true
  end;
$$;

revoke all on function public.stock__champ_renseigne(text, jsonb, public.stock_unites, numeric, numeric, text) from public, anon, authenticated;

-- ── 4. Mouvement avec code interne, profil et attributs ────────────────

create or replace function public.stock_enregistrer_mouvement_v2(
  p_cle text,
  p_type text,
  p_site uuid,
  p_unite_code text default null,
  p_type_unite text default null,
  p_article uuid default null,
  p_quantite numeric default 1,
  p_src uuid default null,
  p_dest uuid default null,
  p_lot text default null,
  p_dlc date default null,
  p_sens integer default null,
  p_statut_apres text default null,
  p_motif text default null,
  p_run uuid default null,
  p_stop uuid default null,
  p_poids numeric default null,
  p_volume numeric default null,
  p_sscc text default null,
  p_source text default 'app',
  p_profil text default null,
  p_code_interne text default null,
  p_attributs jsonb default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  c record;
  v_exist public.stock_mouvements%rowtype;
  v_unite public.stock_unites%rowtype;
  v_code text;
  v_interne text := nullif(btrim(coalesce(p_code_interne, '')), '');
  v_attr jsonb := coalesce(p_attributs, '{}'::jsonb);
  v_entree boolean := coalesce((p_type = 'entree') or (p_type = 'ajustement' and p_sens = 1), false);
  v_requis text[];
  k text;
  v_res jsonb;
  v_unite_id uuid;
begin
  select * into c from public.stock__contexte();
  if c.o_role not in ('chauffeur', 'manager', 'manager_chauffeur', 'exploitation', 'direction') then
    raise exception 'stock_role_refuse' using errcode = 'P0001';
  end if;
  if p_type = 'ajustement' and c.o_role = 'chauffeur' then
    raise exception 'stock_role_refuse' using errcode = 'P0001';
  end if;
  if p_cle is null or char_length(p_cle) < 8 or char_length(p_cle) > 100 then
    raise exception 'stock_cle_invalide' using errcode = 'P0001';
  end if;
  if p_source not in ('app', 'tournee') then
    raise exception 'stock_source_invalide' using errcode = 'P0001';
  end if;
  if p_site is null or not public.stock__site_autorise(c.o_org, c.o_role, p_site) then
    raise exception 'stock_site_invalide' using errcode = 'P0001';
  end if;
  if p_profil is not null and p_profil not in ('messagerie', 'palettes', 'sante', 'pharmacie', 'alimentaire', 'vrac', 'personnalise') then
    raise exception 'stock_profil_invalide' using errcode = 'P0001';
  end if;

  -- Idempotence : clé déjà enregistrée = rien à refaire (ni attributs, ni code interne).
  select * into v_exist from public.stock_mouvements where organization_id = c.o_org and cle_idempotence = p_cle;
  if found then
    return jsonb_build_object('ok', true, 'doublon', true, 'mouvement_id', v_exist.id, 'unite_id', v_exist.unite_id, 'statut', v_exist.statut_apres);
  end if;

  perform public.stock__verifier_attributs(v_attr);

  if p_unite_code is not null then
    -- Le scan résout le code principal OU le code interne complémentaire.
    v_code := btrim(p_unite_code);
    select * into v_unite from public.stock_unites
     where organization_id = c.o_org and (code = v_code or code_interne = v_code)
     order by (code = v_code) desc
     limit 1;
    if v_unite.id is not null then
      v_code := v_unite.code;
    end if;
    if v_interne is not null and v_interne <> v_code then
      if not v_entree then
        raise exception 'stock_code_interne_entree_seulement' using errcode = 'P0001';
      end if;
      if v_interne !~ '^[A-Z0-9]{2,6}-[0-9]{4}-[0-9]{6}$' then
        raise exception 'stock_code_interne_invalide' using errcode = 'P0001';
      end if;
      -- Seuls les codes générés pour cette organisation sont acceptés comme codes internes.
      if not exists (select 1 from public.stock_generations g where g.organization_id = c.o_org and v_interne = any (g.codes)) then
        raise exception 'stock_code_interne_inconnu' using errcode = 'P0001';
      end if;
      -- Aucune ambiguïté : ce code ne doit désigner aucune AUTRE unité (code principal ou interne).
      if exists (select 1 from public.stock_unites u where u.organization_id = c.o_org and u.id is distinct from v_unite.id and (u.code = v_interne or u.code_interne = v_interne)) then
        raise exception 'stock_code_ambigu' using errcode = 'P0001';
      end if;
      if v_unite.code_interne is not null and v_unite.code_interne <> v_interne then
        raise exception 'stock_code_interne_deja' using errcode = 'P0001';
      end if;
    elsif v_interne = v_code then
      v_interne := null;
    end if;
    -- Champs obligatoires du profil (entrée uniquement, saisie par l'application).
    if v_entree and p_source = 'app' then
      foreach k in array public.stock__champs_requis(c.o_org, p_profil) loop
        if not public.stock__champ_renseigne(k, v_attr, v_unite, p_poids, p_volume, p_sscc) then
          raise exception 'stock_champ_requis_%', k using errcode = 'P0001';
        end if;
      end loop;
    end if;
  elsif v_entree and p_source = 'app' then
    -- Article : lot et DLC obligatoires selon le profil.
    foreach k in array public.stock__champs_requis(c.o_org, p_profil) loop
      if (k = 'lot' and coalesce(btrim(p_lot), '') = '') or (k = 'dlc' and p_dlc is null) then
        raise exception 'stock_champ_requis_%', k using errcode = 'P0001';
      end if;
    end loop;
  end if;

  v_res := public.stock__appliquer(
    c.o_org, c.o_user, c.o_nom, p_cle, p_type, p_sens, v_code, p_type_unite, p_poids, p_volume, p_sscc,
    p_article, p_quantite, p_site, p_src, p_dest, p_lot, p_dlc, p_statut_apres, p_motif, p_run, p_stop, null, p_source
  );

  v_unite_id := nullif(v_res->>'unite_id', '')::uuid;
  if v_unite_id is not null and not coalesce((v_res->>'doublon')::boolean, false) and v_entree then
    update public.stock_unites
       set code_interne = coalesce(code_interne, v_interne),
           profil = coalesce(p_profil, profil),
           nature = case when jsonb_exists(v_attr, 'nature') then v_attr->>'nature' else nature end,
           nature_libelle = case when jsonb_exists(v_attr, 'nature_libelle') then nullif(btrim(v_attr->>'nature_libelle'), '') else nature_libelle end,
           temperature = case when jsonb_exists(v_attr, 'temperature') then v_attr->>'temperature' else temperature end,
           temperature_libelle = case when jsonb_exists(v_attr, 'temperature_libelle') then nullif(btrim(v_attr->>'temperature_libelle'), '') else temperature_libelle end,
           temperature_releve = case when jsonb_exists(v_attr, 'temperature_releve') then (v_attr->>'temperature_releve')::numeric else temperature_releve end,
           fragile = case when jsonb_exists(v_attr, 'fragile') then (v_attr->>'fragile')::boolean else fragile end,
           urgent = case when jsonb_exists(v_attr, 'urgent') then (v_attr->>'urgent')::boolean else urgent end,
           consigne = case when jsonb_exists(v_attr, 'consigne') then nullif(btrim(v_attr->>'consigne'), '') else consigne end,
           reference_client = case when jsonb_exists(v_attr, 'reference_client') then nullif(btrim(v_attr->>'reference_client'), '') else reference_client end,
           lot = case when jsonb_exists(v_attr, 'lot') then nullif(btrim(v_attr->>'lot'), '') else lot end,
           dlc = case when jsonb_exists(v_attr, 'dlc') then (v_attr->>'dlc')::date else dlc end,
           updated_at = now()
     where id = v_unite_id and organization_id = c.o_org;
    v_res := v_res || jsonb_build_object('code', (select u.code from public.stock_unites u where u.id = v_unite_id), 'code_interne', (select u.code_interne from public.stock_unites u where u.id = v_unite_id));
  end if;
  return v_res;
end;
$$;

revoke all on function public.stock_enregistrer_mouvement_v2(text, text, uuid, text, text, uuid, numeric, uuid, uuid, text, date, integer, text, text, uuid, uuid, numeric, numeric, text, text, text, text, jsonb) from public, anon;
grant execute on function public.stock_enregistrer_mouvement_v2(text, text, uuid, text, text, uuid, numeric, uuid, uuid, text, date, integer, text, text, uuid, uuid, numeric, numeric, text, text, text, text, jsonb) to authenticated;

-- ── 5. Modification des attributs d'une unité existante ────────────────

-- Encadrement (manager dans ses services, exploitation, direction). Les clés
-- absentes ne changent pas ; une clé à null efface la valeur (refusé si le champ
-- est obligatoire pour le profil de l'unité). Le code principal ne change jamais.
create or replace function public.stock_modifier_unite(p_unite uuid, p_attributs jsonb default null, p_code_interne text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  c record;
  v_unite public.stock_unites%rowtype;
  v_attr jsonb := coalesce(p_attributs, '{}'::jsonb);
  v_interne text := nullif(btrim(coalesce(p_code_interne, '')), '');
  k text;
begin
  select * into c from public.stock__contexte();
  if c.o_role not in ('manager', 'manager_chauffeur', 'exploitation', 'direction') then
    raise exception 'stock_role_refuse' using errcode = 'P0001';
  end if;
  select * into v_unite from public.stock_unites where id = p_unite and organization_id = c.o_org for update;
  if not found then
    raise exception 'stock_unite_inconnue' using errcode = 'P0001';
  end if;
  if v_unite.site_id is not null and not public.stock__site_autorise(c.o_org, c.o_role, v_unite.site_id) then
    raise exception 'stock_site_invalide' using errcode = 'P0001';
  end if;
  perform public.stock__verifier_attributs(v_attr);

  if v_interne is not null and v_interne <> v_unite.code then
    if v_interne !~ '^[A-Z0-9]{2,6}-[0-9]{4}-[0-9]{6}$' then
      raise exception 'stock_code_interne_invalide' using errcode = 'P0001';
    end if;
    if not exists (select 1 from public.stock_generations g where g.organization_id = c.o_org and v_interne = any (g.codes)) then
      raise exception 'stock_code_interne_inconnu' using errcode = 'P0001';
    end if;
    if exists (select 1 from public.stock_unites u where u.organization_id = c.o_org and u.id <> v_unite.id and (u.code = v_interne or u.code_interne = v_interne)) then
      raise exception 'stock_code_ambigu' using errcode = 'P0001';
    end if;
    if v_unite.code_interne is not null and v_unite.code_interne <> v_interne then
      raise exception 'stock_code_interne_deja' using errcode = 'P0001';
    end if;
  elsif v_interne = v_unite.code then
    v_interne := null;
  end if;

  -- Un champ obligatoire du profil ne peut pas être effacé.
  foreach k in array public.stock__champs_requis(c.o_org, v_unite.profil) loop
    if jsonb_exists(v_attr, k) and (jsonb_typeof(v_attr->k) = 'null' or nullif(btrim(v_attr->>k), '') is null) then
      raise exception 'stock_champ_requis_%', k using errcode = 'P0001';
    end if;
  end loop;

  update public.stock_unites
     set code_interne = coalesce(code_interne, v_interne),
         nature = case when jsonb_exists(v_attr, 'nature') then v_attr->>'nature' else nature end,
         nature_libelle = case when jsonb_exists(v_attr, 'nature_libelle') then nullif(btrim(v_attr->>'nature_libelle'), '') else nature_libelle end,
         temperature = case when jsonb_exists(v_attr, 'temperature') then v_attr->>'temperature' else temperature end,
         temperature_libelle = case when jsonb_exists(v_attr, 'temperature_libelle') then nullif(btrim(v_attr->>'temperature_libelle'), '') else temperature_libelle end,
         temperature_releve = case when jsonb_exists(v_attr, 'temperature_releve') then (v_attr->>'temperature_releve')::numeric else temperature_releve end,
         fragile = case when jsonb_exists(v_attr, 'fragile') then (v_attr->>'fragile')::boolean else fragile end,
         urgent = case when jsonb_exists(v_attr, 'urgent') then (v_attr->>'urgent')::boolean else urgent end,
         consigne = case when jsonb_exists(v_attr, 'consigne') then nullif(btrim(v_attr->>'consigne'), '') else consigne end,
         reference_client = case when jsonb_exists(v_attr, 'reference_client') then nullif(btrim(v_attr->>'reference_client'), '') else reference_client end,
         lot = case when jsonb_exists(v_attr, 'lot') then nullif(btrim(v_attr->>'lot'), '') else lot end,
         dlc = case when jsonb_exists(v_attr, 'dlc') then (v_attr->>'dlc')::date else dlc end,
         updated_at = now()
   where id = v_unite.id and organization_id = c.o_org;
  return jsonb_build_object('ok', true, 'unite_id', v_unite.id);
end;
$$;

revoke all on function public.stock_modifier_unite(uuid, jsonb, text) from public, anon;
grant execute on function public.stock_modifier_unite(uuid, jsonb, text) to authenticated;

notify pgrst, 'reload schema';
