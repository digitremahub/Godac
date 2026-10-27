# Garde-fous techniques (sécurité, performance, fiabilité)

Document interne. Il décrit les protections transversales ajoutées par le lot 4 de l'audit, où elles se trouvent et comment les prolonger. Les migrations associées sont additives et rejouables ; le code reste fonctionnel tant qu'elles ne sont pas appliquées (repli indiqué pour chaque garde-fou).

Migration : `supabase/migrations/20261109000001_lot4_securite_fiabilite.sql`.

## Limitation de débit des routes publiques

- Règles nommées : `lib/http/limite-debit.ts` (`REGLES_LIMITE`, maximum et fenêtre en secondes, par route et par adresse IP).
- Branchement serveur : `lib/http/limiteur-serveur.ts`. `limiterParIp(req, REGLES_LIMITE.xxx)` en première instruction de la route ; il renvoie une réponse 429 avec `Retry-After`, ou `null`.
- Stockage : table `rate_limits` et fonction SQL atomique `consommer_limite` (fenêtre glissante approchée par deux fenêtres fixes pondérées). L'adresse IP n'est stockée que hachée.
- Repli : si la fonction n'existe pas encore ou si la base ne répond pas, un journal glissant en mémoire de l'instance prend le relais (plus souple, jamais bloquant).
- Routes couvertes : connexion PIN (badge et e-mail), récupération/création de PIN, passkey (options, vérification), auto-inscription chauffeur, demande de démo, `/api/client-errors`. L'inscription GO Navigation garde son propre compteur par IP.
- Une nouvelle route publique doit appeler `limiterParIp` ; le test `lib/acces/__tests__/audit-routes-lot4.test.ts` liste les routes sans `garderApi` et échoue si une nouvelle apparaît sans relecture.

## Code PIN des chauffeurs

- `lib/auth/pin-securise.ts`. L'essai est **réservé avant** la vérification (fonction SQL `reserver_essai_pin`, verrou de ligne) : des essais en parallèle ne dépassent plus la limite.
- Deux compteurs : 5 essais par couple compte + adresse IP (verrou de 15 minutes pour cette adresse, simple trace au journal) et 20 essais toutes adresses confondues (verrou du compte, alerte critique à la direction). Un tiers qui connaît un badge ne bloque donc plus le chauffeur à distance en 5 essais.
- Le mot de passe dérivé (`PIN_PEPPER`) et l'algorithme de hachage ne changent pas. Les anciens mots de passe (PIN en clair, ancienne clé) restent acceptés et sont remplacés par le mot de passe en vigueur à la première connexion réussie.
- Repli : sans la migration, l'ancien compteur `pin_login_attempts` (non atomique) est utilisé.

## Passkeys

- Le challenge WebAuthn voyage dans un cookie signé (HMAC-SHA256, secret serveur `PIN_PEPPER`, comparaison à temps constant) avec expiration de 180 s dans la valeur signée : `lib/auth/challenge-signe.ts`.
- Usage unique : `consommerChallenge` (dans `lib/auth/webauthn.ts`) supprime le cookie dès la lecture et marque le challenge comme consommé (compteur atomique). Un échec oblige à redemander des options.
- `available: true/false` reste dans la réponse de `login/options` : la rendre uniforme ferait ouvrir la biométrie du téléphone pour des comptes sans passkey. La route est limitée par IP pour borner l'énumération.

## Logo du bulletin de paie (SSRF)

`lib/http/fetch-image-sure.ts` : https seulement, port 443, sans identifiants ; le nom est résolu et toutes les adresses doivent être publiques ; la connexion est épinglée sur l'adresse contrôlée ; redirections suivies à la main (3 au plus, chacune recontrôlée) ; délai de 4 s, taille de 2 Mo, PNG/JPEG reconnus par leurs octets. La mise en page du bulletin ne change pas (`chargerLogo` garde sa signature).

## Offre et modules

- `lireEtatOffre` (`lib/go-navigation/etat.ts`) ne s'ouvre plus en cas d'erreur : il réutilise le dernier état lu s'il date de moins de 10 minutes, sinon l'offre est « indéterminée » et les accès gardés par module sont refusés (503 « vérification momentanément impossible » côté `garderApi`).
- `garderApi` mémorise le résultat des modules vérifiés quelques secondes (`lib/organization/modules-verifies.ts`) ; `moduleActif` (API colis) le réutilise au lieu de relire deux tables. La garde de chaque requête relit toujours la base.

## Erreurs d'affichage

- `app/error.tsx`, `app/global-error.tsx`, `app/livreur/error.tsx`, `app/(dashboard)/error.tsx` : message en français, bouton « Réessayer ». Les écrans partagent `components/shared/EcranErreur.tsx`.
- Signalement léger : `lib/observabilite/signaler-erreur.ts` envoie l'erreur à `POST /api/client-errors` (publique, limitée par IP). `lib/observabilite/erreurs-client.ts` retire e-mails, identifiants, jetons, numéros et paramètres d'URL. Stockage borné à 2000 lignes (`erreurs_client`, fonction `enregistrer_erreur_client`) ; sans la migration, simple ligne au journal serveur.

## Idempotence et file hors ligne

- Les actions de la file hors ligne portent `X-GODAC-Offline-Action` ; le serveur rejoue sans doublon (`lib/offline/idempotence-serveur.ts`, utilisé par `POST /api/colis/arrets`).
- Un seul onglet à la fois rejoue la file : `lib/offline/verrou-onglets.ts` (`navigator.locks`, sinon verrou `localStorage` avec expiration de 60 s).
- La synchronisation est montée dans `app/livreur/layout.tsx` (`SynchroHorsLigne`).
- Service worker (`public/sw.js`) : cache des seules ressources `/_next/static/` (noms à empreinte). Pas de mode hors ligne complet des pages.

## Appels externes

- Géocodage BAN/Nominatim : délai de 6 s (`DELAI_GEOCODAGE_MS` dans `lib/geo/geocode.ts`) ; adresse introuvable plutôt qu'attente illimitée.
- Lecture de rapport de tournée (`lib/ocr/tour-report.ts`) : délai de 45 s, un nouvel essai sur erreur passagère, message générique côté client (le détail de l'API reste au journal serveur), quota remboursé en cas d'échec.
- Jetons d'IA : `lib/usage/jetons.ts` enregistre jetons lus/écrits et unités « réelles » dans `usage_events` pour la lecture de bordereau et de rapport de tournée. Information interne : les quotas et la facturation continuent d'utiliser `units`.

## Position et trace GPS

La dernière position du chauffeur voyage avec le lot de la trace (`POST /api/colis/trace`, champ `position`), toutes les 30 s ou 10 points, et seule toutes les 60 s si aucun point n'est gardé. L'ancienne route `POST /api/colis/position` reste disponible pour les versions déjà installées.

## Outils

- Les copies de travail `.claude/worktrees` sont exclues de `tsconfig.json` et de `vitest.config.ts`.
- Plan Vercel Hobby : aucun cron plus fréquent qu'une fois par jour (`vercel.json`, test de garde dans `audit-routes-lot2.test.ts` et `audit-routes-lot4.test.ts`).
- `npm run lint` n'est pas dans le flux de vérification : le dépôt n'a aucune configuration ESLint (`next lint` pose une question interactive). À traiter à part.
