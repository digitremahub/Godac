-- GODAC V2 — un chauffeur badge+PIN n'a pas de vraie adresse email :
-- auth_method='pin' fabrique une adresse interne jamais délivrée
-- (chauffeur-<uuid>@<org>.godac.local, voir lib/auth/driver-pin.ts)
-- pour servir d'identifiant Supabase Auth. Jusqu'ici, ça voulait dire
-- qu'aucune alerte/convocation/digest ne lui parvenait jamais par
-- email — ce champ optionnel, séparé de l'email de connexion, permet
-- d'indiquer une vraie adresse pour les notifications uniquement
-- (voir app/api/webhooks/supabase-alerts/route.ts).
alter table users add column contact_email text;
