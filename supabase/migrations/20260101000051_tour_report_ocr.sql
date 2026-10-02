-- GODAC V2 — Lot C: lecture OCR du rapport de tournée (feuille de
-- départ et compte-rendu papier/terminal, ex: feuille DPD) pour
-- remplir automatiquement les informations de tournée plutôt que de
-- les ressaisir à la main.
alter table planning_entries add column report_bl_number text;
alter table planning_entries add column report_stops_total smallint;
alter table planning_entries add column report_packages_count smallint;
alter table planning_entries add column report_priority_count smallint;
alter table planning_entries add column report_stops_delivered smallint;
alter table planning_entries add column report_packages_missing smallint;
alter table planning_entries add column report_pickups smallint;
-- Raw AI extraction payload per capture ({"start": {...}, "end": {...}}) — audit/debug only, never read by business logic.
alter table planning_entries add column report_ocr_raw jsonb;
