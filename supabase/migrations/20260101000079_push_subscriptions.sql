-- GODAC V2 — web push notifications, alongside email (Module 8).
--
-- One row per browser/device a user has opted into push on (a driver
-- can have both a phone and a desktop subscribed). Written by the
-- client itself (lib/push/client.ts) right after the browser grants
-- Notification permission and the Push API hands back a
-- PushSubscription — never created by any server-side trigger.
create table push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  user_id uuid not null references users (id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now()
);

create index push_subscriptions_user_idx on push_subscriptions (user_id);

alter table push_subscriptions enable row level security;

create policy "push_subscriptions: user manages own"
  on push_subscriptions for all
  using (user_id = public.current_app_user_id())
  with check (user_id = public.current_app_user_id() and organization_id = public.current_organization_id());
