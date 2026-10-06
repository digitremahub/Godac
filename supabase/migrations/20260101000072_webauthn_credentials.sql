-- GODAC V2 — Face ID / empreinte comme raccourci de connexion, en
-- plus du PIN (chauffeurs) et du lien magique/mot de passe (bureau),
-- jamais à la place : perdre son téléphone ou changer d'appareil ne
-- doit jamais bloquer qui que ce soit, voir app/api/auth/passkey/*.
-- Un utilisateur ne gère que ses propres clés (select/delete scopés à
-- lui-même) ; la vérification à la connexion (avant toute session)
-- passe par le client admin, qui contourne RLS par conception — même
-- schéma que app/driver-pin/[id]/page.tsx pour les lookups pré-session.
create table webauthn_credentials (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  credential_id text not null unique,
  public_key text not null,
  counter bigint not null default 0,
  device_name text,
  transports text[],
  created_at timestamptz not null default now(),
  last_used_at timestamptz
);

create index webauthn_credentials_user_id_idx on webauthn_credentials(user_id);

alter table webauthn_credentials enable row level security;

create policy "webauthn_credentials: read own"
  on webauthn_credentials for select
  using (user_id = public.current_app_user_id());

create policy "webauthn_credentials: insert own"
  on webauthn_credentials for insert
  with check (user_id = public.current_app_user_id());

create policy "webauthn_credentials: delete own"
  on webauthn_credentials for delete
  using (user_id = public.current_app_user_id());
