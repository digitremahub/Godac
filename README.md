# GODAC V2

Gestion et Optimisation Des Assets et Carburant — plateforme SaaS B2B
modulaire pour les PME françaises de transport routier de marchandises
(TRM), flottes mixtes VL/PL/SPL.

Ce dossier (`godac/`) contient l'application V2, construite en
full-stack propre (Next.js + Supabase + Stripe + Resend + Anthropic), à
côté du site vitrine Digitrema existant à la racine du repo — les deux
sont des projets indépendants dans le même repository.

---

## Stack

| Rôle | Techno |
|---|---|
| Frontend | Next.js 14 (App Router), déployé sur Vercel |
| Backend / DB / Auth | Supabase (Postgres + Row Level Security + Storage + Auth) |
| Paiement / abonnement SaaS | Stripe |
| Jobs / webhooks lourds | Route Handlers Next.js aujourd'hui, migrable vers Railway sans changer la logique (voir plus bas) |
| Email transactionnel | Resend |
| OCR tickets carburant / compteurs | Claude vision (Anthropic) |

Charte graphique : fond clair (`paper` `#F6F7FB`), texte `navy`
`#0A0F1E`, accents teal `#1BE4C1`, orange `#FF6B35`, gold `#F5C842`
(variantes foncées `-ink` pour le texte, voir plus bas), police
Poppins ExtraBold pour les titres et Inter pour le corps de texte
(voir `tailwind.config.ts`, `app/layout.tsx` et `app/globals.css`).

---

## Architecture multi-tenant

Une **organisation = une entreprise de transport cliente**, modélisée
uniquement dans nos propres tables Postgres (pas de système
d'organisations externe). Toute la donnée métier vit dans Postgres
(Supabase), isolée par `organization_id` via **Row Level Security
stricte** — jamais un filtre côté client. Voir
`supabase/migrations/20260101000009_rls_policies.sql` pour le détail
complet des règles par rôle.

L'authentification est celle de **Supabase Auth**, en connexion sans
mot de passe (lien magique envoyé par email — `supabase.auth.signInWithOtp`).
Aucun compte externe supplémentaire n'est nécessaire : un seul projet
Supabase couvre base de données, stockage et authentification. RLS
s'appuie directement sur `auth.uid()` — pas de pont JWT entre deux
systèmes à maintenir (voir `supabase/migrations/20260101000008_auth_helpers.sql`).
Même une requête mal filtrée côté frontend ne peut pas faire fuiter de
données d'un autre client : Postgres refuse la ligne, pas le code
applicatif.

`public.users.id` est directement l'id Supabase Auth de l'utilisateur
(le motif standard "profiles" de Supabase) — pas d'identifiant
séparé à synchroniser entre deux systèmes.

### Les 5 rôles

`chauffeur`, `manager`, `manager_chauffeur`, `comptable`, `direction` —
stockés dans `public.users.role`. Un nouvel utilisateur invité reçoit
son rôle et son service via `app_metadata` (posé par
`lib/auth/invitations.ts`, jamais modifiable par l'utilisateur
lui-même contrairement à `user_metadata`) ; sa première visite après
avoir cliqué le lien d'invitation finalise silencieusement sa fiche
`users` (`lib/auth/provisioning.ts`). Le premier utilisateur d'une
entreprise (inscription spontanée, pas une invitation) passe par
`/onboarding` pour créer son organisation et devient `direction`.

### Identification rapide par QR code

Trois types de badges QR (vehicle / tank / driver), générés à partir
des UUID déjà existants — aucune table ni secret supplémentaire :
scanner un QR d'un autre client ne renvoie simplement rien, RLS s'en
charge. Voir `lib/qr/scan-targets.ts`, `components/qr/QrCodeBadge.tsx`
(génération, à imprimer) et `components/fuel/QrScanner.tsx` (scan en
live, caméra). Un chauffeur colle le badge véhicule sur le tableau de
bord, un badge par pompe/cuve, et peut scanner son propre badge sur une
borne partagée pour s'identifier avant de saisir un ravitaillement.

---

## Modèle de données

Voir `supabase/migrations/*.sql` pour le détail exact. Les 13 premières
posent le socle (schéma 1-13, détaillées ci-dessous) ; le schéma va
aujourd'hui jusqu'à la migration **55**, appliquées dans l'ordre par
`supabase db push` — toujours des ajouts, jamais une modification
d'une migration déjà passée en prod. (45-49 — connexion par badge en
self-service, tournées en cours, rendez-vous, affectation véhicule —
ne sont pas encore détaillées ci-dessous ; voir directement le
contenu de chaque fichier.)

