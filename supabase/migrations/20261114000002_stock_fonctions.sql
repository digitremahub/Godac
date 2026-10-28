-- Module « Stock » : fonctions SQL transactionnelles (suite de 20261114000001).
--
--   stock_transition_autorisee   transitions de statut d'une unité (miroir de lib/stock/transitions.ts)
--   stock__appliquer             interne : écrit le registre, les soldes ou l'unité, dans UNE transaction
--   stock_enregistrer_mouvement  entrée, sortie, transfert, retour, casse, perte, ajustement
--   stock_creer_inventaire       ouvre un comptage (dépôt ou zone)
--   stock_compter                enregistre un comptage (unité ou article)
--   stock_valider_inventaire     calcule les écarts et les corrige par des ajustements
--
-- Toutes les fonctions publiques sont « security definer » : elles revérifient
-- l'organisation, l'activation du module, le rôle et le périmètre de service de
-- l'appelant (auth.uid()), car les tables n'ont aucune policy d'écriture. Les
-- erreurs sont des codes « stock_xxx » (message d'exception), traduits en
-- français par lib/stock/erreurs.ts.
--
-- Idempotence : chaque mouvement porte une clé (unique par organisation). Une
-- clé déjà connue renvoie le mouvement existant avec doublon = true, sans rien
-- modifier. Une quantité d'article ne devient jamais négative.
--
-- ADDITIVE et rejouable (create or replace). Aucune suppression de données.

-- ── 1. Transitions de statut ───────────────────────────────────────────

create or replace function public.stock_transition_autorisee(p_type text, p_sens integer, p_avant text, p_apres text)
returns boolean
language sql
immutable
as $$
  select case p_type
    when 'entree' then p_apres = 'dans_depot' and (p_avant is null or p_avant in ('livre', 'retour', 'perdu', 'endommage'))
    when 'sortie' then (p_avant in ('dans_depot', 'retour') and p_apres in ('en_tournee', 'livre')) or (p_avant = 'en_tournee' and p_apres = 'livre')
    when 'transfert' then p_avant in ('dans_depot', 'retour') and p_apres = p_avant
    when 'retour' then (p_avant in ('en_tournee', 'livre') and p_apres in ('retour', 'dans_depot')) or (p_avant = 'retour' and p_apres = 'dans_depot')
    when 'casse' then p_avant in ('dans_depot', 'en_tournee', 'retour') and p_apres = 'endommage'
    when 'perte' then p_avant in ('dans_depot', 'en_tournee', 'retour') and p_apres = 'perdu'
    when 'ajustement' then
      (p_sens = 1 and p_apres = 'dans_depot' and (p_avant is null or p_avant in ('perdu', 'endommage', 'livre', 'retour', 'en_tournee')))
      or (p_sens = -1 and p_avant in ('dans_depot', 'retour') and p_apres = 'perdu')
    else false
  end;
$$;

-- ── 2. Cœur : application d'un mouvement (interne) ─────────────────────

create or replace function public.stock__appliquer(
  p_org uuid,
  p_user uuid,
  p_user_nom text,
  p_cle text,
  p_type text,
  p_sens integer,
  p_unite_code text,
  p_type_unite text,
  p_poids numeric,
  p_volume numeric,
  p_sscc text,
  p_article uuid,
  p_quantite numeric,
  p_site uuid,
  p_src uuid,
  p_dest uuid,
  p_lot text,
  p_dlc date,
  p_statut_apres text,
  p_motif text,
  p_run uuid,
  p_stop uuid,
  p_inventaire uuid,
  p_source text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_zero constant uuid := '00000000-0000-0000-0000-000000000000';
  v_lot text := coalesce(btrim(p_lot), '');
  v_sens integer;
  v_exist public.stock_mouvements%rowtype;
  v_unite public.stock_unites%rowtype;
  v_article public.stock_articles%rowtype;
  v_avant text;
  v_apres text;
  v_site uuid := p_site;
  v_src uuid := p_src;
  v_dest uuid := p_dest;
  v_quantite numeric := p_quantite;
  v_mvt uuid;
  v_solde numeric;
  v_dlc date := p_dlc;
  v_loc_site uuid;
  v_loc_emp uuid;
  v_run uuid;
  v_stop uuid;
  v_run_mv uuid;
  v_stop_mv uuid;
  v_unite_id uuid;
begin
  -- Idempotence : clé déjà enregistrée = rien à refaire.
  select * into v_exist from public.stock_mouvements where organization_id = p_org and cle_idempotence = p_cle;
  if found then
    return jsonb_build_object('ok', true, 'doublon', true, 'mouvement_id', v_exist.id, 'unite_id', v_exist.unite_id, 'statut', v_exist.statut_apres);
  end if;

  if p_type not in ('entree', 'sortie', 'transfert', 'ajustement', 'casse', 'perte', 'retour') then
    raise exception 'stock_type_invalide' using errcode = 'P0001';
  end if;
  v_sens := case
    when p_type in ('entree', 'retour') then 1
    when p_type in ('sortie', 'casse', 'perte') then -1
    when p_type = 'transfert' then 0
    else p_sens
  end;
  if v_sens is null or v_sens not in (-1, 0, 1) or (p_type = 'ajustement' and v_sens = 0) then
    raise exception 'stock_sens_invalide' using errcode = 'P0001';
  end if;
  if (p_unite_code is null) = (p_article is null) then
    raise exception 'stock_cible_invalide' using errcode = 'P0001';
  end if;
  if p_motif is not null and char_length(p_motif) > 300 then
    raise exception 'stock_motif_trop_long' using errcode = 'P0001';
  end if;
  if p_type in ('ajustement', 'casse', 'perte') and (p_motif is null or btrim(p_motif) = '') and p_source = 'app' then
    raise exception 'stock_motif_requis' using errcode = 'P0001';
  end if;
  if v_site is null or not exists (select 1 from public.stock_sites s where s.id = v_site and s.organization_id = p_org and s.actif) then
    raise exception 'stock_site_invalide' using errcode = 'P0001';
  end if;
  -- Emplacements : actifs, de ce dépôt.
  if v_src is not null and not exists (select 1 from public.stock_emplacements e where e.id = v_src and e.organization_id = p_org and e.site_id = v_site) then
    raise exception 'stock_emplacement_invalide' using errcode = 'P0001';
  end if;
  if v_dest is not null and not exists (select 1 from public.stock_emplacements e where e.id = v_dest and e.organization_id = p_org and e.site_id = v_site and e.actif) then
    raise exception 'stock_emplacement_invalide' using errcode = 'P0001';
  end if;
  -- Liens avec la tournée : de la même organisation.
  v_run := p_run;
  v_stop := p_stop;
  if v_run is not null and not exists (select 1 from public.delivery_runs r where r.id = v_run and r.organization_id = p_org) then
    raise exception 'stock_tournee_invalide' using errcode = 'P0001';
  end if;
  if v_stop is not null and not exists (select 1 from public.delivery_stops d where d.id = v_stop and d.organization_id = p_org) then
    raise exception 'stock_tournee_invalide' using errcode = 'P0001';
  end if;

  if p_unite_code is not null then
    -- ── Unité individualisée (colis, palette) ──
    v_quantite := 1;
    select * into v_unite from public.stock_unites where organization_id = p_org and code = btrim(p_unite_code) for update;
    if not found then
      if p_type <> 'entree' and not (p_type = 'ajustement' and v_sens = 1) then
        raise exception 'stock_unite_inconnue' using errcode = 'P0001';
      end if;
      if p_type_unite is null or p_type_unite not in ('colis', 'palette_eur', 'demi_palette', 'palette_autre') then
        raise exception 'stock_type_unite_requis' using errcode = 'P0001';
      end if;
      v_avant := null;
    else
      v_avant := v_unite.statut;
    end if;

    v_apres := case p_type
      when 'entree' then 'dans_depot'
      when 'sortie' then coalesce(p_statut_apres, case when v_run is not null then 'en_tournee' else 'livre' end)
      when 'transfert' then v_avant
      when 'retour' then coalesce(p_statut_apres, 'retour')
      when 'casse' then 'endommage'
      when 'perte' then 'perdu'
      else case when v_sens = 1 then 'dans_depot' else 'perdu' end
    end;
    if not public.stock_transition_autorisee(p_type, v_sens, v_avant, v_apres) then
      raise exception 'stock_transition_interdite' using errcode = 'P0001';
    end if;

    -- Emplacement de départ : celui de l'unité (avant le mouvement).
    v_src := v_unite.emplacement_id;
    -- Nouvel emplacement : renseigné seulement quand l'unité est rangée au dépôt.
    if v_apres in ('dans_depot', 'retour') then
      v_loc_emp := v_dest;
      v_loc_site := v_site;
    elsif v_apres = 'endommage' then
      -- Une unité cassée reste où elle est.
      v_loc_emp := v_unite.emplacement_id;
      v_loc_site := coalesce(v_unite.site_id, v_site);
    else
      v_loc_emp := null;
      v_loc_site := coalesce(v_unite.site_id, v_site);
    end if;
    -- Lien tournée du mouvement : celui fourni, sinon celui que portait l'unité en tournée.
    v_run_mv := coalesce(v_run, case when v_avant in ('en_tournee', 'livre', 'retour') then v_unite.run_id end);
    v_stop_mv := coalesce(v_stop, case when v_avant in ('en_tournee', 'livre', 'retour') then v_unite.stop_id end);
    -- Lien tournée de l'unité : posé à la sortie, conservé jusqu'au rangement, effacé quand elle est rangée en stock.
    if v_apres = 'dans_depot' then
      v_run := null;
      v_stop := null;
    else
      v_run := v_run_mv;
      v_stop := v_stop_mv;
    end if;

    if v_unite.id is null then
      insert into public.stock_unites (organization_id, activite, code, type_unite, poids_kg, volume_m3, sscc, statut, site_id, emplacement_id, run_id, stop_id)
      values (p_org, case when p_type_unite = 'colis' then 'messagerie' else 'palettes' end, btrim(p_unite_code), p_type_unite, p_poids, p_volume, p_sscc, v_apres, v_loc_site, v_loc_emp, v_run, v_stop)
      returning id into v_unite_id;
    else
      update public.stock_unites
         set statut = v_apres,
             site_id = v_loc_site,
             emplacement_id = v_loc_emp,
             run_id = v_run,
             stop_id = v_stop,
             poids_kg = coalesce(p_poids, poids_kg),
             volume_m3 = coalesce(p_volume, volume_m3),
             sscc = coalesce(p_sscc, sscc),
             updated_at = now()
       where id = v_unite.id and organization_id = p_org;
      v_unite_id := v_unite.id;
    end if;

    insert into public.stock_mouvements
      (organization_id, type, sens, unite_id, unite_code, quantite, site_id, emplacement_source_id, emplacement_dest_id, statut_avant, statut_apres, motif, run_id, stop_id, inventaire_id, source, cle_idempotence, auteur_id, auteur_nom)
    values
      (p_org, p_type, v_sens, v_unite_id, btrim(p_unite_code), 1, v_loc_site, v_src, v_loc_emp, v_avant, v_apres, nullif(btrim(p_motif), ''), v_run_mv, v_stop_mv, p_inventaire, p_source, p_cle, p_user, p_user_nom)
    returning id into v_mvt;
    return jsonb_build_object('ok', true, 'doublon', false, 'mouvement_id', v_mvt, 'unite_id', v_unite_id, 'statut', v_apres);
  end if;

  -- ── Article en quantité ──
  if v_quantite is null or v_quantite <= 0 then
    raise exception 'stock_quantite_invalide' using errcode = 'P0001';
  end if;
  select * into v_article from public.stock_articles where id = p_article and organization_id = p_org;
  if not found or not v_article.actif then
    raise exception 'stock_article_invalide' using errcode = 'P0001';
  end if;
  if v_article.suivi_lots and v_lot = '' then
    raise exception 'stock_lot_requis' using errcode = 'P0001';
  end if;
  if v_sens > 0 and v_article.suivi_dlc and v_dlc is null and p_source <> 'inventaire' then
    raise exception 'stock_dlc_requise' using errcode = 'P0001';
  end if;
  if p_type = 'transfert' and v_src is not distinct from v_dest then
    raise exception 'stock_transfert_identique' using errcode = 'P0001';
  end if;

  -- Retrait (sortie, casse, perte, ajustement négatif, origine d'un transfert).
  if v_sens < 0 or p_type = 'transfert' then
    update public.stock_soldes
       set quantite = quantite - v_quantite, updated_at = now()
     where organization_id = p_org and article_id = p_article and site_id = v_site
       and emplacement_key = coalesce(v_src, v_zero) and lot = v_lot and quantite >= v_quantite
    returning quantite, dlc into v_solde, v_dlc;
    if not found then
      raise exception 'stock_insuffisant' using errcode = 'P0001';
    end if;
  end if;
  -- Ajout (entrée, retour, ajustement positif, destination d'un transfert).
  if v_sens > 0 or p_type = 'transfert' then
    insert into public.stock_soldes (organization_id, article_id, site_id, emplacement_id, lot, dlc, quantite)
    values (p_org, p_article, v_site, v_dest, v_lot, v_dlc, v_quantite)
    on conflict (organization_id, article_id, site_id, emplacement_key, lot)
    do update set quantite = public.stock_soldes.quantite + excluded.quantite,
                  dlc = coalesce(excluded.dlc, public.stock_soldes.dlc),
                  updated_at = now()
    returning quantite into v_solde;
  end if;

  insert into public.stock_mouvements
    (organization_id, type, sens, article_id, quantite, site_id, emplacement_source_id, emplacement_dest_id, lot, dlc, motif, run_id, stop_id, inventaire_id, source, cle_idempotence, auteur_id, auteur_nom)
  values
    (p_org, p_type, v_sens, p_article, v_quantite, v_site,
     case when v_sens < 0 or p_type = 'transfert' then v_src else null end,
     case when v_sens > 0 or p_type = 'transfert' then v_dest else null end,
     v_lot, v_dlc, nullif(btrim(p_motif), ''), v_run, v_stop, p_inventaire, p_source, p_cle, p_user, p_user_nom)
  returning id into v_mvt;
  return jsonb_build_object('ok', true, 'doublon', false, 'mouvement_id', v_mvt, 'quantite_apres', v_solde);
end;
$$;

revoke all on function public.stock__appliquer(uuid, uuid, text, text, text, integer, text, text, numeric, numeric, text, uuid, numeric, uuid, uuid, uuid, text, date, text, text, uuid, uuid, uuid, text) from public, anon, authenticated;

-- ── 3. Contexte de l'appelant (interne) ────────────────────────────────

-- Organisation, rôle et nom de la personne connectée ; refuse si le module est inactif.
create or replace function public.stock__contexte(out o_org uuid, out o_user uuid, out o_role text, out o_nom text)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  o_user := auth.uid();
  if o_user is null then
    raise exception 'stock_non_authentifie' using errcode = 'P0001';
  end if;
  select u.organization_id, u.role::text, u.full_name into o_org, o_role, o_nom
    from public.users u where u.id = o_user and u.active;
  if o_org is null then
    raise exception 'stock_non_authentifie' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.organization_modules m where m.organization_id = o_org and m.module_key = 'stock' and m.enabled) then
    raise exception 'stock_module_inactif' using errcode = 'P0001';
  end if;
end;
$$;

revoke all on function public.stock__contexte() from public, anon, authenticated;

-- Un manager n'agit que sur les dépôts de ses services (ou sans service).
create or replace function public.stock__site_autorise(p_org uuid, p_role text, p_site uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.stock_sites s
    where s.id = p_site and s.organization_id = p_org
      and (p_role in ('chauffeur', 'exploitation', 'direction') or s.service_id is null or s.service_id = any (public.current_user_service_ids()))
  );
$$;

revoke all on function public.stock__site_autorise(uuid, text, uuid) from public, anon, authenticated;

-- ── 4. Mouvement (appelé par l'application) ────────────────────────────

create or replace function public.stock_enregistrer_mouvement(
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
  p_source text default 'app'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  c record;
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
  return public.stock__appliquer(
    c.o_org, c.o_user, c.o_nom, p_cle, p_type, p_sens, p_unite_code, p_type_unite, p_poids, p_volume, p_sscc,
    p_article, p_quantite, p_site, p_src, p_dest, p_lot, p_dlc, p_statut_apres, p_motif, p_run, p_stop, null, p_source
  );
end;
$$;

revoke all on function public.stock_enregistrer_mouvement(text, text, uuid, text, text, uuid, numeric, uuid, uuid, text, date, integer, text, text, uuid, uuid, numeric, numeric, text, text) from public, anon;
grant execute on function public.stock_enregistrer_mouvement(text, text, uuid, text, text, uuid, numeric, uuid, uuid, text, date, integer, text, text, uuid, uuid, numeric, numeric, text, text) to authenticated;

-- ── 5. Inventaire : ouverture ──────────────────────────────────────────

create or replace function public.stock_creer_inventaire(p_cle text, p_site uuid, p_zone uuid default null, p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  c record;
  v_exist public.stock_inventaires%rowtype;
  v_id uuid;
  v_ids uuid[];
begin
  select * into c from public.stock__contexte();
  if c.o_role not in ('manager', 'manager_chauffeur', 'exploitation', 'direction') then
    raise exception 'stock_role_refuse' using errcode = 'P0001';
  end if;
  if p_cle is null or char_length(p_cle) < 8 or char_length(p_cle) > 100 then
    raise exception 'stock_cle_invalide' using errcode = 'P0001';
  end if;
  select * into v_exist from public.stock_inventaires where organization_id = c.o_org and cle_idempotence = p_cle;
  if found then
    return jsonb_build_object('ok', true, 'doublon', true, 'inventaire_id', v_exist.id);
  end if;
  if p_site is null or not public.stock__site_autorise(c.o_org, c.o_role, p_site) then
    raise exception 'stock_site_invalide' using errcode = 'P0001';
  end if;
  if p_zone is not null and not exists (select 1 from public.stock_emplacements e where e.id = p_zone and e.organization_id = c.o_org and e.site_id = p_site and e.genre = 'zone') then
    raise exception 'stock_emplacement_invalide' using errcode = 'P0001';
  end if;
  if exists (
    select 1 from public.stock_inventaires i
    where i.organization_id = c.o_org and i.site_id = p_site and i.statut = 'en_cours'
      and coalesce(i.zone_id, '00000000-0000-0000-0000-000000000000'::uuid) = coalesce(p_zone, '00000000-0000-0000-0000-000000000000'::uuid)
  ) then
    raise exception 'stock_inventaire_en_cours' using errcode = 'P0001';
  end if;

  insert into public.stock_inventaires (organization_id, site_id, zone_id, note, cle_idempotence, created_by, created_by_nom)
  values (c.o_org, p_site, p_zone, nullif(btrim(p_note), ''), p_cle, c.o_user, c.o_nom)
  returning id into v_id;

  -- Emplacements du périmètre : la zone et ses emplacements, ou tout le dépôt.
  select coalesce(array_agg(e.id), '{}') into v_ids
    from public.stock_emplacements e
   where e.organization_id = c.o_org and e.site_id = p_site
     and (p_zone is null or e.id = p_zone or e.parent_id = p_zone);

  -- Lignes « article » à compter : un solde positif par article, emplacement et lot du périmètre.
  insert into public.stock_inventaire_lignes (organization_id, inventaire_id, genre, article_id, emplacement_id, lot)
  select c.o_org, v_id, 'article', s.article_id, s.emplacement_id, s.lot
    from public.stock_soldes s
   where s.organization_id = c.o_org and s.site_id = p_site and s.quantite > 0
     and (p_zone is null or s.emplacement_id = any (v_ids))
  on conflict do nothing;

  return jsonb_build_object('ok', true, 'doublon', false, 'inventaire_id', v_id);
end;
$$;

revoke all on function public.stock_creer_inventaire(text, uuid, uuid, text) from public, anon;
grant execute on function public.stock_creer_inventaire(text, uuid, uuid, text) to authenticated;

-- ── 6. Inventaire : comptage ───────────────────────────────────────────

create or replace function public.stock_compter(
  p_inventaire uuid,
  p_unite_code text default null,
  p_article uuid default null,
  p_emplacement uuid default null,
  p_lot text default null,
  p_quantite numeric default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  c record;
  v_inv public.stock_inventaires%rowtype;
  v_lot text := coalesce(btrim(p_lot), '');
  v_id uuid;
begin
  select * into c from public.stock__contexte();
  if c.o_role not in ('chauffeur', 'manager', 'manager_chauffeur', 'exploitation', 'direction') then
    raise exception 'stock_role_refuse' using errcode = 'P0001';
  end if;
  select * into v_inv from public.stock_inventaires where id = p_inventaire and organization_id = c.o_org;
  if not found or not public.stock__site_autorise(c.o_org, c.o_role, v_inv.site_id) then
    raise exception 'stock_inventaire_introuvable' using errcode = 'P0001';
  end if;
  if v_inv.statut <> 'en_cours' then
    raise exception 'stock_inventaire_clos' using errcode = 'P0001';
  end if;
  if (p_unite_code is null) = (p_article is null) then
    raise exception 'stock_cible_invalide' using errcode = 'P0001';
  end if;
  if p_emplacement is not null and not exists (select 1 from public.stock_emplacements e where e.id = p_emplacement and e.organization_id = c.o_org and e.site_id = v_inv.site_id) then
    raise exception 'stock_emplacement_invalide' using errcode = 'P0001';
  end if;

  if p_unite_code is not null then
    if not exists (select 1 from public.stock_unites u where u.organization_id = c.o_org and u.code = btrim(p_unite_code)) then
      raise exception 'stock_unite_inconnue' using errcode = 'P0001';
    end if;
    insert into public.stock_inventaire_lignes (organization_id, inventaire_id, genre, unite_code, emplacement_id, quantite_comptee, counted_by)
    values (c.o_org, p_inventaire, 'unite', btrim(p_unite_code), p_emplacement, 1, c.o_user)
    on conflict (inventaire_id, unite_code) where genre = 'unite'
    do update set emplacement_id = excluded.emplacement_id, quantite_comptee = 1, counted_by = excluded.counted_by, updated_at = now()
    returning id into v_id;
  else
    if p_quantite is null or p_quantite < 0 then
      raise exception 'stock_quantite_invalide' using errcode = 'P0001';
    end if;
    if not exists (select 1 from public.stock_articles a where a.id = p_article and a.organization_id = c.o_org) then
      raise exception 'stock_article_invalide' using errcode = 'P0001';
    end if;
    insert into public.stock_inventaire_lignes (organization_id, inventaire_id, genre, article_id, emplacement_id, lot, quantite_comptee, counted_by)
    values (c.o_org, p_inventaire, 'article', p_article, p_emplacement, v_lot, p_quantite, c.o_user)
    on conflict (inventaire_id, article_id, emplacement_key, lot) where genre = 'article'
    do update set quantite_comptee = excluded.quantite_comptee, counted_by = excluded.counted_by, updated_at = now()
    returning id into v_id;
  end if;
  return jsonb_build_object('ok', true, 'ligne_id', v_id);
end;
$$;

revoke all on function public.stock_compter(uuid, text, uuid, uuid, text, numeric) from public, anon;
grant execute on function public.stock_compter(uuid, text, uuid, uuid, text, numeric) to authenticated;

-- ── 7. Inventaire : validation (écarts corrigés par des ajustements) ───

create or replace function public.stock_valider_inventaire(p_inventaire uuid, p_cle text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  c record;
  v_zero constant uuid := '00000000-0000-0000-0000-000000000000';
  v_inv public.stock_inventaires%rowtype;
  v_ids uuid[];
  l public.stock_inventaire_lignes%rowtype;
  u public.stock_unites%rowtype;
  s public.stock_soldes%rowtype;
  v_theo numeric;
  v_ecart numeric;
  v_ecarts integer := 0;
  v_cle text;
  v_trouve boolean;
begin
  select * into c from public.stock__contexte();
  if c.o_role not in ('manager', 'manager_chauffeur', 'exploitation', 'direction') then
    raise exception 'stock_role_refuse' using errcode = 'P0001';
  end if;
  if p_cle is null or char_length(p_cle) < 8 or char_length(p_cle) > 100 then
    raise exception 'stock_cle_invalide' using errcode = 'P0001';
  end if;
  select * into v_inv from public.stock_inventaires where id = p_inventaire and organization_id = c.o_org for update;
  if not found or not public.stock__site_autorise(c.o_org, c.o_role, v_inv.site_id) then
    raise exception 'stock_inventaire_introuvable' using errcode = 'P0001';
  end if;
  if v_inv.statut = 'valide' then
    return jsonb_build_object('ok', true, 'doublon', true, 'ecarts', coalesce(v_inv.ecarts_total, 0));
  end if;
  if v_inv.statut <> 'en_cours' then
    raise exception 'stock_inventaire_clos' using errcode = 'P0001';
  end if;

  select coalesce(array_agg(e.id), '{}') into v_ids
    from public.stock_emplacements e
   where e.organization_id = c.o_org and e.site_id = v_inv.site_id
     and (v_inv.zone_id is null or e.id = v_inv.zone_id or e.parent_id = v_inv.zone_id);

  -- 1. Unités comptées.
  for l in select * from public.stock_inventaire_lignes where inventaire_id = p_inventaire and genre = 'unite' order by unite_code loop
    select * into u from public.stock_unites where organization_id = c.o_org and code = l.unite_code for update;
    v_trouve := found;
    v_cle := 'inv:' || p_inventaire::text || ':u:' || l.unite_code;
    if v_trouve and u.statut = 'dans_depot' and u.site_id = v_inv.site_id
       and (l.emplacement_id is null or u.emplacement_id is not distinct from l.emplacement_id) then
      -- Conforme.
      update public.stock_inventaire_lignes set quantite_theorique = 1, ecart = 0, updated_at = now() where id = l.id;
    elsif v_trouve and u.statut = 'dans_depot' and u.site_id = v_inv.site_id then
      -- Présente, mais rangée ailleurs : déplacement.
      perform public.stock__appliquer(c.o_org, c.o_user, c.o_nom, v_cle, 'transfert', 0, l.unite_code, null, null, null, null, null, 1,
                                      v_inv.site_id, u.emplacement_id, l.emplacement_id, null, null, null, 'Inventaire : unité retrouvée à un autre emplacement', null, null, p_inventaire, 'inventaire');
      update public.stock_inventaire_lignes set quantite_theorique = 1, ecart = 0, updated_at = now() where id = l.id;
      v_ecarts := v_ecarts + 1;
    else
      -- Comptée alors qu'elle n'était pas en stock : entrée par ajustement.
      perform public.stock__appliquer(c.o_org, c.o_user, c.o_nom, v_cle, 'ajustement', 1, l.unite_code, null, null, null, null, null, 1,
                                      v_inv.site_id, null, l.emplacement_id, null, null, null, 'Inventaire : unité comptée, absente du stock', null, null, p_inventaire, 'inventaire');
      update public.stock_inventaire_lignes set quantite_theorique = 0, ecart = 1, updated_at = now() where id = l.id;
      v_ecarts := v_ecarts + 1;
    end if;
  end loop;

  -- 2. Unités attendues dans le périmètre mais non comptées : perdues.
  for u in
    select * from public.stock_unites x
     where x.organization_id = c.o_org and x.statut = 'dans_depot' and x.site_id = v_inv.site_id
       and (v_inv.zone_id is null or x.emplacement_id = any (v_ids))
       and not exists (select 1 from public.stock_inventaire_lignes z where z.inventaire_id = p_inventaire and z.genre = 'unite' and z.unite_code = x.code)
     order by x.code
     for update
  loop
    perform public.stock__appliquer(c.o_org, c.o_user, c.o_nom, 'inv:' || p_inventaire::text || ':u:' || u.code, 'ajustement', -1, u.code, null, null, null, null, null, 1,
                                    v_inv.site_id, u.emplacement_id, null, null, null, null, 'Inventaire : unité non retrouvée', null, null, p_inventaire, 'inventaire');
    insert into public.stock_inventaire_lignes (organization_id, inventaire_id, genre, unite_code, emplacement_id, quantite_comptee, quantite_theorique, ecart, counted_by)
    values (c.o_org, p_inventaire, 'unite', u.code, u.emplacement_id, 0, 1, -1, c.o_user);
    v_ecarts := v_ecarts + 1;
  end loop;

  -- 3. Articles comptés : écart entre le compté et le solde du moment.
  for l in select * from public.stock_inventaire_lignes where inventaire_id = p_inventaire and genre = 'article' and quantite_comptee is not null order by id loop
    select * into s from public.stock_soldes
     where organization_id = c.o_org and article_id = l.article_id and site_id = v_inv.site_id
       and emplacement_key = coalesce(l.emplacement_id, v_zero) and lot = l.lot;
    v_theo := coalesce(s.quantite, 0);
    v_ecart := l.quantite_comptee - v_theo;
    update public.stock_inventaire_lignes set quantite_theorique = v_theo, ecart = v_ecart, updated_at = now() where id = l.id;
    if v_ecart <> 0 then
      perform public.stock__appliquer(c.o_org, c.o_user, c.o_nom, 'inv:' || p_inventaire::text || ':a:' || l.id::text, 'ajustement', case when v_ecart > 0 then 1 else -1 end,
                                      null, null, null, null, null, l.article_id, abs(v_ecart),
                                      v_inv.site_id, l.emplacement_id, l.emplacement_id, l.lot, s.dlc, null,
                                      'Inventaire : écart constaté', null, null, p_inventaire, 'inventaire');
      v_ecarts := v_ecarts + 1;
    end if;
  end loop;

  update public.stock_inventaires
     set statut = 'valide', validated_by = c.o_user, validated_by_nom = c.o_nom, validated_at = now(), ecarts_total = v_ecarts
   where id = p_inventaire and organization_id = c.o_org;

  return jsonb_build_object('ok', true, 'doublon', false, 'ecarts', v_ecarts);
end;
$$;

revoke all on function public.stock_valider_inventaire(uuid, text) from public, anon;
grant execute on function public.stock_valider_inventaire(uuid, text) to authenticated;

notify pgrst, 'reload schema';
