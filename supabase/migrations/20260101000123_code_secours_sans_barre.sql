-- Code de secours : « initiales + mois + année de naissance » sans
-- séparateur (FT1188 au lieu de FT11/88), plus simple à taper à la pompe.
update users
set driver_code = replace(driver_code, '/', '')
where driver_code like '%/%'
  and not exists (
    select 1 from users u2
    where u2.organization_id = users.organization_id and u2.driver_code = replace(users.driver_code, '/', '')
  );
