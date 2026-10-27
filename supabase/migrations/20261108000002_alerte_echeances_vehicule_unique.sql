-- Suite de 20261108000001 : clé de dédoublonnage des alertes d'échéance et
-- périmètre de lecture.
--
-- 1. cle_dedoublonnage : « document:<id>:<date d'échéance>:J-30 ». Une alerte
--    par échéance ET par palier (J-30, J-7, J0). Si la date d'échéance change
--    (document renouvelé avec une nouvelle date), les paliers repartent.
--    L'index unique est le garde-fou contre deux exécutions du cron en même
--    temps (le code lit d'abord les alertes déjà créées ; un conflit renvoie
--    23505, ignoré). Colonne facultative : les autres alertes ne l'utilisent pas
--    (sauf l'alerte douce de consommation, une par véhicule et par mois).
-- 2. Lecture : une échéance de véhicule est une information d'encadrement. Le
--    comptable ne la lit pas ; un manager ne lit que celles de ses services
--    (un véhicule sans service reste à l'exploitation et à la direction), comme
--    les alertes de tournée de 20261107000001. La mise à jour (prise en compte,
--    résolution) est bornée de la même façon. `type::text` : fonctionne même
--    si la valeur d'enum n'est pas encore appliquée.
--
-- ADDITIVE et rejouable ; NON appliquée à la création.
alter table public.alerts add column if not exists cle_dedoublonnage text;

create unique index if not exists alerts_cle_dedoublonnage_unique
  on public.alerts (organization_id, cle_dedoublonnage)
  where cle_dedoublonnage is not null;

alter policy "alerts: read within org for manager-like and comptable" on public.alerts
  using (
    organization_id = public.current_organization_id()
    and (
      public.current_role() = 'direction'
      or (
        public.current_role() = 'comptable'
        and type::text not in ('tournee_retard', 'tournee_non_demarree', 'tournee_sans_chauffeur', 'echeance_vehicule')
      )
      or (
        public.current_role() in ('manager', 'manager_chauffeur')
        and (
          service_id = any (public.current_user_service_ids())
          or (service_id is null and type::text not in ('tournee_retard', 'tournee_non_demarree', 'tournee_sans_chauffeur', 'echeance_vehicule'))
        )
      )
      or (
        public.is_exploitation()
        and (
          cardinality(recipient_roles) = 0
          or recipient_roles::text[] && array['manager', 'manager_chauffeur', 'exploitation']::text[]
        )
      )
    )
  );

alter policy "alerts: manager-like can acknowledge" on public.alerts
  using (
    organization_id = public.current_organization_id()
    and (
      public.current_role() = 'direction'
      or (
        public.current_role() in ('manager', 'manager_chauffeur')
        and (
          service_id = any (public.current_user_service_ids())
          or (service_id is null and type::text not in ('tournee_retard', 'tournee_non_demarree', 'tournee_sans_chauffeur', 'echeance_vehicule'))
        )
      )
      or (
        public.is_exploitation()
        and (
          cardinality(recipient_roles) = 0
          or recipient_roles::text[] && array['manager', 'manager_chauffeur', 'exploitation']::text[]
        )
      )
    )
  );
