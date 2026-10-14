-- Audit sécurité : verrou du code PIN chauffeur (5 essais → 15 min).
-- Lue et écrite uniquement côté serveur (service role) : RLS sans policy.
create table if not exists pin_login_attempts (
  user_id uuid primary key references users (id) on delete cascade,
  failed_count integer not null default 0,
  locked_until timestamptz,
  last_failed_at timestamptz
);
alter table pin_login_attempts enable row level security;
