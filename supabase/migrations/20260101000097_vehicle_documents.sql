-- Papiers du véhicule (carte grise, assurance, contrôle technique,
-- licence communautaire…). L'exploitation dépose les fichiers ; pour
-- chacun elle choisit s'il est consultable à tout moment par les
-- chauffeurs (driver_visible) — au contrôle routier, le chauffeur
-- l'affiche depuis la fiche du camion scanné sans attendre personne.
-- Les autres documents se demandent (alerte vehicle_document_request).
create table if not exists vehicle_documents (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  vehicle_id uuid not null references vehicles (id) on delete cascade,
  doc_type text not null,
  file_path text not null,
  expires_on date,
  driver_visible boolean not null default true,
  uploaded_by uuid references users (id) on delete set null,
  uploaded_at timestamptz not null default now()
);

create index if not exists vehicle_documents_vehicle_idx on vehicle_documents (vehicle_id);
create index if not exists vehicle_documents_org_idx on vehicle_documents (organization_id);

alter table vehicle_documents enable row level security;

-- Lecture : l'exploitation et la comptabilité voient tout ; les autres
-- rôles (chauffeurs) seulement ce qui est marqué consultable.
create policy "vehicle_documents: read within org"
  on vehicle_documents for select
  using (
    organization_id = public.current_organization_id()
    and (public.is_manager_like() or public.current_role() = 'comptable' or driver_visible)
  );

create policy "vehicle_documents: manager-like write"
  on vehicle_documents for all
  using (organization_id = public.current_organization_id() and public.is_manager_like())
  with check (organization_id = public.current_organization_id() and public.is_manager_like());

-- Fichiers : bucket privé. Écriture par l'exploitation dans le dossier
-- de son organisation ; la lecture passe uniquement par des URL signées
-- de courte durée générées côté serveur après contrôle RLS de la ligne.
insert into storage.buckets (id, name, public)
values ('vehicle-documents', 'vehicle-documents', false)
on conflict (id) do nothing;

create policy "vehicle-documents: manager-like writes"
  on storage.objects for insert
  with check (
    bucket_id = 'vehicle-documents'
    and (storage.foldername(name))[1] = public.current_organization_id()::text
    and public.is_manager_like()
  );

alter type alert_type add value if not exists 'vehicle_document_request';
