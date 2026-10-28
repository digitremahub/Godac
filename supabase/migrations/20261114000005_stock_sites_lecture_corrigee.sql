-- Correctif Stock : enregistrer un dépôt échouait (« new row violates row-level
-- security policy for table stock_sites »).
--
-- Cause : l'application insère avec « returning », et la lecture du dépôt créé est
-- jugée par la policy de lecture. Celle-ci passait par la fonction
-- stock_sites_visibles(), qui relit la table stock_sites : une fonction « stable »
-- ne voit pas la ligne insérée par la même requête, donc la lecture était refusée
-- et toute la création annulée.
-- Correction : la policy de lecture de stock_sites juge directement les colonnes de
-- la ligne (même périmètre que stock_sites_visibles : chauffeur, exploitation et
-- direction voient tout ; un manager voit les dépôts de ses services et ceux sans
-- service). Les autres tables gardent stock_sites_visibles(), le dépôt existant déjà.
--
-- Additive : « alter policy » ne supprime rien.

alter policy "stock_sites: read in scope" on public.stock_sites
  using (
    organization_id = public.current_organization_id()
    and public.stock_peut_lire()
    and (
      public.current_role()::text in ('chauffeur', 'exploitation', 'direction')
      or service_id is null
      or service_id = any (public.current_user_service_ids())
    )
  );

notify pgrst, 'reload schema';
