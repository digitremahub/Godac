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

## Position GPS de pointage : 2 mois

- `lib/retention/gps-pointage.ts` : `GPS_POINTAGE_JOURS = 60`, repris par `RETENTION_DAYS.clockGps` (`lib/retention/purge.ts`, cron `/api/cron/retention`, nocturne).
- Passé 60 jours, `clock_in_lat/lng` et `clock_out_lat/lng` sont mis à `null` ; les lignes de `time_clock_entries` restent (heures d'entrée et de sortie, source, sortie automatique, dernière présence au dépôt). Les pointages eux-mêmes sont gardés 5 ans.
- Seule règle qui lit ces coordonnées : le calcul des heures de `equipe/paie/heures` (un badge d'entrée géolocalisé au dépôt remplace l'heure de badge par l'heure planifiée, sur le mois affiché). Elle ne regarde que le mois choisi ; pour un mois dont la fin a plus de 60 jours, la substitution n'est plus possible et la page affiche une note (`moisSansPositions`). Les bulletins validés sont figés, donc inchangés. La régularisation des pointages ouverts (`lib/time-clock/regularisation-serveur.ts`) n'utilise aucune coordonnée.
- Conséquence visible : dans l'historique des pointages, le libellé du lieu (« Dépôt », « Domicile », « Autre lieu ») redevient « inconnu » après 2 mois, puisqu'il se calcule à partir des coordonnées.
- Textes alignés : confidentialité, DPA (annexe 1), CGU (art. 4).

## Fin de contrat : suppression des données à 3 mois

Migration : `supabase/migrations/20261112000001_fin_contrat_suppression.sql` (additive, idempotente, **rien n'est supprimé par la migration**). Sans elle, le cron répond « migration absente » et ne fait rien.

**Représentation de la fin de contrat** (`lib/fin-contrat/regles.ts`, `dateFinContrat`) :
- abonnement Stripe annulé : le webhook (`enregistrerFinContratStripe`) pose `organizations.contrat_termine_le` (`ended_at`, sinon `canceled_at`), une seule fois ; une réactivation (statut `active`, `trialing`, `past_due`) l'efface ainsi que le préavis ;
- essai gratuit GO Navigation (`offre = 'go_navigation'`, sans abonnement) : `trial_ends_at` ;
- client facturé hors Stripe : la date est posée par GODAC (page `godac-staff/<org>`, bloc « Fin de contrat »). **Sans date connue, une organisation n'est jamais touchée.** Un abonnement Stripe vivant et une organisation de démonstration ne le sont jamais non plus.
- À l'application de la migration, les organisations déjà au statut `canceled` reçoivent `contrat_termine_le = now()` (le délai de 90 jours part de ce jour, jamais d'une date antérieure inconnue).

**Cron** `/api/cron/fin-contrat` (`10 5 * * *`, quotidien uniquement : plan Vercel Hobby ; protégé par `CRON_SECRET` ; listé dans `SANS_GARDERAPI` de `audit-routes-lot4.test.ts`) :
1. fin + 60 jours : préavis par e-mail (Resend) aux comptes direction de l'organisation, avec la date de suppression et le rappel de l'export. Enregistré dans `suppression_preavis_envoye_le` et au journal d'audit (`fin_contrat_preavis`). Sans contact ou sans e-mail envoyé : erreur au bilan, pas de préavis, donc pas de suppression ;
2. fin + 90 jours **et** au moins 30 jours après l'envoi du préavis : suppression. Si le cron a été en panne, le préavis part en retard et la suppression est repoussée d'autant (jamais de suppression sans 30 jours de préavis) ;
3. au plus 3 suppressions par passage (`SUPPRESSIONS_MAX_PAR_PASSAGE`), les autres sont reportées au lendemain ;
4. l'état de l'organisation est relu juste avant la suppression, et la fonction SQL revérifie tout dans sa transaction (démo, blocage, 90 jours, préavis de 30 jours, abonnement vivant).

**Blocage en cas de litige** : `organizations.suppression_bloquee` (+ `suppression_bloquee_motif`, `_le`, `_par`). Posé ou levé par la direction GODAC (page `godac-staff/<org>`, route `PATCH /api/godac-staff/organisations/<id>/fin-contrat`, liste blanche `GODAC_STAFF_EMAILS`, tracé au journal d'audit). Tant qu'il est posé : ni préavis ni suppression. Un trigger interdit à tout utilisateur d'une entreprise cliente de modifier ces colonnes.

**DRY-RUN par défaut** : tant que `FIN_CONTRAT_PURGE_ACTIVE` n'est pas exactement `true`, le cron ne fait que journaliser (lignes JSON `{"evenement":"fin_contrat","mode":"dry-run","resultat":"DRY_RUN_SUPPRESSION"|"DRY_RUN_PREAVIS"|"BLOQUEE",...}` dans les journaux Vercel) et renvoie le bilan : **aucun e-mail n'est envoyé et rien n'est supprimé**. Mise en route conseillée : laisser le DRY-RUN quelques jours, vérifier la liste, poser des blocages si besoin, puis passer la variable à `true` (les préavis partent alors ; la première suppression a lieu au plus tôt 30 jours plus tard).

**Ce qui est supprimé** (action irréversible) : les fichiers de chaque bucket sous le préfixe `<organization_id>/` (`BUCKETS_PAR_ORGANISATION` ; un test échoue si une migration crée un bucket oublié de la liste), puis, en une seule transaction (`supprimer_organisation_fin_contrat`), les tables à clé `ON DELETE RESTRICT` (`fuel_gap_reviews`, `fuel_entries`, `vehicle_washes`, `ticpe_exports`) et l'organisation, dont tout le reste part en cascade (utilisateurs, pointages, tournées, paie, planning, journal d'audit…). Les comptes de connexion sont supprimés ensuite par l'API d'authentification ; en cas d'échec, les identifiants restent dans `organisations_supprimees.auth_utilisateurs_restants` et le passage suivant les reprend. Si le stockage ne peut être lu ou vidé, rien n'est supprimé en base et le passage suivant réessaie.

**Ce qui est conservé** (`ELEMENTS_CONSERVES`, table `organisations_supprimees` + `organisations_supprimees_journal`, lisibles par la seule clé de service) : identité de facturation (nom, SIRET, adresse légale, pays, offre), identifiants Stripe, dates de contrat et de préavis ; copie des preuves d'acceptation et de consentement du journal d'audit (`ACTIONS_AUDIT_CONSERVEES` : inscription à l'essai, accord de partage d'usage, accusé de lecture des paramètres indicatifs, préavis, blocage, changement de date) ; trace de la suppression. Les factures restent chez Stripe. Aucune donnée métier.

Limites connues : l'archive n'est pas purgée automatiquement (10 ans pour la facturation, 5 ans pour les preuves : à planifier) ; les tables sans clé vers `organizations` (limiteur de débit, erreurs client, journaux anti-abus) ne sont pas ciblées (elles ont leurs propres purges ou ne contiennent pas de données de l'organisation) ; un nouveau bucket doit être ajouté à `BUCKETS_PAR_ORGANISATION` ; les sauvegardes de l'hébergeur (7 jours) expirent d'elles-mêmes.

## Niveau de service (SLA)

La page `/sla` ne promet ni pourcentage de disponibilité ni avoir ou crédit automatique : engagement de moyens, information en cas de panne significative, délais d'intervention cibles, assistance, geste commercial discrétionnaire. Le bon de commande et les CGV y renvoient. Ne pas réintroduire de chiffre de disponibilité dans la vitrine sans accord préalable du fondateur.

## Outils

- Les copies de travail `.claude/worktrees` sont exclues de `tsconfig.json` et de `vitest.config.ts`.
- Plan Vercel Hobby : aucun cron plus fréquent qu'une fois par jour (`vercel.json`, test de garde dans `audit-routes-lot2.test.ts` et `audit-routes-lot4.test.ts`).
- `npm run lint` n'est pas dans le flux de vérification : le dépôt n'a aucune configuration ESLint (`next lint` pose une question interactive). À traiter à part.
