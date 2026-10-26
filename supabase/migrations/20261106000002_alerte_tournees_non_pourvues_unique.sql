-- Suite de 20261106000001 : au plus une alerte « non démarrée » ou « sans
-- chauffeur » par tournée du planning et par jour de Paris. Garde-fou contre
-- deux exécutions du cron en même temps (le code lit d'abord les alertes
-- déjà créées). Un conflit renvoie 23505, ignoré par le code.
-- Index sur (type, related_id, jour) : un jour par tournée suffit, une
-- tournée de demain « sans chauffeur » est créée la veille et ne se
-- recrée pas le lendemain tant que son alerte du jour existe déjà.
-- ADDITIVE et rejouable ; NON appliquée à la création.
create unique index if not exists alerts_tournee_non_pourvue_unique
  on public.alerts (type, related_id, ((created_at at time zone 'Europe/Paris')::date))
  where type in ('tournee_non_demarree', 'tournee_sans_chauffeur');
