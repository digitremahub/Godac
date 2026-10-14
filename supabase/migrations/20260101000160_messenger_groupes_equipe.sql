-- GODAC Messenger : groupes d'équipe (« ça remplacerait WhatsApp »).
--
-- Purement additif : nouvelles tables, fonctions, déclencheurs et
-- politiques ; la table 1:1 `messages` n'est pas touchée.
--
-- * message_groups : un groupe « team » par service, créé et tenu à
--   jour automatiquement, + des groupes ponctuels (« custom », ex.
--   « Équipe matin ») créés par un chef d'équipe / manager / direction.
-- * message_group_members : membres, rôle dans le groupe (admin =
--   responsable : chef d'équipe, managers, direction), sourdine par
--   personne, dernière lecture (non-lus).
-- * group_messages : messages, Infos équipe épinglées, pièces jointes
--   (bucket existant messenger-photos), mentions @prénom.
-- * group_message_reads : accusés « vu par X/Y » des Infos équipe.
-- * group_message_reactions : réactions emoji.
--
-- Membres du groupe d'équipe = utilisateurs actifs rattachés au service
-- (user_services) + le chef d'équipe (services.team_leader_user_id, ou
-- le compte dont l'e-mail correspond à services.team_leader_email),
-- miroir exact de lib/messenger/groupes.ts#computeTeamGroupMembers.
-- La synchronisation est faite par des déclencheurs sur user_services,
-- users et services, et rejouée à l'ouverture du Messenger
-- (ensure_my_message_groups) par sécurité. Un compte désactivé est
-- retiré de tous ses groupes immédiatement, et les politiques exigent
-- en plus un compte actif : l'accès est coupé dans tous les cas.
--
-- Conservation (RGPD) : comme la messagerie 1:1 — pendant la durée du
-- contrat, supprimé avec l'organisation (on delete cascade) ; voir
-- app/confidentialite.

-- Lien explicite facultatif entre le chef d'équipe d'un service et son
-- compte GODAC (le chef reste en texte libre : il n'est pas toujours
-- un utilisateur).
alter table services
  add column if not exists team_leader_user_id uuid references users (id) on delete set null;

create table if not exists message_groups (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  service_id uuid references services (id) on delete cascade,
  kind text not null check (kind in ('team', 'custom')),
  name text not null check (char_length(name) between 1 and 80),
  announcement_only boolean not null default false,
  created_by uuid references users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (kind = 'custom' or service_id is not null)
);
create unique index if not exists message_groups_one_team_per_service on message_groups (service_id) where kind = 'team';
create index if not exists message_groups_org_idx on message_groups (organization_id);

create table if not exists message_group_members (
  group_id uuid not null references message_groups (id) on delete cascade,
  user_id uuid not null references users (id) on delete cascade,
  organization_id uuid not null references organizations (id) on delete cascade,
  role text not null default 'member' check (role in ('admin', 'member')),
  source text not null default 'auto' check (source in ('auto', 'manual')),
  muted boolean not null default false,
  last_read_at timestamptz,
  joined_at timestamptz not null default now(),
  primary key (group_id, user_id)
);
create index if not exists message_group_members_user_idx on message_group_members (user_id);

create table if not exists group_messages (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  group_id uuid not null references message_groups (id) on delete cascade,
  sender_id uuid not null references users (id) on delete cascade,
  body text check (body is null or char_length(body) <= 4000),
  attachment_path text,
  attachment_name text,
  attachment_type text,
  is_announcement boolean not null default false,
  pinned_at timestamptz,
  pinned_by uuid references users (id) on delete set null,
  mentions uuid[] not null default '{}',
  created_at timestamptz not null default now(),
  check (body is not null or attachment_path is not null)
);
create index if not exists group_messages_group_idx on group_messages (group_id, created_at desc);
create index if not exists group_messages_pinned_idx on group_messages (group_id) where pinned_at is not null;

create table if not exists group_message_reads (
  message_id uuid not null references group_messages (id) on delete cascade,
  user_id uuid not null references users (id) on delete cascade,
  read_at timestamptz not null default now(),
  primary key (message_id, user_id)
);

create table if not exists group_message_reactions (
  message_id uuid not null references group_messages (id) on delete cascade,
  user_id uuid not null references users (id) on delete cascade,
  emoji text not null check (char_length(emoji) between 1 and 16),
  created_at timestamptz not null default now(),
  primary key (message_id, user_id, emoji)
);

create trigger message_groups_set_updated_at
  before update on message_groups
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------
-- Synchronisation des membres
-- ---------------------------------------------------------------

create or replace function public.message_team_desired_members(p_service_id uuid)
returns table (user_id uuid, member_role text)
language sql
stable
security definer
set search_path = public
as $$
  with s as (select * from services where id = p_service_id),
  cand as (
    select
      u.id,
      u.role,
      (
        u.id = s.team_leader_user_id
        or (
          nullif(trim(s.team_leader_email), '') is not null
          and (lower(trim(u.email)) = lower(trim(s.team_leader_email))
               or lower(trim(coalesce(u.contact_email, ''))) = lower(trim(s.team_leader_email)))
        )
      ) as is_chef,
      exists (select 1 from user_services us where us.user_id = u.id and us.service_id = s.id) as in_service
    from users u
    join s on u.organization_id = s.organization_id
    where u.active and not coalesce(u.pending_approval, false)
  )
  select id, case when is_chef or role in ('manager', 'manager_chauffeur', 'direction') then 'admin' else 'member' end
  from cand
  where in_service or is_chef;
$$;

-- Crée au besoin le groupe d'équipe du service et aligne ses membres
-- (ainsi que ceux des groupes ponctuels du service). Interne : appelée
-- par les déclencheurs et par ensure_my_message_groups().
create or replace function public.sync_message_group_members(p_service_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_service services%rowtype;
  v_group_id uuid;
begin
  select * into v_service from services where id = p_service_id;
  -- Service ou organisation en cours de suppression (cascade) : rien à faire.
  if not found or not exists (select 1 from organizations where id = v_service.organization_id) then
    return null;
  end if;

  insert into message_groups (organization_id, service_id, kind, name)
  values (v_service.organization_id, v_service.id, 'team', left(v_service.name, 80))
  on conflict (service_id) where kind = 'team' do nothing;

  select id into v_group_id from message_groups where service_id = p_service_id and kind = 'team';
  update message_groups set name = left(v_service.name, 80)
    where id = v_group_id and name is distinct from left(v_service.name, 80);

  -- Membres automatiques qui ne font plus partie de l'équipe.
  delete from message_group_members m
  where m.group_id = v_group_id
    and m.source = 'auto'
    and not exists (select 1 from public.message_team_desired_members(p_service_id) d where d.user_id = m.user_id);

  insert into message_group_members (group_id, organization_id, user_id, role, source)
  select v_group_id, v_service.organization_id, d.user_id, d.member_role, 'auto'
  from public.message_team_desired_members(p_service_id) d
  on conflict (group_id, user_id) do update
    set role = excluded.role, source = 'auto'
    where message_group_members.role is distinct from excluded.role
       or message_group_members.source is distinct from 'auto';

  -- Groupes ponctuels du service : on retire ceux qui ont quitté
  -- l'équipe (la direction peut rester), et les responsables de
  -- l'équipe y sont admins.
  delete from message_group_members m
  using message_groups g
  where m.group_id = g.id
    and g.service_id = p_service_id
    and g.kind = 'custom'
    and not exists (select 1 from public.message_team_desired_members(p_service_id) d where d.user_id = m.user_id)
    and not exists (select 1 from users u where u.id = m.user_id and u.role = 'direction' and u.active);

  update message_group_members m
  set role = 'admin'
  from message_groups g, public.message_team_desired_members(p_service_id) d
  where m.group_id = g.id
    and g.service_id = p_service_id
    and g.kind = 'custom'
    and d.user_id = m.user_id
    and d.member_role = 'admin'
    and m.role <> 'admin';

  return v_group_id;
end;
$$;

-- Appelée par la page Messenger : rejoue la synchro des services du
-- signed-in user (tous ceux de l'organisation pour un manager/direction).
create or replace function public.ensure_my_message_groups()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
  v_me users%rowtype;
begin
  select * into v_me from users where id = auth.uid();
  if not found or not v_me.active or coalesce(v_me.pending_approval, false) then
    return;
  end if;
  for r in
    select s.id from services s
    where s.organization_id = v_me.organization_id
      and (
        v_me.role in ('manager', 'manager_chauffeur', 'direction')
        or exists (select 1 from user_services us where us.service_id = s.id and us.user_id = v_me.id)
        or s.team_leader_user_id = v_me.id
        or (nullif(trim(s.team_leader_email), '') is not null
            and lower(trim(s.team_leader_email)) in (lower(trim(v_me.email)), lower(trim(coalesce(v_me.contact_email, '')))))
      )
  loop
    perform public.sync_message_group_members(r.id);
  end loop;
end;
$$;

create or replace function public.trg_user_services_message_groups()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op in ('INSERT', 'UPDATE') then
    perform public.sync_message_group_members(new.service_id);
  end if;
  if tg_op in ('DELETE', 'UPDATE') and (tg_op = 'DELETE' or old.service_id is distinct from new.service_id) then
    perform public.sync_message_group_members(old.service_id);
  end if;
  return null;
end;
$$;

create trigger user_services_message_groups_sync
  after insert or update or delete on user_services
  for each row execute function public.trg_user_services_message_groups();

create or replace function public.trg_users_message_groups()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
begin
  -- Désactivation : accès coupé tout de suite, dans tous les groupes
  -- (y compris ceux rejoints à la main par la direction).
  if not new.active or coalesce(new.pending_approval, false) then
    delete from message_group_members where user_id = new.id;
  end if;
  for r in
    select us.service_id as id from user_services us where us.user_id = new.id
    union
    select s.id from services s
    where s.organization_id = new.organization_id
      and (
        s.team_leader_user_id = new.id
        or (nullif(trim(s.team_leader_email), '') is not null
            and lower(trim(s.team_leader_email)) in (
              lower(trim(new.email)), lower(trim(coalesce(new.contact_email, ''))),
              lower(trim(coalesce(old.email, ''))), lower(trim(coalesce(old.contact_email, '')))))
      )
  loop
    perform public.sync_message_group_members(r.id);
  end loop;
  return null;
end;
$$;

create trigger users_message_groups_sync
  after update of active, pending_approval, role, email, contact_email on users
  for each row
  when (
    old.active is distinct from new.active
    or old.pending_approval is distinct from new.pending_approval
    or old.role is distinct from new.role
    or old.email is distinct from new.email
    or old.contact_email is distinct from new.contact_email
  )
  execute function public.trg_users_message_groups();

create or replace function public.trg_services_message_groups()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.sync_message_group_members(new.id);
  return null;
end;
$$;

create trigger services_message_groups_sync
  after insert or update of name, team_leader_user_id, team_leader_email on services
  for each row execute function public.trg_services_message_groups();

-- ---------------------------------------------------------------
-- Droits (RLS)
-- ---------------------------------------------------------------

create or replace function public.current_user_is_active()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select active and not coalesce(pending_approval, false) from users where id = auth.uid()), false);
$$;

create or replace function public.is_message_group_member(p_group_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.current_user_is_active()
    and exists (select 1 from message_group_members m where m.group_id = p_group_id and m.user_id = auth.uid());
$$;

create or replace function public.can_read_message_group(p_group_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.current_user_is_active()
    and exists (
      select 1 from message_groups g
      where g.id = p_group_id
        and g.organization_id = public.current_organization_id()
        and (
          public.is_direction()
          or exists (select 1 from message_group_members m where m.group_id = g.id and m.user_id = auth.uid())
        )
    );
$$;

create or replace function public.is_message_group_admin(p_group_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.current_user_is_active()
    and exists (
      select 1 from message_groups g
      where g.id = p_group_id
        and g.organization_id = public.current_organization_id()
        and (
          public.is_direction()
          or exists (select 1 from message_group_members m where m.group_id = g.id and m.user_id = auth.uid() and m.role = 'admin')
        )
    );
$$;

create or replace function public.can_post_in_message_group(p_group_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_message_group_member(p_group_id)
    and (
      public.is_message_group_admin(p_group_id)
      or not coalesce((select announcement_only from message_groups where id = p_group_id), true)
    );
$$;

revoke execute on function public.message_team_desired_members(uuid) from public, anon, authenticated;
revoke execute on function public.sync_message_group_members(uuid) from public, anon, authenticated;
revoke execute on function public.trg_user_services_message_groups() from public, anon, authenticated;
revoke execute on function public.trg_users_message_groups() from public, anon, authenticated;
revoke execute on function public.trg_services_message_groups() from public, anon, authenticated;
revoke execute on function public.ensure_my_message_groups() from public, anon;
grant execute on function public.ensure_my_message_groups() to authenticated;
revoke execute on function public.current_user_is_active() from anon;
revoke execute on function public.is_message_group_member(uuid) from anon;
revoke execute on function public.can_read_message_group(uuid) from anon;
revoke execute on function public.is_message_group_admin(uuid) from anon;
revoke execute on function public.can_post_in_message_group(uuid) from anon;

alter table message_groups enable row level security;
alter table message_group_members enable row level security;
alter table group_messages enable row level security;
alter table group_message_reads enable row level security;
alter table group_message_reactions enable row level security;

-- Création, renommage, mode annonces, membres, épinglage : faits par
-- les routes API (app/api/messenger/groupes/**) avec le client admin,
-- après contrôle des droits (lib/messenger/groupes.ts) — aucune
-- politique d'écriture directe sur ces colonnes.
create policy "message_groups: members and direction read"
  on message_groups for select
  using (organization_id = public.current_organization_id() and public.can_read_message_group(id));

create policy "message_group_members: readers of the group read"
  on message_group_members for select
  using (organization_id = public.current_organization_id() and public.can_read_message_group(group_id));

-- Un membre ne règle que sa sourdine et sa dernière lecture.
create policy "message_group_members: own preferences"
  on message_group_members for update
  using (user_id = auth.uid() and public.current_user_is_active())
  with check (user_id = auth.uid());
revoke update on message_group_members from anon, authenticated;
grant update (muted, last_read_at) on message_group_members to authenticated;

create policy "group_messages: readers of the group read"
  on group_messages for select
  using (organization_id = public.current_organization_id() and public.can_read_message_group(group_id));

create policy "group_messages: post when allowed"
  on group_messages for insert
  with check (
    organization_id = public.current_organization_id()
    and sender_id = auth.uid()
    and pinned_at is null
    and public.can_post_in_message_group(group_id)
    and (not is_announcement or public.is_message_group_admin(group_id))
  );

create policy "group_messages: author or group admin deletes"
  on group_messages for delete
  using (
    organization_id = public.current_organization_id()
    and public.can_read_message_group(group_id)
    and (sender_id = auth.uid() or public.is_message_group_admin(group_id))
  );

create policy "group_message_reads: readers of the group read"
  on group_message_reads for select
  using (exists (select 1 from group_messages gm where gm.id = message_id and public.can_read_message_group(gm.group_id)));

create policy "group_message_reads: mark own"
  on group_message_reads for insert
  with check (
    user_id = auth.uid()
    and exists (select 1 from group_messages gm where gm.id = message_id and public.is_message_group_member(gm.group_id))
  );

create policy "group_message_reactions: readers of the group read"
  on group_message_reactions for select
  using (exists (select 1 from group_messages gm where gm.id = message_id and public.can_read_message_group(gm.group_id)));

create policy "group_message_reactions: members react"
  on group_message_reactions for insert
  with check (
    user_id = auth.uid()
    and exists (select 1 from group_messages gm where gm.id = message_id and public.is_message_group_member(gm.group_id))
  );

create policy "group_message_reactions: remove own"
  on group_message_reactions for delete
  using (user_id = auth.uid());

-- Pièces jointes : même bucket que la messagerie 1:1 (dépôt dans son
-- propre dossier, politique existante) ; lecture par les lecteurs du
-- groupe via le message qui la référence.
create policy "messenger-photos: group readers read via group message"
  on storage.objects for select
  using (
    bucket_id = 'messenger-photos'
    and exists (
      select 1 from public.group_messages gm
      where gm.attachment_path = storage.objects.name
        and public.can_read_message_group(gm.group_id)
    )
  );

-- Rattrapage : un groupe d'équipe pour chaque service existant.
do $$
declare
  r record;
begin
  for r in select id from services loop
    perform public.sync_message_group_members(r.id);
  end loop;
end;
$$;
