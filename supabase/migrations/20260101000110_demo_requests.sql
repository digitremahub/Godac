-- Demandes de démonstration envoyées depuis le site public (/contact).
-- Aucune politique RLS : seule l'API serveur (clé service) écrit, et
-- seul le backoffice GODAC (/godac-staff) lit.
create table if not exists demo_requests (
  id uuid primary key default gen_random_uuid(),
  full_name text not null,
  company text not null,
  email text not null,
  phone text,
  vehicles integer,
  activity text,
  message text,
  plan_interest text,
  modules_interest text[],
  ip_hash text,
  status text not null default 'nouveau' check (status in ('nouveau', 'contacte', 'demo_faite', 'gagne', 'perdu')),
  created_at timestamptz not null default now()
);
create index if not exists demo_requests_created_idx on demo_requests (created_at desc);
alter table demo_requests enable row level security;