**Socle (1-13)** :

1. `20260101000001_extensions_and_enums.sql` — enums partagés
2. `20260101000002_core_tables.sql` — organizations, services, users, vehicles, tanks
3. `20260101000003_fuel_tables.sql` — fuel_entries, fuel_price_history
4. `20260101000004_alerts.sql`
5. `20260101000005_planning_rh.sql` — planning_entries, vehicle_interventions, fines, leave_requests
6. `20260101000006_ticpe.sql`
7. `20260101000007_marketplace_stub.sql` — Module 10 (Phase 3), tables présentes mais RLS ferme tout, aucune UI
8. `20260101000008_auth_helpers.sql` — fonctions de résolution `auth.uid()` → org/rôle
9. `20260101000009_rls_policies.sql` — toutes les policies
10. `20260101000010_business_functions.sql` — trigger PMP + détection d'écart de totaliseur + génération d'alertes
11. `20260101000011_storage.sql` — bucket `fuel-tickets`
12. `20260101000012_ticpe_storage.sql` — bucket `ticpe-exports`
13. `20260101000013_alerts_notified.sql` — traçabilité de l'envoi email

**Depuis la 14, par thème** (voir le fichier de chaque migration pour
le détail — chacune documente son "pourquoi" en commentaire SQL) :

- **Catalogue de modules** (14-16, 22-23, 28) — `modules`,
  `module_plan_prices`, `organization_modules` : le switchboard qui
  pilote quelles fonctionnalités sont activées par organisation (voir
  `lib/organization/modules.ts`), les prix par plan, et les
  corrections de vagues/tarifs successives.
- **RH & Intranet** (17) — congés, annonces.
- **Demandes d'entretien / signalement** (19, 24-26, 41) — urgence,
  alerte email, puis (Lot 4 de la mission terrain) catégorie fixe,
  kilométrage, photos, RDV garage à prévoir.
- **Photos cuve/tournée** (18, 20, 33-34) — photos de cuve, livraisons
  de carburant + facture, photo de totaliseur avec OCR.
- **Planning & tournées** (27-32, 35-36, 38-40) — numéro de tournée,
  km et photos de départ/retour, alertes d'affectation, suivi
  kilométrique (tours + interventions + km initial), réglage
  "photo de compteur obligatoire", état du véhicule obligatoire au
  départ/retour avec signalement automatique en cas de problème,
  alerte `odometer_anomaly` sur écart de trajet > 1500 km.
- **Lavage** (37) — module `washes` (désactivé par défaut), table
  `vehicle_washes`.
- **Consommation carburant** (42-43) — alerte `consumption_anomaly`
  quand un véhicule dépasse sa propre moyenne 90 jours de plus de X %
  (seuil configurable par organisation), calculée depuis les litres de
  gasoil et les relevés kilométriques existants (il n'y a pas de champ
  kilométrage sur `fuel_entries` elle-même).
- **Connexion des chauffeurs sans email** (44) — `users.auth_method`
  ('email' | 'pin') et `users.pin_set_at` : un compte `pin` est créé
  par la direction (nom/rôle/service seulement, email interne
  fabriqué, jamais montré), le chauffeur choisit son propre code PIN
  en scannant son badge QR à la première connexion (`/driver-pin/[id]`,
  public par nécessité — voir `middleware.ts`), via
  `signInWithPassword` standard — aucun pont d'authentification
  parallèle à Supabase Auth.
- **Fiche véhicule par IA** (50) — `vehicles.brand/model/model_year/
  gearbox/fuel_type/ptac_kg/reference_consumption_l_100km/
  adblue_capacity_liters/spec_sources`, table `ai_spec_requests`
  (rate-limit) — voir `lib/vehicles/ai-specs.ts`.
