-- GODAC V2 — Lot B: assistant d'aide contextuelle + relais humain.
--
-- Trois tables distinctes, trois granularités de donnée :
-- - assistant_notes      : consignes propres à l'organisation, gérées
--                          par la direction, qui s'ajoutent au guide
--                          d'utilisation statique (content/help/*.md)
--                          comme sources que l'IA peut citer.
-- - assistant_conversations / assistant_messages : l'historique de
--                          chat, conservé 90 jours (voir
--                          cleanup_old_assistant_conversations()
--                          ci-dessous — non branché sur un cron, voir
--                          README).
-- - support_requests     : le relais humain déclenché depuis une
--                          conversation (ou directement), visible par
--                          les gestionnaires concernés via /support.
--
-- L'assistant lui-même n'a aucun accès direct aux données métier
-- (pleins, véhicules, autres salariés) — ces tables ne contiennent que
-- de la conversation et des consignes, jamais une requête vers
-- fuel_entries/vehicles/users au-delà du contexte de rôle/service déjà
-- résolu côté serveur.

create table assistant_notes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  title text not null,
  content text not null,
  -- Roles that can see this note as an assistant source AND on the
  -- admin list — empty means "all roles".
  roles user_role[] not null default '{}',
  created_by uuid references users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index assistant_notes_org_idx on assistant_notes (organization_id);

create trigger assistant_notes_set_updated_at
  before update on assistant_notes
  for each row execute function set_updated_at();

create table assistant_conversations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  user_id uuid not null references users (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index assistant_conversations_user_idx on assistant_conversations (user_id, updated_at desc);

create trigger assistant_conversations_set_updated_at
  before update on assistant_conversations
  for each row execute function set_updated_at();

create table assistant_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references assistant_conversations (id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  content text not null,
  -- Set only on an 'assistant' row: the model's own "I don't know,
  -- relay this" signal (see lib/assistant/system-prompt.ts).
  needs_human boolean,
  -- Set only on an 'assistant' row, by the feedback buttons: null
  -- (no feedback yet), true (👍), false (👎).
  feedback boolean,
  created_at timestamptz not null default now()
);

create index assistant_messages_conversation_idx on assistant_messages (conversation_id, created_at);

create type support_request_recipient as enum ('gestionnaire', 'support_godac');
create type support_request_status as enum ('open', 'in_progress', 'resolved');

create table support_requests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  requested_by uuid not null references users (id) on delete cascade,
  service_id uuid references services (id) on delete set null,
  conversation_id uuid references assistant_conversations (id) on delete set null,
  question text not null,
  -- AI-generated recap of the conversation leading to the relay — may
  -- be null when the request was raised directly (no prior chat).
  conversation_summary text,
  recipient support_request_recipient not null,
  status support_request_status not null default 'open',
  assigned_to uuid references users (id) on delete set null,
  response text,
  responded_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index support_requests_org_status_idx on support_requests (organization_id, status);

create trigger support_requests_set_updated_at
  before update on support_requests
  for each row execute function set_updated_at();

-- ── RLS ──────────────────────────────────────────────────────────
alter table assistant_notes enable row level security;
alter table assistant_conversations enable row level security;
alter table assistant_messages enable row level security;
alter table support_requests enable row level security;

create policy "assistant_notes: read within org"
  on assistant_notes for select
  using (organization_id = public.current_organization_id());

create policy "assistant_notes: direction manages"
  on assistant_notes for all
  using (organization_id = public.current_organization_id() and public.is_direction())
  with check (organization_id = public.current_organization_id() and public.is_direction());

create policy "assistant_conversations: own only"
  on assistant_conversations for all
  using (organization_id = public.current_organization_id() and user_id = public.current_app_user_id())
  with check (organization_id = public.current_organization_id() and user_id = public.current_app_user_id());

-- A message's own row carries no organization_id — scoped through its
-- parent conversation instead, same join-through-FK style as
-- user_services' RLS policies.
create policy "assistant_messages: within own conversation"
  on assistant_messages for all
  using (
    exists (
      select 1 from assistant_conversations c
      where c.id = assistant_messages.conversation_id
        and c.user_id = public.current_app_user_id()
        and c.organization_id = public.current_organization_id()
    )
  )
  with check (
    exists (
      select 1 from assistant_conversations c
      where c.id = assistant_messages.conversation_id
        and c.user_id = public.current_app_user_id()
        and c.organization_id = public.current_organization_id()
    )
  );

create policy "support_requests: requester reads own"
  on support_requests for select
  using (organization_id = public.current_organization_id() and requested_by = public.current_app_user_id());

create policy "support_requests: manager-like reads within org"
  on support_requests for select
  using (organization_id = public.current_organization_id() and public.is_manager_like());

create policy "support_requests: any member requests"
  on support_requests for insert
  with check (organization_id = public.current_organization_id() and requested_by = public.current_app_user_id());

create policy "support_requests: manager-like updates"
  on support_requests for update
  using (organization_id = public.current_organization_id() and public.is_manager_like())
  with check (organization_id = public.current_organization_id() and public.is_manager_like());

-- ── Retention (90 days) ──────────────────────────────────────────
-- Deletes conversations (messages cascade) older than 90 days. Not
-- wired to a schedule by this migration — see README "Intégrations
-- non branchées": enable with `select cron.schedule('assistant-cleanup',
-- '0 3 * * *', 'select public.cleanup_old_assistant_conversations()')`
-- once pg_cron is enabled on the project, or call it from an external
-- scheduled job hitting a protected route.
create or replace function public.cleanup_old_assistant_conversations()
returns void
language sql
security definer
set search_path = public
as $$
  delete from assistant_conversations where updated_at < now() - interval '90 days';
$$;

revoke execute on function public.cleanup_old_assistant_conversations() from public, anon, authenticated;
