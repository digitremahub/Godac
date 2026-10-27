-- Suite de 20261111000005 : périmètre de lecture des alertes « tournée fusionnée »
-- (type planning_fusion).
--
-- « Tournée fusionnée » est une information d'encadrement. Le comptable ne la lit
-- pas ; un manager ne lit que celles de ses services (l'alerte porte le service).
-- Les deux policies reprennent EXACTEMENT celles de 20261111000003 (qui
-- reprenait 20261110000002), avec le nouveau type en plus dans chaque liste :
-- aucun type existant n'est retiré (tournee_retard, tournee_non_demarree,
-- tournee_sans_chauffeur, echeance_vehicule, echeance_rh,
-- pointage_a_regulariser, paiement_echoue, planning_a_confirmer).
-- `type::text` : fonctionne même si la valeur d'enum n'est pas appliquée.
--
-- La clé de dédoublonnage (cle_dedoublonnage, « planning:fusion:<ligne hôte>:<tournées> »)
-- et son index unique existent depuis 20261108000002 / 20261111000003.
-- ADDITIVE et rejouable ; NON appliquée à la création.

alter policy "alerts: read within org for manager-like and comptable" on public.alerts
  using (
    organization_id = public.current_organization_id()
    and (
      public.current_role() = 'direction'
      or (
        public.current_role() = 'comptable'
        and type::text not in ('tournee_retard', 'tournee_non_demarree', 'tournee_sans_chauffeur', 'echeance_vehicule', 'echeance_rh', 'pointage_a_regulariser', 'paiement_echoue', 'planning_a_confirmer', 'planning_fusion')
      )
      or (
        public.current_role() in ('manager', 'manager_chauffeur')
        and (
          service_id = any (public.current_user_service_ids())
          or (service_id is null and type::text not in ('tournee_retard', 'tournee_non_demarree', 'tournee_sans_chauffeur', 'echeance_vehicule', 'echeance_rh', 'pointage_a_regulariser', 'paiement_echoue', 'planning_a_confirmer', 'planning_fusion'))
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
          or (service_id is null and type::text not in ('tournee_retard', 'tournee_non_demarree', 'tournee_sans_chauffeur', 'echeance_vehicule', 'echeance_rh', 'pointage_a_regulariser', 'paiement_echoue', 'planning_a_confirmer', 'planning_fusion'))
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
