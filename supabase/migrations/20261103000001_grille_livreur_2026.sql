-- Grille de l'application Livreur (module route_optimizer, facturé au palier
-- d'utilisateurs) validée le 23/10/2026 : prix en hausse et lectures IA
-- incluses par chauffeur (lib/usage/quotas.ts, LECTURES_PAR_CHAUFFEUR).
-- UPDATE seulement : aucune ligne supprimée. Rejouable. La synchronisation
-- nocturne des paliers (synchroniserPaliers) répercute les nouveaux prix sur
-- les abonnements Stripe à la prochaine échéance, sans prorata.
update public.module_user_tiers set monthly_price = 35.00 where module_key = 'route_optimizer' and min_users = 1;
update public.module_user_tiers set monthly_price = 69.00 where module_key = 'route_optimizer' and min_users = 6;
update public.module_user_tiers set monthly_price = 119.00 where module_key = 'route_optimizer' and min_users = 16;
update public.module_user_tiers set monthly_price = 199.00 where module_key = 'route_optimizer' and min_users = 31;
update public.module_user_tiers set monthly_price = 299.00 where module_key = 'route_optimizer' and min_users = 61;
update public.module_user_tiers set monthly_price = 299.00, extra_per_user = 3.00 where module_key = 'route_optimizer' and min_users = 101;
