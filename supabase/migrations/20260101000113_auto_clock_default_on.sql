-- Pointage assisté par géolocalisation (badge automatique à moins de
-- 300 m du dépôt) activé d'office pour toutes les organisations,
-- existantes et nouvelles. La direction peut toujours le désactiver
-- dans Admin > Organisation.
alter table organizations alter column auto_clock_enabled set default true;
update organizations set auto_clock_enabled = true where auto_clock_enabled = false;
