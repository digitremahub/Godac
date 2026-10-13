-- Application GODAC Livreur (module Tournée colis) : facturée à
-- l'entreprise par palier d'utilisateurs (chauffeurs actifs ayant accès à
-- l'app), gratuite pour le chauffeur lui-même. Grille ajustable ici, sans
-- redéploiement : le prix du module est recalculé chaque nuit
-- (/api/cron/paliers) et à chaque activation / paiement.
create table module_user_tiers (
  module_key text not null references modules (key) on delete cascade,
  min_users integer not null check (min_users >= 0),
  max_users integer check (max_users is null or max_users >= min_users),
  monthly_price numeric(10, 2) not null check (monthly_price >= 0),
  -- Palier ouvert (max_users null) : supplément par utilisateur au-delà de min_users.
  extra_per_user numeric(10, 2) not null default 0,
  primary key (module_key, min_users)
);

alter table module_user_tiers enable row level security;

create policy "module_user_tiers: public read"
  on module_user_tiers for select
  using (true);

insert into module_user_tiers (module_key, min_users, max_users, monthly_price, extra_per_user) values
  ('route_optimizer', 1, 5, 29, 0),
  ('route_optimizer', 6, 15, 59, 0),
  ('route_optimizer', 16, 30, 99, 0),
  ('route_optimizer', 31, 60, 179, 0),
  ('route_optimizer', 61, 100, 279, 0),
  ('route_optimizer', 101, null, 279, 2.5);

-- Utilisateurs pris en compte pour le palier, mémorisés pour l'affichage.
alter table organization_modules add column billed_users integer;

update modules
set description = 'Application GODAC Livreur (App Store et Google Play), gratuite pour le chauffeur et facturée à l''entreprise par palier d''utilisateurs : scan des colis, ordre de passage optimisé, appel du client, photo de livraison, suivi en direct.'
where key = 'route_optimizer';
