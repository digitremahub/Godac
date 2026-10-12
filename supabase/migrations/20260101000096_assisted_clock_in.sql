-- Pointage assisté par géolocalisation (désactivé par défaut, activable
-- par organisation dans Admin > Organisation). À l'ouverture de l'app,
-- si le salarié est à moins de 300 m du dépôt d'un de ses services, son
-- entrée est pointée automatiquement (annulable) ; en fin de journée la
-- sortie lui est proposée en un geste. La position n'est lue qu'à ce
-- moment-là — aucun suivi continu.
alter table organizations add column if not exists auto_clock_enabled boolean not null default false;

-- 'manual' = bouton « Badger l'entrée », 'auto' = pointage assisté.
alter table time_clock_entries add column if not exists clock_in_source text not null default 'manual';
alter table time_clock_entries drop constraint if exists time_clock_entries_clock_in_source_check;
alter table time_clock_entries
  add constraint time_clock_entries_clock_in_source_check check (clock_in_source in ('manual', 'auto'));
