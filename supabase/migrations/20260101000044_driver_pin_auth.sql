-- GODAC V2 — Lot 7 (validé) : connexion des chauffeurs sans email.
--
-- Décision retenue après le plan posé dans la PR : option "identifiant
-- + PIN", mais le PIN n'est pas choisi par la direction — il est créé
-- par le chauffeur lui-même à la première connexion, en scannant son
-- badge QR (déjà existant, type `driver`). La direction se contente de
-- créer la fiche (nom, rôle, service) ; GODAC fabrique un email interne
-- non joignable (jamais montré au chauffeur) pour rester 100% dans
-- Supabase Auth standard (signInWithPassword), exactement comme décrit
-- dans le plan — aucun pont d'authentification parallèle à maintenir.
--
-- `auth_method` distingue les deux populations : 'email' (comportement
-- existant, lien magique ou mot de passe) et 'pin' (nouveau). Pour un
-- compte 'pin', `pin_set_at` vaut null tant que le chauffeur n'a pas
-- encore scanné son badge et choisi son code — c'est ce qui fait la
-- différence entre "proposer de créer un PIN" et "proposer de saisir
-- son PIN" sur /driver-pin/[id].
create type user_auth_method as enum ('email', 'pin');

alter table users add column auth_method user_auth_method not null default 'email';
alter table users add column pin_set_at timestamptz;
