-- Feuille de début de tournée (photo ou PDF), jointe au départ en plus de
-- la photo de l'écran « Statistiques Tournée » du terminal
-- (start_photo_path). Ajoutable après coup par la direction (Rapports).
alter table planning_entries add column if not exists start_sheet_path text;
