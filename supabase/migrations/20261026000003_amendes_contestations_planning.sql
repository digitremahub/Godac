-- Amendes et contestations clients : pièces obligatoires, rapprochement
-- avec le planning / la tournée colis, validation du responsable et
-- échanges avec le chauffeur concerné.
--
-- ADDITIVE et rejouable : uniquement des « add column if not exists »,
-- « create … if not exists », des policies créées si absentes et une
-- valeur d'enum ajoutée (jamais utilisée dans cette migration). Aucun
-- drop, aucune suppression de données. Le code tolère son absence
-- (lib/rattachement/tolerance.ts) : il retombe alors sur les colonnes
-- historiques.
--
--  1. fines : pièces (photo / PDF de l'avis), champs lus sur l'avis,
--     rattachement (créneau de planning, tournée colis, chauffeur
--     suggéré, indice de confiance, détail), validation.
--     Le chauffeur désigné reste `fines.driver_id` (colonne historique,
--     lue par la RLS « fines: read within org ») : pas de colonne
--     `assigned_driver_id` en doublon, qui créerait une seconde vérité.
--  2. customer_disputes : plusieurs documents, rattachement (créneau,
--     tournée, indice, détail des preuves). Le chauffeur désigné reste
--     `driver_id`, l'arrêt retrouvé `delivery_stop_id` (existants).
--  3. fine_status : valeur « dismissed » (amende classée).
--  4. case_comments : explications et photos ajoutées par le chauffeur
--     ou l'encadrement sur une amende ou une contestation.
--  5. fine-photos : lecture directe réservée à l'encadrement et au
--     comptable ; le chauffeur passe par un lien signé délivré après
--     contrôle (app/api/fines/[id]/piece).

-- ── 1. fines ────────────────────────────────────────────────────────
alter table public.fines
  add column if not exists document_paths text[] not null default '{}',
  add column if not exists location text,
  add column if not exists reduced_amount numeric(10, 2),
  add column if not exists payment_deadline date,
  add column if not exists planning_entry_id uuid references public.planning_entries (id) on delete set null,
  add column if not exists run_id uuid references public.delivery_runs (id) on delete set null,
  add column if not exists suggested_driver_id uuid references public.users (id) on delete set null,
  add column if not exists match_confidence text check (match_confidence is null or match_confidence in ('exact', 'probable', 'aucun')),
  add column if not exists match_details jsonb,
  add column if not exists matched_at timestamptz,
  add column if not exists validated_by uuid references public.users (id) on delete set null,
  add column if not exists validated_at timestamptz;

-- Reprise : la photo historique devient la première pièce.
update public.fines
set document_paths = array[photo_path]
where photo_path is not null and cardinality(document_paths) = 0;

create index if not exists fines_driver_idx on public.fines (driver_id);

-- ── 2. customer_disputes ────────────────────────────────────────────
alter table public.customer_disputes
  add column if not exists document_paths text[] not null default '{}',
  add column if not exists recipient text,
  add column if not exists planning_entry_id uuid references public.planning_entries (id) on delete set null,
  add column if not exists run_id uuid references public.delivery_runs (id) on delete set null,
  add column if not exists match_confidence text check (match_confidence is null or match_confidence in ('exact', 'probable', 'aucun')),
  add column if not exists match_details jsonb,
  add column if not exists matched_at timestamptz;

update public.customer_disputes
set document_paths = array[document_path]
where document_path is not null and cardinality(document_paths) = 0;

-- ── 3. Statut « classée » des amendes ───────────────────────────────
-- Ajout seul, jamais utilisé ici (une valeur d'enum ne peut pas servir
-- dans la transaction qui la crée).
alter type fine_status add value if not exists 'dismissed';

-- ── 4. Échanges sur une amende / une contestation ───────────────────
create table if not exists public.case_comments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  fine_id uuid references public.fines (id) on delete cascade,
  dispute_id uuid references public.customer_disputes (id) on delete cascade,
  author_id uuid references public.users (id) on delete set null,
  body text not null default '' check (char_length(body) <= 4000),
  photo_paths text[] not null default '{}' check (cardinality(photo_paths) <= 3),
  created_at timestamptz not null default now(),
  check ((fine_id is null) <> (dispute_id is null))
);
create index if not exists case_comments_fine_idx on public.case_comments (fine_id, created_at);
create index if not exists case_comments_dispute_idx on public.case_comments (dispute_id, created_at);

alter table public.case_comments enable row level security;

-- Écriture uniquement par l'application (service role, après contrôle
-- d'accès) : aucune policy insert / update / delete côté client.
revoke update, delete, truncate on public.case_comments from anon, authenticated;
revoke all on public.case_comments from anon;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'case_comments'
      and policyname = 'case_comments: read own case or management'
  ) then
    create policy "case_comments: read own case or management" on public.case_comments
      for select
      using (
        organization_id = public.current_organization_id()
        and (
          -- Amende : même périmètre que « fines: read within org ».
          exists (select 1 from public.fines f where f.id = case_comments.fine_id)
          -- Contestation : encadrement, ou chauffeur attributaire (RLS de customer_disputes).
          or exists (select 1 from public.customer_disputes d where d.id = case_comments.dispute_id)
        )
      );
  end if;
end
$$;

-- ── 5. Bucket fine-photos ───────────────────────────────────────────
-- Avant : tout membre de l'organisation pouvait lire tous les avis.
-- Le chauffeur ne voit plus que les siens, via lien signé (RGPD).
alter policy "fine-photos: read within org" on storage.objects
  using (
    bucket_id = 'fine-photos'
    and (storage.foldername(name))[1] = public.current_organization_id()::text
    and (public.is_manager_like() or public.current_role() in ('comptable', 'direction'))
  );
