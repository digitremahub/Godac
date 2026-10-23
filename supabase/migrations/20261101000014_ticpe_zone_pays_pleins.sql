-- Zone TICPE et pays d'achat explicites sur chaque plein (audit carburant, R5).
--
-- Avant : la zone (Corse / métropole) était déduite d'une expression régulière sur
-- le nom de la station (faux positifs : « Corte-Real » à Lisbonne, 20095 Hambourg ;
-- faux négatifs : station corse sans mot-clé) et il n'existait aucune notion de
-- pays d'achat.
--
--   fuel_entries.ticpe_zone   'metropole' | 'corse' ; null = non renseignée (zone de
--                             la cuve pour un plein à la cuve, sinon zone par défaut
--                             de l'organisation — ticpe_settings.zone_par_defaut).
--   fuel_entries.pays_achat   code pays ISO (2 lettres) ; null = non renseigné,
--                             traité comme la France. Un plein dont le pays n'est pas
--                             FR n'est pas compté (règle prudente, à confirmer par
--                             l'expert-comptable).
--
-- Additive : deux colonnes nullables, aucune donnée modifiée. Le nom de la station
-- ne fait plus que PROPOSER la Corse ; le code reste tolérant si cette migration
-- n'est pas appliquée (zone par défaut, pays France).

alter table public.fuel_entries add column if not exists ticpe_zone text
  check (ticpe_zone is null or ticpe_zone in ('metropole', 'corse'));
alter table public.fuel_entries add column if not exists pays_achat text
  check (pays_achat is null or pays_achat ~ '^[A-Z]{2}$');

comment on column public.fuel_entries.ticpe_zone is 'Zone TICPE du plein saisie par une personne (metropole / corse) ; null = zone de la cuve ou zone par défaut de l''organisation.';
comment on column public.fuel_entries.pays_achat is 'Pays d''achat (code ISO) ; null = France. Hors FR : plein non compté pour la TICPE.';
