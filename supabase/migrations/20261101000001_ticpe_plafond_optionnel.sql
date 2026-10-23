-- Plafond de volume TICPE : plus de plafond par défaut.
--
-- Le plafond de 40 000 L/véhicule/an n'est sourcé nulle part (audit carburant) :
-- il ne s'applique désormais que si l'organisation l'a explicitement activé
-- (plafond_actif) et saisi, avec la mention « à confirmer par l'expert-comptable ».
--
-- Additive : une colonne ajoutée, deux contraintes de colonne assouplies
-- (not null / default), aucune donnée modifiée. Les lignes existantes passent
-- à plafond_actif = false : aucun plafond, y compris pour les organisations qui
-- avaient 40000 par simple valeur par défaut. Elles peuvent le réactiver.
-- Le code reste tolérant si cette migration n'est pas appliquée (aucun plafond).

alter table public.ticpe_settings
  add column if not exists plafond_actif boolean not null default false;

alter table public.ticpe_settings alter column plafond_litres drop not null;
alter table public.ticpe_settings alter column plafond_litres drop default;

comment on column public.ticpe_settings.plafond_actif is
  'Plafond de volume appliqué seulement si vrai et plafond_litres renseigné. Base légale non confirmée : à confirmer par l''expert-comptable.';
