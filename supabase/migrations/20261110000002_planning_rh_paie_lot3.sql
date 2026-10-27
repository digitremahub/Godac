-- Planning / RH / paie, lot 3. ADDITIVE, rejouable, NON appliquée à la création :
-- le code est tolérant à l'absence de chaque colonne (estSchemaManquant).
--
-- 1. Pointage à régulariser. Un pointage resté ouvert est clos par le cron
--    quotidien avec une sortie estimée (fin planifiée, sinon entrée + durée
--    prévue, sinon à saisir) et marqué pour correction. La correction par
--    l'encadrement (motif obligatoire) passe par la route
--    /api/time-clock/regulariser avec le client service, après les gardes
--    serveur (rôle, service, hiérarchie) ; le trigger time_clock_entries_guard_author
--    ne s'applique qu'aux écritures d'un utilisateur connecté. La direction
--    reçoit en plus le droit de modifier en base (filet), l'exploitation et les
--    managers jamais directement.
alter table public.time_clock_entries add column if not exists needs_regularization boolean not null default false;
alter table public.time_clock_entries add column if not exists auto_closed_at timestamptz;
alter table public.time_clock_entries add column if not exists estimated_out_source text;
alter table public.time_clock_entries add column if not exists regularized_at timestamptz;
alter table public.time_clock_entries add column if not exists regularized_by uuid references public.users (id) on delete set null;
alter table public.time_clock_entries add column if not exists regularization_reason text;

alter table public.time_clock_entries drop constraint if exists time_clock_entries_estimated_out_source_check;
alter table public.time_clock_entries
  add constraint time_clock_entries_estimated_out_source_check
  check (estimated_out_source is null or estimated_out_source in ('planning', 'duree_prevue', 'a_saisir'));

-- Liste « Pointages à régulariser » : peu de lignes, lue souvent.
create index if not exists time_clock_entries_a_regulariser_idx
  on public.time_clock_entries (organization_id, clocked_in_at desc)
  where needs_regularization;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'time_clock_entries' and policyname = 'time_clock: direction regularises') then
    create policy "time_clock: direction regularises" on public.time_clock_entries
      for update
      using (organization_id = public.current_organization_id() and public.is_direction())
      with check (organization_id = public.current_organization_id() and public.is_direction());
  end if;
end
$$;

-- 2. Échéance d'un document du salarié (permis, visite médicale, titre de séjour,
--    diplôme). Facultative : un document sans date n'est pas suivi.
alter table public.employee_documents add column if not exists expires_at date;

-- 3. Facturation : état d'impayé (Stripe invoice.payment_failed). Aucun blocage
--    d'accès : le champ sert au bandeau « Paiement échoué : régularisez » et à
--    l'alerte de la direction. Effacé au paiement de la facture (invoice.paid).
alter table public.organizations add column if not exists payment_failed_at timestamptz;
alter table public.organizations add column if not exists payment_failed_invoice_id text;

-- 4. Paliers : dérive base / Stripe. Quand l'appel Stripe échoue après
--    l'écriture du prix en base, la ligne est marquée ; le cron des paliers
--    la reprend au passage suivant et l'erreur reste visible.
alter table public.organization_modules add column if not exists stripe_sync_pending boolean not null default false;
alter table public.organization_modules add column if not exists stripe_sync_error text;
alter table public.organization_modules add column if not exists stripe_sync_failed_at timestamptz;

-- 5. Lecture des alertes : les nouveaux types sont une information d'encadrement.
--    Le comptable ne les lit pas ; un manager ne lit que celles de ses services
--    (les alertes sensibles — visite médicale, fin de contrat, titre de séjour —
--    sont créées sans service : jamais pour un manager) ; paiement_echoue est
--    destinée à la direction (recipient_roles) et n'apparaît jamais chez un
--    manager. `type::text` : fonctionne même si les valeurs d'enum de
--    20261109000001 ne sont pas encore appliquées.
alter policy "alerts: read within org for manager-like and comptable" on public.alerts
  using (
    organization_id = public.current_organization_id()
    and (
      public.current_role() = 'direction'
      or (
        public.current_role() = 'comptable'
        and type::text not in ('tournee_retard', 'tournee_non_demarree', 'tournee_sans_chauffeur', 'echeance_vehicule', 'echeance_rh', 'pointage_a_regulariser', 'paiement_echoue')
      )
      or (
        public.current_role() in ('manager', 'manager_chauffeur')
        and (
          service_id = any (public.current_user_service_ids())
          or (service_id is null and type::text not in ('tournee_retard', 'tournee_non_demarree', 'tournee_sans_chauffeur', 'echeance_vehicule', 'echeance_rh', 'pointage_a_regulariser', 'paiement_echoue'))
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
          or (service_id is null and type::text not in ('tournee_retard', 'tournee_non_demarree', 'tournee_sans_chauffeur', 'echeance_vehicule', 'echeance_rh', 'pointage_a_regulariser', 'paiement_echoue'))
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
