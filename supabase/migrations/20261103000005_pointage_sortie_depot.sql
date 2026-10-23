-- Sortie du dépôt pointée automatiquement (pointage assisté).
-- Migration additive et rejouable : deux colonnes sur les entrées de
-- pointage, aucune policy nouvelle (elles héritent de celles de la table).
--
--  - last_depot_seen_at : dernière fois où le téléphone du salarié a été
--    vu dans le rayon du dépôt pendant que son entrée était ouverte.
--    C'est la seule « mémoire » de présence : un horodatage, jamais un
--    historique de positions. Elle sert d'heure de sortie quand le
--    salarié quitte le dépôt (jamais « maintenant »).
--  - auto_clocked_out : la sortie a été pointée automatiquement ; seule
--    une telle sortie peut être annulée par le salarié (ré-ouverture).
alter table public.time_clock_entries add column if not exists last_depot_seen_at timestamptz;
alter table public.time_clock_entries add column if not exists auto_clocked_out boolean not null default false;
