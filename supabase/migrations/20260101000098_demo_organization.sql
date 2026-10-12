-- Mode démo : une organisation fictive (« Transports Démo »), recréée
-- par lib/demo/seed.ts (au premier accès à /demo puis chaque nuit via
-- /api/cron/reset-demo). is_demo coupe les e-mails/notifications
-- d'alertes, les invitations et la facturation pour cette organisation.
alter table organizations add column if not exists is_demo boolean not null default false;
create index if not exists organizations_is_demo_idx on organizations (is_demo) where is_demo;
-- Une seule organisation de démo : deux premiers accès simultanés à
-- /demo ne peuvent pas en créer deux (le second échoue et réutilise).
create unique index if not exists organizations_single_demo_idx on organizations ((true)) where is_demo;
