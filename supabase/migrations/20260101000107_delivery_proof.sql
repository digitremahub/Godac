-- Preuve de livraison : lieu de dépôt (main propre, boîte aux lettres,
-- jardin, voisin, autre) et photo du colis livré — obligatoire pour la
-- boîte aux lettres et le jardin (contrôle dans /api/colis/arrets/[id]/livraison).
-- Photos dans un bucket privé, lues uniquement par lien signé après
-- contrôle d'accès (chauffeur de la tournée ou encadrement), effacées
-- avec la tournée 30 jours après (lib/retention/purge.ts).
alter table delivery_stops
  add column if not exists delivered_place text check (delivered_place in ('main_propre', 'boite_aux_lettres', 'jardin', 'voisin', 'autre')),
  add column if not exists proof_photo_path text;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('delivery-proofs', 'delivery-proofs', false, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

-- Contestation « colis non reçu » : l'arrêt retrouvé donne accès à la photo.
alter table customer_disputes
  add column if not exists delivery_stop_id uuid references delivery_stops (id) on delete set null;
