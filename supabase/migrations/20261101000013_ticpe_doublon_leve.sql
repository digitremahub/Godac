-- Doublons de pleins (ticket + relevé de carte) : levée explicite.
--
-- Quand deux pleins du même véhicule se ressemblent (même jour de Paris, litres
-- proches), l'un des deux est écarté du montant TICPE tant qu'une personne n'a
-- pas confirmé « deux pleins distincts ». Cette confirmation est enregistrée sur
-- le plein (date et personne).
--
-- Additive : deux colonnes nullables. Le code reste tolérant si la migration n'est
-- pas appliquée (aucun doublon ne peut alors être levé, et la levée répond 503).

alter table public.fuel_entries add column if not exists ticpe_doublon_leve_le timestamptz;
alter table public.fuel_entries add column if not exists ticpe_doublon_leve_par uuid references public.users (id) on delete set null;

comment on column public.fuel_entries.ticpe_doublon_leve_le is
  'Une personne a confirmé que ce plein est distinct de celui qui lui ressemble (doublon probable levé).';
