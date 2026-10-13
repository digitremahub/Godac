-- Factures / comptes rendus déposés par le prestataire depuis
-- /prestataire/[token]. Bucket privé, chemin préfixé par
-- l'organisation (même convention que intervention-photos). Le dépôt
-- se fait uniquement côté serveur (client service-role, après contrôle
-- du jeton, du type MIME, de la signature du fichier et de la taille) :
-- aucune politique d'écriture pour les rôles clients.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('rental-invoices', 'rental-invoices', false, 10485760, array['application/pdf', 'image/jpeg', 'image/png'])
on conflict (id) do nothing;

create policy "rental-invoices: manager-like read within org"
  on storage.objects for select
  using (
    bucket_id = 'rental-invoices'
    and (storage.foldername(name))[1] = public.current_organization_id()::text
    and public.is_manager_like()
  );
