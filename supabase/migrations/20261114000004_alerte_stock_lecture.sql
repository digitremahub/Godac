-- Suite de 20261114000003 : périmètre de lecture des alertes du module Stock
-- (types stock_seuil, stock_ecart, stock_non_rentre).
--
-- Information d'encadrement : le comptable ne les lit pas ; un manager ne lit que
-- celles de ses services (l'alerte porte le service du dépôt ou de la tournée ;
-- sans service, seules la direction et l'exploitation les lisent).
-- Les deux policies reprennent EXACTEMENT celles de 20261111000006, avec les
-- nouveaux types en plus dans chaque liste : aucun type existant n'est retiré
-- (tournee_retard, tournee_non_demarree, tournee_sans_chauffeur, echeance_vehicule,
-- echeance_rh, pointage_a_regulariser, paiement_echoue, planning_a_confirmer,
-- planning_fusion).
-- `type::text` : fonctionne même si les valeurs d'enum ne sont pas appliquées.
--
-- ADDITIVE et rejouable ; NON appliquée à la création.

alter policy "alerts: read within org for manager-like and comptable" on public.alerts
  using (
    organization_id = public.current_organization_id()
    and (
      public.current_role() = 'direction'
      or (
        public.current_role() = 'comptable'
        and type::text not in ('tournee_retard', 'tournee_non_demarree', 'tournee_sans_chauffeur', 'echeance_vehicule', 'echeance_rh', 'pointage_a_regulariser', 'paiement_echoue', 'planning_a_confirmer', 'planning_fusion', 'stock_seuil', 'stock_ecart', 'stock_non_rentre')
      )
      or (
        public.current_role() in ('manager', 'manager_chauffeur')
        and (
          service_id = any (public.current_user_service_ids())
          or (service_id is null and type::text not in ('tournee_retard', 'tournee_non_demarree', 'tournee_sans_chauffeur', 'echeance_vehicule', 'echeance_rh', 'pointage_a_regulariser', 'paiement_echoue', 'planning_a_confirmer', 'planning_fusion', 'stock_seuil', 'stock_ecart', 'stock_non_rentre'))
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
          or (service_id is null and type::text not in ('tournee_retard', 'tournee_non_demarree', 'tournee_sans_chauffeur', 'echeance_vehicule', 'echeance_rh', 'pointage_a_regulariser', 'paiement_echoue', 'planning_a_confirmer', 'planning_fusion', 'stock_seuil', 'stock_ecart', 'stock_non_rentre'))
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