- **Lecture OCR du rapport de tournée** (51) — colonnes
  `report_*`/`report_ocr_raw` sur `planning_entries` — voir
  `lib/ocr/tour-report.ts`.
- **Assistant & relais humain** (52-55) — catalogue du module
  `assistant` (désactivé par défaut), `assistant_notes`,
  `assistant_conversations`, `assistant_messages`, `support_requests`,
  type `alert_type` étendu avec `support_request` — voir `lib/assistant/`.

Logique métier critique (implémentée deux fois volontairement : en
trigger Postgres comme source de vérité, et en TypeScript pur pour
prévisualisation UI + tests unitaires) :

- **PMP** (Prix Moyen Pondéré) — `lib/business/pmp.ts`
- **Écart de totaliseur** — continuité de l'index de cuve entre
  ravitaillements, tous chauffeurs confondus sur une même cuve (jamais
  un contrôle kilométrique véhicule) — `lib/business/totalizer-gap.ts`
- **TICPE** — éligibilité strictement PL/SPL, jamais VL — `lib/business/ticpe.ts`
- **TVA récupérable** (VL 80% / PL+SPL 100%) — implémentée en fonction
  pure prête à l'emploi, non branchée dans une UI (hors périmètre MVP)
- **Chevauchement de congés** — `lib/business/leave-overlap.ts`
- **Cohérence kilométrique** (régression vs. dernier relevé connu,
  écart de trajet anormal) — `lib/business/odometer.ts`
- **Consommation carburant** (L/100km, détection de surconsommation) —
  `lib/business/consumption.ts`
- **Format du code PIN chauffeur** (rejette les PIN trop simples) —
  `lib/business/driver-pin.ts`

```bash
npm test        # lance la suite vitest sur toute la logique métier
```

---

## Structure du projet

```
app/
  (dashboard)/        # layout authentifié : sidebar/topbar par rôle
    dashboard/         fuel/  fuel/new/  ocr-review/  tanks/
    vehicles/           alerts/  ticpe/  admin/{organizations,billing,users}
  onboarding/          # Module 1 : création org, import véhicules/chauffeurs, cuves, plan Stripe
  scan/[type]/[id]/    # atterrissage d'un QR scanné par l'appareil photo natif
  godac-staff/         # backoffice opérateur GODAC (cross-tenant, hors RLS)
  api/                 # route handlers (webhooks, OCR, TICPE, admin, stripe, import…)
lib/
  business/            # PMP, écart totaliseur, TICPE, congés (+ tests)
  supabase/            # clients server / browser / admin (service role)
  auth/                # session, invitations, provisioning des comptes invités
  ocr/                 # lecture Claude vision (tickets, compteurs, rapport de tournée Lot C) + pipeline d'extraction
  vehicles/            # consommation, référence kilométrique, spécifications IA (Lot A)
  assistant/           # Lot B : sources, routage du relais, rate-limit, appels IA (+ tests)
  import/              # extraction de tableau CSV/Excel (import véhicules/chauffeurs)
  email/               # Resend + templates
  stripe/              # client + plans
  qr/                  # génération/parsing des payloads QR
  utils/               # validation import (CSV/Excel), Excel (export TICPE)
components/            # UI par domaine (fuel, vehicles, admin, qr, layout, ui, assistant)
content/help/          # guide d'utilisation (Markdown) servant de source à l'assistant (Lot B)
supabase/migrations/   # schéma versionné (voir ci-dessus)
```

---

## Variables d'environnement

Voir `.env.example` pour la liste complète et commentée. Résumé par
intégration :

- **Supabase** (base de données + auth + storage) : `NEXT_PUBLIC_SUPABASE_URL`,
  `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` (jamais
  exposée au client).
- **Stripe** : `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`,
  `NEXT_PUBLIC_STRIPE_PRICE_STARTER` / `_PRO`.
