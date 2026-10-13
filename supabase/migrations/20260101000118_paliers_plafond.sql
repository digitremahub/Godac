-- App Livreur : palier bloqué à 99 € (16 à 30 utilisateurs), puis 1 € par
-- utilisateur supplémentaire au-delà de 30.
delete from module_user_tiers where module_key = 'route_optimizer' and min_users > 30;
insert into module_user_tiers (module_key, min_users, max_users, monthly_price, extra_per_user)
values ('route_optimizer', 31, null, 99, 1);
