-- Carburant / flotte, lot 2.
--
-- 1. fuel_entries.controle_confirme : contrôle km / capacité du réservoir
--    confirmé par le chauffeur avec un motif court au lieu d'un refus en fin de
--    parcours. Forme : {"controles":[{"code":"km_recul","message":"…"}],
--    "motif":"…","par":"<user>","le":"<ISO>"}. Le plein est enregistré, l'écart
--    remonte dans « À traiter » (écart carburant) pour l'encadrement ; il est
--    traité comme les autres écarts (fuel_gap_reviews). Aucune donnée existante
--    n'est modifiée.
-- 2. fines.closed_at : date de clôture (réglée ou classée). La page de
--    confidentialité annonce « jusqu'à leur traitement, puis 1 an maximum » :
--    la purge (lib/retention/purge.ts) compte un an à partir de cette date.
--    Les amendes déjà clôturées reçoivent la date de cette migration (côté
--    prudent : un an de plus, jamais moins).
--
-- ADDITIVE et rejouable ; NON appliquée à la création. Tant qu'elle ne l'est
-- pas, le code retombe sur les colonnes historiques (confirmation tracée au
-- journal d'audit seulement ; amendes jamais purgées).
alter table public.fuel_entries add column if not exists controle_confirme jsonb;

alter table public.fines add column if not exists closed_at timestamptz;

update public.fines
set closed_at = now()
where closed_at is null and status::text in ('paid', 'dismissed');

create index if not exists fines_closed_at_idx on public.fines (closed_at) where closed_at is not null;
