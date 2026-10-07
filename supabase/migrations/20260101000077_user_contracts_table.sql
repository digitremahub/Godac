-- GODAC V2 — monthly_gross_salary/monthly_net_salary/
-- contractual_monthly_hours venaient d'être ajoutées sur `users`
-- (20260101000075), mais "users: read within org" (20260101000009)
-- autorise n'importe quel membre de l'organisation à lire n'importe
-- quelle ligne `users` — légitime pour un nom, un téléphone, un
-- rôle... mais pas pour un salaire. RLS filtre des lignes, pas des
-- colonnes : il faut une table à part pour isoler correctement
-- l'accès à une donnée de cette sensibilité.
--
-- Les 3 colonnes restent sur `users` (orphelines, plus lues/écrites
-- par le code) — un DROP COLUMN se heurte à une confirmation
-- destructrice bloquée sur ce projet ; voir hourly_rate, laissée dans
-- le même état pour la même raison.
create table user_contracts (
  user_id uuid primary key references users (id) on delete cascade,
  monthly_gross_salary numeric(8, 2),
  monthly_net_salary numeric(8, 2),
  contractual_monthly_hours numeric(6, 2) not null default 151.67,
  updated_at timestamptz not null default now()
);

insert into user_contracts (user_id, monthly_gross_salary, monthly_net_salary, contractual_monthly_hours)
select id, monthly_gross_salary, monthly_net_salary, contractual_monthly_hours
from users
where monthly_gross_salary is not null or monthly_net_salary is not null;

alter table user_contracts enable row level security;

create policy "user_contracts: read own or direction"
  on user_contracts for select
  using (user_id = public.current_app_user_id() or public.is_direction());

create policy "user_contracts: direction writes"
  on user_contracts for all
  using (public.is_direction())
  with check (public.is_direction());
