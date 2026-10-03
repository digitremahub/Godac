-- GODAC V2 — champs supplémentaires lus sur le bordereau de tournée :
-- les horaires imprimés (distincts de start_at/end_at, pris par
-- l'appli au moment du scan) et les décomptes de colis que les
-- bordereaux papier détaillent au-delà de ce que Lot C lisait déjà
-- (ramassés, ramenés au dépôt, déposés en relais).
alter table planning_entries add column report_departure_time text;
alter table planning_entries add column report_return_time text;
alter table planning_entries add column report_packages_picked_up smallint;
alter table planning_entries add column report_packages_returned smallint;
alter table planning_entries add column report_packages_relay smallint;