- **Resend** : `RESEND_API_KEY`, `RESEND_FROM_EMAIL`.
- **Anthropic** : `ANTHROPIC_API_KEY` (optionnel) — alimente toutes les
  fonctionnalités d'IA/OCR de l'app, chacune dégradant proprement en
  son absence : le fallback IA de l'import véhicules/chauffeurs
  (`app/api/import/parse-file/route.ts`, format de colonnes non
  reconnu), la fiche véhicule complétée par IA (Lot A,
  `lib/vehicles/ai-specs.ts` — le bouton "Compléter par IA" disparaît
  sans la clé), la lecture OCR du rapport de tournée (Lot C,
  `lib/ocr/tour-report.ts`), la lecture OCR des tickets carburant
  (Module 3, `lib/ocr/fuel-receipt.ts`) et des compteurs km/totalisateur
  (`lib/ocr/counter.ts` — ces trois dernières dégradent en simple pièce
  jointe / saisie manuelle sans la clé) et l'assistant d'aide + relais
  humain (Lot B, `lib/assistant/` — le bouton flottant n'apparaît pas
  du tout sans la clé, voir `app/(dashboard)/layout.tsx`).
- **GODAC_STAFF_EMAILS** : allowlist du backoffice opérateur.
- **SUPABASE_DB_WEBHOOK_SECRET** : secret partagé pour le webhook DB → email d'alerte.
- **CRON_SECRET** : requise pour le digest hebdomadaire de planning
  (`app/api/cron/weekly-planning-digest/route.ts`, déclenché par
  `vercel.json` tous les samedis). Vercel ajoute automatiquement
  l'en-tête `Authorization: Bearer <CRON_SECRET>` sur ses propres appels
  cron dès que cette variable est définie — la route répond 500 tant
  qu'elle ne l'est pas, plutôt que de tourner sans protection.

Ne jamais committer `.env.local`. `.gitignore` l'exclut déjà.

---

## Mise en route locale

1. `npm install`
2. Créer un projet Supabase, puis :
   ```bash
   supabase link --project-ref <ref>
   supabase db push          # applique toutes les migrations
   supabase db seed          # données de démo (Sud Express 66 fictif)
   ```
3. Dans le dashboard Supabase → **Authentication → URL Configuration**,
   régler le Site URL et ajouter `<NEXT_PUBLIC_APP_URL>/auth/callback`
   et `<NEXT_PUBLIC_APP_URL>/auth/confirm` aux Redirect URLs (nécessaire
   pour que les liens magiques et les invitations reviennent au bon
   endroit).
4. Dans **Authentication → Email Templates**, chaque template envoyé par
   email (Confirm signup / **Magic Link** / **Invite user** / **Reset
   Password** / **Change Email Address**) doit pointer vers
   `app/auth/confirm/route.ts` avec un `token_hash` plutôt que vers
   `{{ .ConfirmationURL }}` — sinon la vérification passe par le flux
   implicite de Supabase (jeton dans le fragment `#` de l'URL, invisible
   côté serveur) et la session n'est jamais créée. Remplacer le `href` du
   bouton/lien par :
   ```
   {{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=<TYPE>&next={{ .RedirectTo }}
   ```
   avec `<TYPE>` = `email` (Magic Link / Confirm signup), `invite`
   (Invite user), `recovery` (Reset Password) ou `email_change` (Change
   Email Address). Le template Magic Link local
   (`supabase/templates/magic_link.html`) suit déjà ce format — le
   recopier tel quel dans le dashboard pour cette même template.
5. Copier `.env.example` → `.env.local` et remplir les clés.
6. `npm run dev`

```bash
npm run typecheck   # tsc --noEmit
npm run test        # vitest
npm run build       # build de production (validé dans ce repo)
```

---

## Mise en production (Vercel)

Variables à configurer dans Vercel (Project Settings → Environment
Variables), au minimum :

