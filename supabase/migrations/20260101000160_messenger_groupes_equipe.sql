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
-- règle lib/messenger/groupes.ts#computeTeamGroupMembers.
-- La synchronisation est faite par l'application
-- (lib/messenger/synchro-serveur.ts) à l'ouverture du Messenger et après
-- chaque changement de service, de chef d'équipe ou de compte. Les
-- politiques exigent un compte actif : un compte désactivé perd l'accès
-- tout de suite.
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
-- Côté client, seules ces deux colonnes peuvent changer.
create or replace function public.message_group_members_guard()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if coalesce(auth.role(), '') in ('anon', 'authenticated')
     and (new.group_id is distinct from old.group_id
       or new.user_id is distinct from old.user_id
       or new.organization_id is distinct from old.organization_id
       or new.role is distinct from old.role
       or new.source is distinct from old.source
       or new.joined_at is distinct from old.joined_at) then
    raise exception 'Seules la sourdine et la dernière lecture sont modifiables.' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger message_group_members_guard
  before update on message_group_members
  for each row execute function public.message_group_members_guard();

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
