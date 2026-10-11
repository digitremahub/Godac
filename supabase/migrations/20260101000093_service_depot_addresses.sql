-- Jusqu'ici une seule adresse de dépôt existait, au niveau de
-- l'organisation (organizations.depot_address/lat/lng) — insuffisant
-- pour une organisation dont chaque service part d'un dépôt différent
-- (classification "🏭 Dépôt" d'un badge pointeuse, calcul des heures
-- planning/badge de /payroll, estimation de distance "retour direct
-- à domicile"). Le dépôt de l'organisation reste utilisé comme repli
-- pour un service qui n'a pas le sien.
alter table public.services
  add column if not exists depot_address text,
  add column if not exists depot_lat numeric,
  add column if not exists depot_lng numeric;