- `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
  `SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_APP_URL` (obligatoires).
- `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`,
  `NEXT_PUBLIC_STRIPE_PRICE_STARTER`/`_PRO` si la facturation est
  activée — sinon les routes `/api/stripe/*` répondent proprement avec
  un message clair plutôt qu'une erreur serveur.
- `RESEND_API_KEY`, `RESEND_FROM_EMAIL` pour les emails d'alerte —
  sinon les alertes restent visibles dans le centre d'alertes in-app
  mais ne sont jamais envoyées par email.
- `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`
  pour les notifications push (second canal, en plus de l'email,
  activé par utilisateur depuis `/account`) — sinon le bouton "Activer
  les notifications" échoue proprement, l'email continue seul.
- `ANTHROPIC_API_KEY` (optionnel) — sinon OCR et import basculent
  proprement en saisie manuelle.
- `GODAC_STAFF_EMAILS`, `SUPABASE_DB_WEBHOOK_SECRET`.
- `CRON_SECRET` (obligatoire pour le digest hebdomadaire de planning —
  voir `## Variables d'environnement` ci-dessous).

Voir `.env.example` pour la liste exhaustive et `## Variables
d'environnement` ci-dessous pour le détail par intégration — toutes
celles marquées optionnelles dégradent proprement (message clair,
jamais d'erreur 500) quand elles sont absentes.

Réglages manuels hors variables d'environnement, à faire une fois sur
le projet Supabase de production (détaillés dans `## Intégrations non
branchées` ci-dessous) : Authentication → URL Configuration,
Authentication → Email Templates, Database → Webhooks.

Avant l'ouverture au public, compléter les trois pages légales
(`/mentions-legales`, `/cgu`, `/confidentialite`) — chaque placeholder
`[À COMPLÉTER : ...]` doit être rempli (raison sociale, SIRET,
hébergeur, contact) et idéalement relu par un professionnel du droit.

---

## Intégrations non branchées (à faire avant la prod)

Documenté explicitement, comme demandé — rien n'est masqué derrière un
placeholder silencieux :

- **Configuration Supabase "URL Configuration"** (Site URL + Redirect
  URLs) : réglage du dashboard Supabase, pas une migration SQL. Sans
  lui, les liens magiques et les invitations redirigent vers une URL
  par défaut incorrecte.
- **Webhook Supabase Database Webhooks → `/api/webhooks/supabase-alerts`** :
  également un réglage du dashboard (Database → Webhooks, sur
  `insert on public.alerts`), impossible à créer depuis une migration
  SQL classique sans droits superuser sur `pg_net`. Sans lui, les
  alertes sont bien créées en base et visibles dans le centre
  d'alertes in-app, mais aucun email n'est envoyé.
- **Pennylane** : **non intégré**. Aucune clé, aucun appel API, aucun
  stub actif dans le code au-delà des variables d'environnement
  réservées dans `.env.example`. GODAC ne doit pas devenir lui-même
  Plateforme Agréée — l'interfaçage avec Pennylane pour la conformité
  facturation électronique (obligatoire au 1er septembre 2026) reste à
  faire entièrement.
- **Railway** : non utilisé pour l'instant. Le pipeline OCR
  (`lib/ocr/pipeline.ts`) tourne dans une Route Handler Next.js
  (`app/api/ocr/process`), ce qui est suffisant en volume MVP. Si les
  temps d'extraction dépassent les limites d'exécution Vercel,
  déplacer l'appel à `processFuelEntryOcr()` vers un worker Railway
  sans changer sa signature.
- **Niveau réel de carburant en cuve** : l'app affiche l'index
  totaliseur cumulé (fiable, utilisé pour la détection d'écarts), pas
  le litrage physiquement restant — cela suppose de tracer les
  livraisons de carburant dans la cuve, non modélisées en MVP (voir
  `app/(dashboard)/tanks/page.tsx`, note explicite affichée aux
  utilisateurs).
- **Stripe tarification modulaire par chauffeur** : Phase 2, prix
  fixe par organisation pour l'instant (`lib/stripe/plans.ts`).
- **Purge 90 jours des conversations de l'assistant (Lot B)** : la
  fonction SQL `public.cleanup_old_assistant_conversations()` existe
  (migration `20260101000053_assistant_tables.sql`) mais n'est
  appelée par aucun cron — à planifier une fois `pg_cron` activé sur le
  projet Supabase (`select cron.schedule('assistant-cleanup', '0 3 * * *',
  'select public.cleanup_old_assistant_conversations()')`) ou via un
  job externe planifié.

---

## État d'avancement des modules

### Fait
- Module 1 — Authentification & Onboarding (Supabase Auth sans mot de
  passe, création d'organisation, import véhicules/chauffeurs depuis
  CSV/Excel avec repli IA pour les fichiers au format inhabituel,
  config cuves, choix plan Stripe, invitations par email)
- Module 2 — Gestion Carburant (saisie manuelle, PMP auto, détection
  d'écart de totaliseur, historique, vue cuves, livraisons de
  carburant + facture)
- Module 3 — OCR (capture photo mobile-first, pipeline Claude vision,
  validation humaine obligatoire, revue manager, mode dégradé, OCR
  compteur totaliseur/odomètre, QR badges véhicule/pompe/chauffeur)
- Module 4 — Gestion de Flotte (fiche véhicule, consommation L/100km
  sur 30/90 jours + classement dashboard, historique kilométrique
  consolidé, lavage)
- Module 5 — Planning / Tournées (grille hebdomadaire glisser-déposer,
  notifications d'affectation, départ/retour de tournée par le
  chauffeur avec km et état du véhicule obligatoires, numéro de
  tournée optionnel généré automatiquement, signalement automatique en
  cas de problème, détection d'écart kilométrique anormal)
- Demandes d'entretien / signalement (catégorie fixe, kilométrage,
  jusqu'à 4 photos, RDV garage à prévoir, bandeau d'urgence
  accident si un numéro est configuré)
- Lavage (module `washes`, désactivé par défaut)
- RH légère — congés (détection de chevauchement, UI de demande/
  validation) et intranet (annonces)
- Module 7 — Export TICPE (filtré PL/SPL strictement, Excel, rôle
  comptable)
- Module 8 — Alertes & Notifications (centre in-app + email Resend +
  notification push web par appareil, scopées par service, écarts de
  totaliseur, anomalies de prix/kilométrage/consommation,
  échecs OCR, demandes d'entretien)
- Module 9 — Administration & Multi-tenant (paramètres org dont seuils
  d'alerte et numéro d'urgence, gestion des rôles, facturation Stripe
  — dégrade proprement si `STRIPE_SECRET_KEY` n'est pas défini, au
  lieu de renvoyer une 500 — backoffice opérateur GODAC)
- Interface mobile (tiroir de navigation + barre d'actions sous `lg`,
  aucun défilement horizontal à 360px), fiche véhicule par scan QR
  (`/v/[id]`) avec actions contextuelles selon rôle/modules activés
- Pages publiques mentions légales / CGU / confidentialité (contenu à
  compléter — voir placeholders `[À COMPLÉTER : ...]`), manifeste
  web + icônes pour l'installation sur écran d'accueil, en-têtes de
  sécurité (`next.config.mjs`)
- Connexion des chauffeurs sans email : badge QR + code PIN créé par
  le chauffeur lui-même à la première connexion (Admin > Utilisateurs
  > "Chauffeur sans email")
- Fiche véhicule complétée par IA (Lot A) : marque/modèle/année/boîte,
  bouton "Compléter par IA" (type, carburant, réservoir, AdBlue, PTAC,
  consommation de référence) avec niveau de confiance par champ et
  gestion des modèles ambigus, traçabilité par champ
  (`vehicles.spec_sources`), garde-fou TICPE sur un type non confirmé,
  et complétion par lots depuis l'import CSV/Excel
- Lecture OCR du rapport de tournée (Lot C) : photo du rapport au
  départ/retour (écran de terminal portable ou compte-rendu imprimé)
  qui pré-remplit numéro de tournée, BL, arrêts, colis — en plus de
  l'OCR déjà existant pour les compteurs kilométriques/totaliseur
- Module `assistant` (Lot B, désactivé par défaut) : chatbot d'aide
  contextuelle (guide d'utilisation + consignes internes gérées par la
  direction), ne répond qu'à partir de ces sources, jamais d'accès aux
  données métier, relais automatique vers un gestionnaire ou le
  support GODAC (`/support`) sur trois déclencheurs (besoin détecté par
  l'IA, bouton "Parler à quelqu'un", deux retours "pas utile" de suite)

### À faire
- Amendes (`fines`, table + RLS prêtes, aucune UI)
- Tarification Stripe modulaire par chauffeur
- Intégration Pennylane (facturation électronique)
- Module 10 — GODAC Hub / marketplace de fret (tables
  `freight_offers`/`freight_bids` posées et verrouillées par RLS,
  aucune UI ni logique)
- Module 11 — BI / Reporting avancé
- Mode hors-ligne, notifications push, tachygraphe, application mobile
  native, RGPD avancé
