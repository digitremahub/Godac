-- Suite de 20261111000002 : dédoublonnage et périmètre de lecture des alertes
-- « planning à confirmer ».
--
-- 1. cle_dedoublonnage : « planning:a_confirmer:<service>:<lundi> » (génération),
--    « planning:rappel:<service>:<lundi> » (rappel du vendredi, une seule fois),
--    « planning:envoye:<service>:<lundi> » (envoi automatique). L'index unique
--    (organisation, clé) garantit une alerte par semaine et par service même si
--    deux exécutions du cron se chevauchent (le code ignore le conflit 23505).
--    La colonne et l'index existent depuis 20261108000002 : ils sont repris
--    ici pour que cette migration se suffise à elle-même (rejouable).
-- 2. Lecture : « planning à confirmer » est une information d'encadrement. Le
--    comptable ne la lit pas ; un manager ne lit que celles de ses services.
--    Les deux policies reprennent EXACTEMENT celles de 20261110000002, avec le
--    nouveau type en plus dans chaque liste : aucun type existant n'est retiré
--    (tournee_retard, tournee_non_demarree, tournee_sans_chauffeur,
--    echeance_vehicule, echeance_rh, pointage_a_regulariser, paiement_echoue).
--    `type::text` : fonctionne même si la valeur d'enum n'est pas appliquée.
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
        and type::text not in ('tournee_retard', 'tournee_non_demarree', 'tournee_sans_chauffeur', 'echeance_vehicule', 'echeance_rh', 'pointage_a_regulariser', 'paiement_echoue', 'planning_a_confirmer')
      )
      or (
        public.current_role() in ('manager', 'manager_chauffeur')
        and (
          service_id = any (public.current_user_service_ids())
          or (service_id is null and type::text not in ('tournee_retard', 'tournee_non_demarree', 'tournee_sans_chauffeur', 'echeance_vehicule', 'echeance_rh', 'pointage_a_regulariser', 'paiement_echoue', 'planning_a_confirmer'))
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
          or (service_id is null and type::text not in ('tournee_retard', 'tournee_non_demarree', 'tournee_sans_chauffeur', 'echeance_vehicule', 'echeance_rh', 'pointage_a_regulariser', 'paiement_echoue', 'planning_a_confirmer'))
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

notify pgrst, 'reload schema';
