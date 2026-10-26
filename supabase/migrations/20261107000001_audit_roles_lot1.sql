-- Audit des rôles du lot 1 « exploitation » (PR 279) : périmètre des alertes de
-- tournée et fonction d'agrégats de l'accueil direction.
--
-- 1. Alertes de tournée (tournee_retard, tournee_non_demarree,
--    tournee_sans_chauffeur) : elles nomment un chauffeur. La RLS d'origine
--    (20260101000078, 20261027000002) laissait le comptable lire toutes les
--    alertes de l'organisation et un manager lire celles sans service
--    (service_id null). Désormais : pas de lecture pour le comptable ; un
--    manager ne lit que celles de ses services (une tournée sans service
--    reste à l'exploitation et à la direction, comme dans le suivi en direct).
--    La mise à jour (prise en compte, résolution) est bornée aux services du
--    manager de la même façon. Exploitation et direction : inchangées.
--    `type::text` : fonctionne même si les valeurs d'enum des migrations
--    20261104000001 et 20261106000001 ne sont pas encore appliquées.
-- 2. accueil_direction_agregats : exécutable par les seuls utilisateurs
--    connectés (plus par le rôle anonyme). SECURITY INVOKER : la RLS de
--    l'appelant s'applique, un non-direction ne reçoit que ce qu'elle lui
--    ouvre ; l'accueil direction reste réservé à la direction par la page.
--
-- ADDITIVE et rejouable (alter policy, revoke/grant) ; NON appliquée à la
-- création : tant qu'elle ne l'est pas, le code filtre déjà ces alertes.

alter policy "alerts: read within org for manager-like and comptable" on public.alerts
  using (
    organization_id = public.current_organization_id()
    and (
      public.current_role() = 'direction'
      or (
        public.current_role() = 'comptable'
        and type::text not in ('tournee_retard', 'tournee_non_demarree', 'tournee_sans_chauffeur')
      )
      or (
        public.current_role() in ('manager', 'manager_chauffeur')
        and (
          service_id = any (public.current_user_service_ids())
          or (service_id is null and type::text not in ('tournee_retard', 'tournee_non_demarree', 'tournee_sans_chauffeur'))
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
          or (service_id is null and type::text not in ('tournee_retard', 'tournee_non_demarree', 'tournee_sans_chauffeur'))
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

revoke execute on function public.accueil_direction_agregats(timestamptz, timestamptz) from public, anon;
grant execute on function public.accueil_direction_agregats(timestamptz, timestamptz) to authenticated;
