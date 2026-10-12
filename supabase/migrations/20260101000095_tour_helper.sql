-- « Dépanner un collègue » : un chauffeur peut démarrer ou clôturer la
-- tournée d'un collègue (badge + code PIN du collègue, vérifiés côté
-- serveur — voir lib/tours/on-behalf.ts). On garde la trace de qui a
-- réellement saisi le départ / le retour ; null = le chauffeur lui-même.
alter table planning_entries add column if not exists started_by uuid references users (id) on delete set null;
alter table planning_entries add column if not exists ended_by uuid references users (id) on delete set null;

comment on column planning_entries.started_by is 'Collègue ayant saisi le départ pour le chauffeur (dépannage), null si saisi par le chauffeur lui-même.';
comment on column planning_entries.ended_by is 'Collègue ayant saisi le retour pour le chauffeur (dépannage), null si saisi par le chauffeur lui-même.';
