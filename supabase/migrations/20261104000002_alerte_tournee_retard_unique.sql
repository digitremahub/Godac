-- Suite de 20261104000001 : au plus une alerte « tournee_retard » par
-- tournée, par palier (gravité) et par jour de Paris. Garde-fou contre deux
-- écrans de suivi qui chargent au même instant (le dédoublonnage du code
-- lit d'abord les alertes du jour). Un conflit renvoie 23505, ignoré par
-- le code. ADDITIVE et rejouable ; NON appliquée à la création.
create unique index if not exists alerts_tournee_retard_unique
  on public.alerts (related_id, severity, ((created_at at time zone 'Europe/Paris')::date))
  where type = 'tournee_retard';
