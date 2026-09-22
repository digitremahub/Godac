# GODAC V2

Gestion et Optimisation Des Assets et Carburant — plateforme SaaS B2B
modulaire pour les PME françaises de transport routier de marchandises
(TRM), flottes mixtes VL/PL/SPL.

Ce dossier (`godac/`) contient l'application V2, construite en
full-stack propre (Next.js + Supabase + Stripe + Resend + Mindee), à
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
| OCR tickets carburant | Mindee |

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

Voir `supabase/migrations/*.sql`, dans l'ordre :

1. `20260101000001_extensions_and_enums.sql` — enums partagés
2. `20260101000002_core_tables.sql` — organizations, services, users, vehicles, tanks
3. `20260101000003_fuel_tables.sql` — fuel_entries, fuel_price_history
4. `20260101000004_alerts.sql`
5. `20260101000005_planning_rh.sql` — planning_entries, vehicle_interventions, fines, leave_requests (Phase 2)
6. `20260101000006_ticpe.sql`
7. `20260101000007_marketplace_stub.sql` — Module 10 (Phase 3), tables présentes mais RLS ferme tout, aucune UI
8. `20260101000008_auth_helpers.sql` — fonctions de résolution `auth.uid()` → org/rôle
9. `20260101000009_rls_policies.sql` — toutes les policies
10. `20260101000010_business_functions.sql` — trigger PMP + détection d'écart de totaliseur + génération d'alertes
11. `20260101000011_storage.sql` — bucket `fuel-tickets`
12. `20260101000012_ticpe_storage.sql` — bucket `ticpe-exports`
13. `20260101000013_alerts_notified.sql` — traçabilité de l'envoi email

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
- **Chevauchement de congés** — `lib/business/leave-overlap.ts` (Phase 2)

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
  ocr/                 # client Mindee + pipeline d'extraction
  import/              # extraction de tableau CSV/Excel (import véhicules/chauffeurs)
  email/               # Resend + templates
  stripe/              # client + plans
  qr/                  # génération/parsing des payloads QR
  utils/               # validation import (CSV/Excel), Excel (export TICPE)
components/            # UI par domaine (fuel, vehicles, admin, qr, layout, ui)
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
- **Mindee** : `MINDEE_API_KEY`, `MINDEE_FUEL_MODEL_ID` (optionnel),
  `MINDEE_TOTALIZER_MODEL_ID` (optionnel), `MINDEE_ODOMETER_MODEL_ID`
  (optionnel).
- **Anthropic** : `ANTHROPIC_API_KEY` (optionnel) — fallback IA de
  l'import véhicules/chauffeurs (app/api/import/parse-file/route.ts) :
  quand le fichier importé ne suit aucun format de colonnes reconnu,
  Claude lit son contenu brut pour en extraire les lignes lui-même.
- **GODAC_STAFF_EMAILS** : allowlist du backoffice opérateur.
- **SUPABASE_DB_WEBHOOK_SECRET** : secret partagé pour le webhook DB → email d'alerte.

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
- **Mindee** : fonctionne avec le modèle générique
  "financial_document" tant que `MINDEE_FUEL_MODEL_ID` n'est pas
  défini — ce modèle ne restitue pas litres/prix unitaire (seulement
  montant total, date, fournisseur). Un modèle custom entraîné sur des
  tickets carburant français (mentionné dans le brief comme option) est
  nécessaire pour une extraction complète ; le code
  (`lib/ocr/mindee.ts`) a déjà le branchement prêt, il attend juste
  l'id du modèle entraîné.
- **Pennylane** : **non intégré**. Aucune clé, aucun appel API, aucun
  stub actif dans le code au-delà des variables d'environnement
  réservées dans `.env.example`. GODAC ne doit pas devenir lui-même
  Plateforme Agréée — l'interfaçage avec Pennylane pour la conformité
  facturation électronique (obligatoire au 1er septembre 2026) reste à
  faire entièrement.
- **Railway** : non utilisé pour l'instant. Le pipeline OCR
  (`lib/ocr/pipeline.ts`) tourne dans une Route Handler Next.js
  (`app/api/ocr/process`), ce qui est suffisant en volume MVP. Si les
  temps d'extraction Mindee dépassent les limites d'exécution Vercel,
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

---

## État d'avancement des modules

### MVP — fait
- Module 1 — Authentification & Onboarding (Supabase Auth sans mot de passe, création d'organisation, import véhicules/chauffeurs depuis CSV/Excel (aussi disponible sur les pages Flotte et Utilisateurs), config cuves, choix plan Stripe, invitations par email)
- Module 2 — Gestion Carburant (saisie manuelle, PMP auto, détection d'écart, historique, vue cuves)
- Module 3 — OCR (capture photo mobile-first, pipeline Mindee, validation humaine obligatoire, revue manager, mode dégradé, QR badges véhicule/pompe/chauffeur)
- Module 4 — Gestion de Flotte (fiche véhicule, interventions/entretien avec workflow de statut)
- Module 7 — Export TICPE (filtré PL/SPL strictement, Excel, rôle comptable)
- Module 8 — Alertes & Notifications (centre in-app + email Resend, écarts/anomalies/échecs OCR)
- Module 9 — Administration & Multi-tenant (paramètres org, gestion des rôles, facturation Stripe, backoffice opérateur GODAC)

### Phase 2 — à faire
- Module 5 — Planning / Tournées (tables déjà en place : `planning_entries`, RLS déjà écrite ; UI à construire)
- Module 6 — RH légère : congés (détection de chevauchement déjà implémentée en logique pure, `lib/business/leave-overlap.ts`, UI à construire) + amendes (`fines`, table + RLS prêtes)
- Tarification Stripe modulaire par chauffeur
- Suivi des livraisons de carburant (pour un niveau de cuve réel, pas seulement l'index cumulé)
- Intégration Pennylane (facturation électronique)

### Phase 3 — à faire
- Module 10 — GODAC Hub / marketplace de fret (tables `freight_offers`/`freight_bids` posées et verrouillées par RLS, aucune UI ni logique)
- Module 11 — BI / Reporting avancé
- Tachygraphe, application mobile native, RGPD avancé
