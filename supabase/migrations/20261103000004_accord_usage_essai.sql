-- Accord FACULTATIF de partage du détail d'usage, pour les comptes d'essai
-- « GO Navigation » (retours terrain, RGPD) : par défaut GODAC ne voit que
-- des statistiques agrégées ; le détail (tournées, horaires, chronologie
-- d'usage, jamais les noms ni adresses des destinataires) n'est consultable
-- que si l'utilisateur a coché l'accord, qu'il peut retirer à tout moment.
--
-- ADDITIVE et rejouable : « add column if not exists » seulement, aucun
-- drop, aucun delete. Les colonnes héritent des policies de organizations
-- (lecture de sa propre organisation ; écriture par le serveur via le
-- client service) : aucune policy à ajouter.
--  * partage_usage_detail      : accord en vigueur (faux par défaut, donc
--                                 aussi pour les comptes déjà inscrits).
--  * partage_usage_detail_at   : date du dernier changement (accord donné
--                                 ou retiré), posée côté serveur.
--  * partage_usage_detail_texte: version + texte exact accepté lors du
--                                 dernier accord (preuve).

alter table public.organizations add column if not exists partage_usage_detail boolean not null default false;
alter table public.organizations add column if not exists partage_usage_detail_at timestamptz;
alter table public.organizations add column if not exists partage_usage_detail_texte text;

notify pgrst, 'reload schema';
