-- Carte des villages par tournée : coordonnées des communes, mises en
-- cache sur chaque village pour ne pas regéocoder à chaque affichage.
--
-- Remplies à la demande par /api/tour-routes/geocode (API officielle
-- geo.api.gouv.fr, sans clé). Toutes nullables : un village jamais
-- géocodé a geocoded_at null ; un village cherché mais introuvable a
-- geocode_status = 'introuvable' (on ne le recherche plus tant que son
-- nom ou son code postal ne change pas). Purement additif.

alter table tour_route_villages
  add column if not exists lat double precision,
  add column if not exists lng double precision,
  add column if not exists insee_code text,
  add column if not exists geocode_status text,
  add column if not exists geocoded_at timestamptz;

comment on column tour_route_villages.geocode_status is
  'ok = commune trouvée (lat/lng/insee_code renseignés) ; introuvable = aucune commune correspondante ; null = jamais géocodé';
