# GO, application à part entière : autonome, branchable sur GODAC ou ailleurs

Document de **conception uniquement** : aucun code applicatif, aucune migration appliquée. Rédigé le 29 octobre 2026 à partir de `origin/main` (commit `c624992`), du dossier `mobile/` (projet Capacitor « GODAC Livreur ») et du dépôt `/home/user/go-navigation` (prototype initial du module, un seul commit « Add files via upload »). Il prolonge `docs/profils-activite.md` (GO = socle commun de tous les profils) et respecte `docs/garde-fous-techniques.md` (limiteur de débit, idempotence, offre « fail-closed », conservation des données).

Les idées Notion « GO Free & GO Premium » (marquée **à ne pas faire maintenant**) et « GODAC Core » viennent de la consigne du fondateur ; les pages n'ont pas été relues directement dans Notion pour ce document. Tout chiffre de coût ou de tarif ci-dessous est un **ordre de grandeur à vérifier** auprès des fournisseurs avant décision.

## Résumé exécutif

1. **Besoin** : « GO doit être une application à part entière, que l'on branche sur GODAC ou autre », utilisable aussi par un particulier comme Waze (destination libre, favoris, guidage).
2. **Constat** : GO est aujourd'hui la page web `/livreur` (`app/livreur/`, `components/colis/GoNavigation.tsx`, 1 860 lignes) emballée dans une coquille Capacitor `fr.godac.livreur` qui **charge le site en ligne** (`mobile/capacitor.config.ts`, `server.url`). Tout passe par un compte rattaché à une organisation (`users.organization_id not null`), par le module `route_optimizer` et par les tables `delivery_runs` / `delivery_stops`.
3. **Ce qui est déjà réutilisable** : le moteur de guidage est de la logique pure (`lib/colis/navigation.ts`, `conduite.ts`, `manoeuvres.ts`, `eta.ts`, `limitation-vitesse.ts`, `itineraire.ts`), l'optimisation, l'import de listes et liens, le scan, la file hors ligne idempotente. Ce qui est lié à GODAC : compte, tournées, planning, pointage, véhicule, clés de modules, quotas (`usage_events.organization_id not null`).
4. **Hors réseau aujourd'hui** : seules les *actions* (livré, échec, photos) sont mises en file (IndexedDB) et rejouées sans doublon. Le chargement de l'application, la carte, le calcul d'itinéraire et la recherche d'adresse exigent le réseau ; le service worker ne met en cache que `/_next/static/`.
5. **Risques de la coquille** : règle Apple 4.2 (site web empaqueté), absence de localisation en arrière-plan (écran verrouillé = plus de guidage ni de trace), **texte de permission de localisation inexact** (il dit « seulement quand vous le demandez », alors que le guidage et la trace utilisent la position en continu), pas de suppression de compte dans l'application, pas de politique de confidentialité pour particuliers, serveur de routage de démonstration public par défaut (`ROUTING_URL`).
6. **Architecture cible** : « GO autonome + connecteurs ». Une **identité propre** (marque, sous-domaine puis domaine, application des stores séparée), un **compte personnel GO sans organisation** qui peut se **rattacher** à une ou plusieurs *sources* (organisation GODAC par code d'invitation, autre plateforme par jeton), un **modèle de mission neutre** et une interface de connecteurs (GODAC natif, import, partage entrant, API + webhooks signés, export).
7. **Mode « Aller à… »** : on extrait du composant actuel un moteur de navigation sans notion de tournée et on lui donne un routage et une recherche de lieux **indépendants de l'organisation**. Favoris et récents sont **locaux d'abord** (minimisation RGPD), synchronisation optionnelle.
8. **Technologie (recommandation)** : garder Capacitor, mais passer à un **client GO embarqué dans l'application** (plus de `server.url` en production) avec des plugins natifs ciblés (localisation de fond, voix, partage entrant). Réexaminer une application native (CarPlay, Android Auto, cartes et routage hors réseau) seulement au jalon 3, sur critères chiffrés.
9. **Routage et trafic** : héberger notre propre serveur de routage (OSRM, ou Valhalla si profil poids lourd) dès la phase 1 ; trafic payant en phase 4, après preuve d'usage.
10. **Modèle économique** : GO pro inclus dans GODAC (palier d'utilisateurs actuel inchangé) ; GO particulier gratuit avec plafonds ; Premium (trafic, hors réseau, synchronisation, connecteurs avancés) et API facturée au volume. **Rien n'est facturé avant le jalon 2** : la phase 1 prépare la capacité sans paywall, ce qui respecte « GO Free & GO Premium : à ne pas faire maintenant ».
11. **RGPD** : mode « Perso » et mode « Pro » strictement séparés ; en Perso, la position n'est jamais envoyée à un tiers, seulement au routage (coordonnées sans identité), conservée quelques minutes au plus ; en Pro, l'organisation reste responsable de traitement et GODAC sous-traitant (DPA existant).
12. **À ne pas faire** : radars ou signalements de contrôles (interdits en France), signalements communautaires avant d'avoir des utilisateurs, CarPlay avant la phase 4, réécriture native complète, renommage de `fr.godac.livreur`, API ouverte à tous avant deux intégrateurs pilotes.
13. **Plan** : phase 0 de corrections (2 j) puis 4 phases, environ **145 jours d'effort d'agent** (fourchette 125 à 165) : phase 1 particulier « Aller à… » + favoris + marque + compte 28 j ; phase 2 connecteurs + application des stores séparée 28 j ; phase 3 API publique + webhooks 20 j ; phase 4 trafic, hors réseau, CarPlay 64 à 79 j selon le périmètre. Délais de validation Apple et Google en plus.
14. **Prérequis hors agent** : vérification de la marque (INPI, stores, domaines), relecture juridique (CGU de conduite, confidentialité particuliers, radars), ouverture des comptes développeur au nom de la société.
15. **8 questions** au fondateur en section 5.4, avec une recommandation chacune (marque, une ou deux applications, calendrier de monétisation, base partagée, technologie, trafic, signalements, ouverture de l'API).

---

## 1. État des lieux factuel

### 1.1 Ce que GO est aujourd'hui

| Élément | Fait constaté | Fichier |
|---|---|---|
| Coquille | Application « GODAC Livreur », `appId: fr.godac.livreur`, qui ouvre `https://godac.app/livreur` (`server.url`), `allowNavigation` limité au domaine et à `*.supabase.co`, page embarquée `offline.html` si le site est injoignable | `mobile/capacitor.config.ts`, `mobile/www/` |
| Plugins natifs | `@capacitor-mlkit/barcode-scanning` (scanner), `@capacitor-community/keep-awake` (écran allumé), `splash-screen`, `status-bar`. **Aucun plugin de géolocalisation** : la position vient de `navigator.geolocation` dans la WebView | `mobile/package.json` |
| Pont natif | Détecte `window.Capacitor`, expose scanner et écran allumé ; hors application, repli sur les solutions web | `lib/colis/natif.ts` |
| Écrans | `/livreur` (liste, démarrage, clôture) et `/livreur/navigation` (carte plein écran). Les deux gardés par `garderPage("moi.tournee_colis")` ou `isModuleEnabled("route_optimizer")`, avec fin d'essai (`lireEtatOffre`) | `app/livreur/page.tsx`, `app/livreur/navigation/page.tsx` |
| Moteur de guidage | `GoNavigation` (carte MapLibre + OpenFreeMap recolorée, suivi `watchPosition`, recalcul si écart au tracé > 30 m, manœuvres OSRM annoncées par la synthèse vocale du navigateur, limitation de vitesse indicative via Overpass, ETA) | `components/colis/GoNavigation.tsx`, `lib/colis/{navigation,conduite,manoeuvres,eta,limitation-vitesse,epure-conduite}.ts` |
| Itinéraire | `POST /api/colis/itineraire` → OSRM (`ROUTING_URL`, **par défaut le serveur public `router.project-osrm.org`**, `.env.example` l. 91 et 101), délai 5 s, repli en ligne droite (`approx`) | `app/api/colis/itineraire/route.ts` |
| Optimisation | Plus proche voisin + 2-opt + Or-opt sur matrice OSRM ; pas de fenêtre horaire dure | `lib/colis/optimisation.ts`, `matrice.ts` |
| Waze / Google Maps | Liens `https://waze.com/ul?...` et `https://www.google.com/maps/dir/?api=1...` ; choix mémorisé (GO par défaut) | `components/colis/commun.ts`, `lib/colis/navigation-preferee.ts` |
| Import | Lien Google Maps (itinéraire, liste enregistrée), texte, CSV / TSV / Excel, photo d'étiquette (lecture IA, quota `ocr_label`) | `lib/colis/import.ts`, `app/api/colis/import/route.ts`, `app/api/colis/etiquette/route.ts` |

### 1.2 Ce qui est déjà autonome (réutilisable sans GODAC)

| Brique | Pourquoi elle est autonome |
|---|---|
| Calcul de guidage : écart au tracé, recalcul (`ECART_MAX_M = 30`, `ECART_FRANC_M = 80`, `DELAI_RECALCUL_MS = 4 000`), rayon d'arrivée (`RAYON_ARRIVEE_M = 60`), reste sur tracé, projection | `lib/colis/navigation.ts` : fonctions pures sur `Point` et `[lng, lat][]`, aucune notion d'organisation |
| Caméra de conduite (cap, zoom selon la vitesse, lissage) | `lib/colis/conduite.ts`, pur |
| Manœuvres et annonces vocales (paliers de distance, rond-points) | `lib/colis/manoeuvres.ts`, pur, alimenté par les étapes OSRM |
| Estimation d'arrivée, limitation de vitesse indicative | `lib/colis/eta.ts`, `lib/colis/limitation-vitesse.ts`, purs (l'appel Overpass est dans `app/api/colis/limitation`) |
| Types d'itinéraire, découpage en tronçons de 90 points, haversine | `lib/colis/itineraire.ts` |
| Optimisation de l'ordre des points | `lib/colis/optimisation.ts` + `matrice.ts` (seul le réseau OSRM est externe) |
| Lecture de liens Google Maps, listes, CSV / Excel | `lib/colis/import.ts` (fonctions pures ; la résolution des liens courts est côté serveur et limitée aux domaines Google) |
| Scan de codes | `lib/colis/scan.ts` et pont natif |
| File d'actions hors ligne et idempotence | `lib/offline/outbox.ts` (IndexedDB `godac-offline-v1`), `idempotence.ts` (en-tête `X-GODAC-Offline-Action`), `verrou-onglets.ts`, `rejeu.ts` |
| Sécurité d'accès aux invitations | `lib/go-navigation/jeton.ts` (jeton de 32 octets, seul le SHA-256 salé est stocké) : modèle à reprendre pour les codes de rattachement et les jetons d'API |
| Limiteur de débit des routes publiques | `lib/http/limite-debit.ts`, `limiteur-serveur.ts` (`limiterParIp`) |

**Réserve** : ces fonctions sont dans `lib/colis/` et le composant d'écran les mélange avec la logique de tournée (appel du client, clôture, ramasse, point relais, horaires, mode simple). Les props de `GoNavigation` (`run`, `stops`, `lists`, `onCloture`, `onTerminer`, `onTelephone`, `onHoraires`…) montrent qu'il faut **séparer le moteur de la feuille de tournée** avant de pouvoir l'utiliser pour une destination libre.

### 1.3 Ce qui dépend de GODAC

| Dépendance | Constat | Effet pour un GO autonome |
|---|---|---|
| **Compte et organisation** | `users.organization_id uuid not null` (migration `20260101000002_core_tables.sql`) ; `getCurrentAppUser()` rend `null` pour une organisation suspendue (`lib/auth/session.ts`) ; `garderApi` exige rôle + modules + offre (`lib/acces/garde-api.ts`) | Un particulier ne peut pas exister aujourd'hui : il faut un compte **sans ligne `users`** (voir 2.2) |
| **Modules** | Toutes les routes `app/api/colis/**` exigent `route_optimizer` (libellé « Tournée colis », `lib/acces/catalogue.ts` l. 122) ; `mobile_app`, `alerts`, `auth_onboarding` complètent l'offre d'essai (`MODULES_GO_NAVIGATION`) | Le routage, la recherche et l'optimisation d'un particulier ne peuvent pas passer par ces gardes |
| **Tournées** | `delivery_runs` (`unique (driver_id, run_date)`) et `delivery_stops`, `organization_id not null`, RLS par organisation et conducteur | Une « destination libre » n'est pas une tournée : modèle neutre à créer, sans toucher à ces tables |
| **Planning** | Véhicule et service du jour lus dans le planning (`lib/colis/serveur.ts`, déjà tolérant), `refusDemarrageFiche` à l'ouverture (`app/api/colis/lancement`), affectations | Source GODAC seulement |
| **Pointage** | `SortieDepotLivreur` dans `AppLivreur` ; la position remontée (`onPosition`) sert à la présence au dépôt (`components/time-clock`) | Source GODAC seulement |
| **Véhicule** | Démarrage et fin de tournée avec kilométrage et photos (`components/tours/StartTourFlow.tsx`, `EndTourFlow.tsx`) | Étape facultative, déjà identifiée dans `docs/profils-activite.md` |
| **Offre et essai** | `organizations.offre = 'go_navigation'`, `trial_ends_at`, `PLAFONDS_ESSAI` (3 000 lectures d'étiquettes et 300 optimisations par mois), `ECRANS_GO_NAVIGATION`, inscription par lien d'invitation (`app/go-navigation/[jeton]`), création d'une **organisation d'une personne** « GO Navigation – Prénom Nom » | L'essai actuel est un compte professionnel miniature. Il reste valable tel quel pour les invités des transporteurs ; il n'est pas le compte du particulier |
| **Quotas et facturation à la dépense** | `usage_events.organization_id uuid not null` (migration `20260101000130_quotas_consommation.sql`), `PLAN_TIERS = essentiel / starter / pro / business` | Un particulier ne peut pas consommer de quota sans évolution du schéma (colonne propriétaire alternative, voir 2.5) |
| **Annuaire d'adresses** | La recherche d'adresses mêle annuaire interne de l'organisation, BAN, Photon, SIRENE, Google Places (`lib/colis/recherche-adresses-serveur.ts`) et est gardée par module | Version GO sans annuaire interne |
| **Textes juridiques** | `/confidentialite`, `/dpa`, `/cgu` décrivent salariés, destinataires, position de tournée ; CGU art. 3 : « ne pas utiliser l'application au volant » | Textes à part pour les particuliers (section 4) |

### 1.4 Ce qui fonctionne hors réseau (état réel)

| Fonction | Hors réseau ? | Constat |
|---|---|---|
| Marquer livré / échec, ajouter un arrêt, envoyer une photo de preuve | **Oui, mise en file** | `enqueueOfflineMutation` (IndexedDB), rejeu au retour du réseau, un seul onglet rejoue (`verrou-onglets.ts`), idempotence serveur (`POST /api/colis/arrets`), actions rattachées au compte qui les a faites (tablette partagée) |
| Trace GPS | **Oui, file locale** | `useTraceGps` garde les points en `localStorage` (plafonnée) et les envoie par lots à `POST /api/colis/trace` |
| Ouvrir l'application après fermeture complète | **Non** | La coquille charge `https://godac.app/livreur` ; sans réseau, elle affiche `offline.html` (« GODAC Livreur a besoin d'internet pour charger votre tournée ») |
| Pages et données de la tournée | **Non** | `public/sw.js` ne met en cache que `/_next/static/` ; « pas de mode hors ligne complet des pages » (`docs/garde-fous-techniques.md`) |
| Fond de carte | **Non** | Style `tiles.openfreemap.org` chargé en ligne, avec repli sur le style d'origine |
| Itinéraire, recalcul, manœuvres | **Non** | Calcul côté serveur (`/api/colis/itineraire`) ; sans réponse en 5 s, repli en ligne droite sans manœuvres |
| Recherche d'adresse, limitation de vitesse | **Non** | Sources distantes |
| Guidage vocal | **Oui une fois les manœuvres reçues**, avec la voix du système | `speechSynthesis` du WebView ; dépend des voix installées sur l'appareil |

Conclusion : le « hors réseau » actuel est une **tolérance aux coupures pendant une tournée déjà chargée** (capturer les actions), pas une navigation hors réseau.

### 1.5 Risques de la coquille Capacitor face aux règles des stores

Les numéros de règles ci-dessous sont cités de mémoire et **à vérifier sur les textes en vigueur** au moment de la soumission.

| Sujet | Constat dans le dépôt | Risque | Atténuation |
|---|---|---|---|
| **Apple 4.2 « fonctionnalité minimale »** | L'application charge un site distant. `mobile/STORES.md` §5 prépare l'argumentaire : scanner natif, écran allumé, appel / SMS / navigation, appareil photo | Moyen aujourd'hui (application pour professionnels, compte de démonstration à fournir). **Plus élevé pour un grand public** : le relecteur voit une page web dans un cadre | Embarquer le client dans l'application (assets locaux), ajouter des fonctions réellement natives (localisation de fond, voix, partage entrant, notifications locales) ; Capacitor décrit `server.url` comme un réglage de développement : à vérifier dans la documentation de la version 8 |
| **Localisation en arrière-plan** | iOS : seulement `NSLocationWhenInUseUsageDescription`, pas de `UIBackgroundModes`. Android : seulement `ACCESS_COARSE/FINE_LOCATION`, pas de `ACCESS_BACKGROUND_LOCATION`, pas de service au premier plan. La position vient de la WebView | Écran verrouillé ou application en second plan : le guidage vocal s'arrête, la trace s'interrompt. Inacceptable pour un usage « Waze » | Plugin de localisation de fond (service au premier plan Android avec notification permanente ; `location` dans `UIBackgroundModes` et demande « Toujours » sur iOS). Google exige un formulaire de déclaration et une vidéo pour la permission de fond ; Apple demande une justification d'usage : **les deux n'acceptent que si la fonction principale le requiert**, ce qui est vrai pour un guidage |
| **Écran allumé** | `@capacitor-community/keep-awake` (`garderEcranAllume`) | Faible | Le garder, le désactiver à l'arrêt du guidage, l'expliquer dans les notes de validation |
| **Justification des permissions** | iOS : « Votre position sert **uniquement** à recalculer l'ordre de la tournée depuis l'endroit où vous êtes, **quand vous le demandez** » (`ios/App/App/Info.plist`). Android : même commentaire dans le manifeste. **Or** `GoNavigation` suit la position en continu (`watchPosition`), `useTraceGps` envoie la trace et la dernière position toutes les 30 s (`REMONTEE_POSITION_MS`), et le pointage lit la position | **Texte inexact** : motif de refus Apple/Google et défaut de transparence RGPD. À corriger **dès maintenant**, indépendamment de ce projet | Réécrire les textes (guidage, suivi de la tournée par l'encadrement, pointage), aligner la fiche « Sécurité des données » de `STORES.md` |
| **Politique de confidentialité** | URL unique `https://godac.app/confidentialite`, rédigée pour salariés, entreprises clientes, destinataires | Insuffisante pour des particuliers (autre finalité, autre responsable de traitement) | Politique GO dédiée (section 4) |
| **Suppression de compte dans l'application** | Aucune route de suppression (`app/api/account` ne contient qu'un `PATCH` pour date de naissance et code PIN) ; la suppression des données se fait à la fin du contrat de l'organisation (`docs/garde-fous-techniques.md`) | Apple exige la suppression de compte dans l'application dès qu'on peut en créer un (règle 5.1.1) ; l'inscription d'essai par lien (`/go-navigation/[jeton]`) crée déjà des comptes | Prévu en phase 1 pour les comptes personnels ; à étendre aux comptes d'essai |
| **Connexion sociale** | Aucune connexion Google ou Apple aujourd'hui (e-mail + mot de passe, PIN, passkey) | Si on ajoute « Continuer avec Google », Apple impose une option équivalente respectueuse de la vie privée (« Se connecter avec Apple », règle 4.8) | Choisir e-mail + lien magique ou passkey, sinon prévoir Apple |
| **Manifeste de confidentialité iOS** | Aucun `PrivacyInfo.xcprivacy` dans `ios/App/App/` | À vérifier : Apple demande un manifeste pour les API à « raison requise » ; les plugins Capacitor en fournissent une partie | Ajouter celui de l'application et contrôler à l'archive TestFlight |
| **Sauvegarde Android** | `android:allowBackup="true"` | Données locales (favoris, file d'actions) copiées dans la sauvegarde Google | Passer à `false` ou exclure les fichiers sensibles pour GO |
| **Google Play** | Compte « particulier » sans SIRET possible (`STORES.md` §1) ; fiche « Sécurité des données » | Les comptes développeur personnels récents sont soumis à une période de test fermé avant production (**à vérifier** : nombre de testeurs et durée en vigueur) ; le nom du particulier apparaît comme éditeur | Ouvrir le compte au nom de la société (SIRET + D-U-N-S) avant la phase 2 |
| **Identité** | « GODAC Livreur » : nom et sous-titre « Tournées colis optimisées » | Un particulier n'y trouve pas « Aller à… » ; `appId` ne peut plus changer après publication | Nouvelle application (nouvel identifiant) plutôt que renommage (section 2.1) |
| **Compte de démonstration** | À fournir aux relecteurs (`STORES.md` §5) | Pour GO particulier : mode « essai sans compte » ou compte de démo | Prévu en phase 2 |

**État de publication** : le dépôt contient la procédure et le workflow de compilation (`.github/workflows/mobile.yml`, version, TestFlight), mais **rien ne permet de savoir si l'application est déjà publiée** sur les stores ; à confirmer avec le fondateur avant de décider du sort de `fr.godac.livreur` (question 2).

### 1.6 Ce qui manque pour un usage « particulier »

| Fonction | État | Contrainte ou remarque | Phase |
|---|---|---|---|
| **Destination libre** (« Aller à… ») | Absente. Une adresse n'existe que comme arrêt d'une tournée (`AdresseInput` dans `GoNavigation`, `POST /api/colis/arrets`) | Moteur à extraire du composant (1.2) | 1 |
| **Recherche de lieux** | Partielle : adresses (BAN, Photon, Nominatim) et établissements (SIRENE, Google Places facultatif), mais gardée par module et mêlée à l'annuaire de l'organisation | Pas de recherche de **points d'intérêt** grand public (stations, parkings) ; Google Places est payant à l'usage | 1 |
| **Favoris** | Absents (l'équivalent est l'annuaire de fiches client de l'organisation, `delivery_address_hours`) | Domicile / Travail + lieux nommés ; local d'abord | 1 |
| **Historique / récents** | Absent côté personne. La trace de tournée (`delivery_run_track_points`, 1 an) appartient à l'organisation | Durée par défaut courte et effaçable par l'utilisateur | 1 |
| **Multi-étapes** | Existe via tournée + optimisation (quota `route_optimization`) | À exposer sans tournée : liste d'étapes, ordre libre ou optimisé | 1 |
| **Trafic** | Aucun. OSRM n'a pas de trafic ; l'estimation de tournée suppose 35 km/h et 3 min d'arrêt (`lib/colis/estimation.ts`) | Fournisseur payant (3.4) ; sans trafic, GO ne peut pas se présenter comme concurrent de Waze | 4 |
| **Signalements** | Absents de GODAC. Le prototype `/home/user/go-navigation` les contient **en local au navigateur seulement**, « non partagés » | Sans masse critique d'utilisateurs, un signalement communautaire n'a pas de valeur ; contraintes légales ci-dessous | Hors plan (question 7) |
| **Radars / zones de danger** | Absents | Voir encadré | Hors plan |
| **CarPlay / Android Auto** | Absents | Exigent du code **natif** (modèles CarPlay en Swift, bibliothèque Car App en Kotlin) et une autorisation Apple / Google propre aux applications de navigation ; une WebView ne suffit pas | 4 |
| **Cartes hors réseau** | Absentes | Demandent un fond de carte téléchargeable et, pour guider, un moteur de routage embarqué (lourd) | 4 |
| **Partage entrant** (envoyer une adresse depuis un autre appli) | Absent (pas de `share_target` dans `app/manifest.ts`, pas d'`intent-filter` ni d'extension de partage dans `mobile/`) ; seul l'import par collage de lien existe | Android : filtres d'intention `SEND` et `VIEW geo:` ; iOS : extension de partage ou schéma d'URL | 2 |
| **Voix** | Synthèse vocale du WebView (`speechSynthesis`, `fr-FR`) | Qualité variable selon l'appareil ; voix native recommandée | 4 |

**Encadré — contraintes légales françaises (à faire valider par un juriste avant toute fonction)** :

- L'**avertissement de radars** est encadré par le Code de la route (articles R. 413-15 et suivants, à confirmer) : un service d'aide à la conduite ne doit pas indiquer la position des radars ni des contrôles de police ; il peut seulement signaler des **zones de danger** de manière générique. Les signalements communautaires de « contrôle de police » sont donc à proscrire.
- La **manipulation d'un téléphone en conduisant** est interdite ; le guidage doit rester utilisable sans toucher l'écran. C'est déjà l'esprit du mode épuré en mouvement (`lib/colis/epure-conduite.ts`, seuil 15 km/h) et de la consigne CGU art. 3.
- Les limitations de vitesse affichées sont **indicatives** (données OpenStreetMap, `maxspeed`) ; le panneau fait foi. Ce message est déjà dans le code (`app/api/colis/limitation`) et devra figurer dans les CGU GO.

---

## 2. Architecture cible « GO autonome + connecteurs »

```
                    ┌─────────────────────────── Application GO (stores) ──────────────────────────┐
                    │  Client GO embarqué (cartes, guidage, voix, scan, favoris, file hors ligne)    │
                    │  Mode « Perso »  ◄────────────────────────────►  Mode « Pro » (source active)  │
                    └───────────────┬──────────────────────────────────────────────┬─────────────────┘
                                    │ API GO (/api/go/v1) : routage, lieux,        │ missions, preuves,
                                    │ compte, favoris (sync), quotas               │ événements
                         ┌──────────▼──────────┐                         ┌─────────▼───────────────────┐
                         │ Services GO         │                         │ Connecteurs (interface)      │
                         │ routage / lieux /   │                         │ GODAC natif · Import · Partage│
                         │ trafic (fournisseurs)│                        │ API+webhooks · Export         │
                         └─────────────────────┘                         └─────────┬───────────────────┘
                                                                                   │
                                          Organisation GODAC (delivery_runs…)   TMS tiers   fichiers
```

### 2.1 (a) Identité propre de GO

| Sujet | Proposition | Notes |
|---|---|---|
| **Marque** | « GO » comme marque produit, avec la mention « un produit GODAC » (éditeur identifié) | « GO » est un mot très courant : vérifier la disponibilité (INPI, bases des stores, domaines, marques existantes en navigation) **avant** tout travail de charte. Prévoir un nom de store plus descriptif (par exemple « GO — Navigation et tournées ») |
| **Domaine** | Départ : sous-domaine de `godac.app`, servi par le même déploiement. Cible : domaine propre à GO | Le middleware sait déjà router par hôte (`lib/domaines/routage.ts` : `HOTES_VITRINE`, `HOTES_APP`). Ajouter une famille d'hôtes « GO » (vitrine GO, pages légales GO, liens universels). Un domaine propre se prépare tôt (liens universels et pages `.well-known` liés à l'hôte) mais peut rester une redirection au début |
| **Application des stores** | **Nouvelle application GO** (nouvel identifiant de paquet, nouvelle fiche), distincte de « GODAC Livreur » | `appId` ne change plus après publication. « GODAC Livreur » reste en service le temps de la transition (même comptes, même API), puis est dépréciée par une mise à jour qui renvoie vers GO. Cela **modifie la recommandation Q6** de `docs/profils-activite.md` (« une seule application ») : une seule application GO reste vraie, mais elle porte l'identité GO, pas GODAC |
| **Éditeur et comptes développeur** | Comptes Apple et Google **au nom de la société** (SIRET, D-U-N-S) | Évite le nom d'un particulier comme éditeur et les contraintes des comptes personnels |
| **Interface** | Aucune mention « colis » ni « tournée colis » dans le mode Perso ; vocabulaire neutre (« étape », « destination ») ; le mode Pro reprend le vocabulaire du profil de la source (`docs/profils-activite.md`) | La couche de vocabulaire du plan des profils sert ici aussi |
| **Documents** | CGU GO, politique de confidentialité GO, mentions légales, page d'assistance GO | Section 4 |

### 2.2 (b) Compte personnel GO, indépendant, avec rattachement à des sources

**Principe** : une identité GO (Supabase Auth) qui **n'a pas de ligne `users`** et donc pas d'organisation. Les tables et gardes de GODAC ne la voient pas (`getCurrentAppUser()` rend `null` : elle est exclue de tout l'espace GODAC par construction, sans modifier `users`). Une nouvelle garde `garderGo()` ouvre uniquement `/api/go/v1/**`.

Tables proposées (**conception, non appliquée** ; toutes avec RLS « propriétaire = `auth.uid()` » et migration additive rejouable) :

| Table | Contenu | Remarque |
|---|---|---|
| `go_profiles` | `user_id` (pk, vers `auth.users`), `plan` (`free`, `premium`), `locale`, `pays`, `cree_le`, consentements (versions de CGU et de politique, date) | Créée à la première connexion dans GO. Un chauffeur GODAC existant reçoit un profil GO à la demande, sans migration de masse |
| `go_favoris` | `user_id`, `libelle`, `type` (`domicile`, `travail`, `autre`), `adresse`, `lat`, `lng` | Facultative : le stockage local est la règle (2.5) |
| `go_sources` | `id`, `type` (`godac_org`, `api`, `import`), `libelle`, identifiant externe (organisation, instance), `statut` | Catalogue des sources connues de GO |
| `go_rattachements` | `user_id`, `source_id`, `statut` (`en_attente`, `actif`, `quitte`, `revoque`), `portee` (missions, preuves, position pendant mission), `consentement_le`, `texte_consentement` | Un utilisateur, plusieurs sources ; consentement versionné comme `ACCORD_USAGE_VERSION` |
| `go_codes_rattachement` | Code d'invitation émis par une source : hash du jeton (même procédé que `lib/go-navigation/jeton.ts`), expiration, usage unique ou nombre maximal, révocation | Rate-limité comme la page publique actuelle |
| `go_jetons_api` | Jetons d'API (phase 3) : hash, portées, expiration, dernière utilisation | 2.3 |

**Rattachement à une organisation GODAC** :
1. La direction crée un **code de rattachement GO** (écran à ajouter dans « Faire essayer GO » ou dans l'équipe) pour un chauffeur donné ; il s'affiche en clair une seule fois, sous forme de code court et de QR.
2. Le chauffeur, dans GO, choisit « Rejoindre une entreprise » et entre le code. GO affiche **ce que la source verra** (liste de points, preuves de remise, position pendant une tournée en cours) et demande le consentement.
3. Le serveur lie l'identité GO à l'utilisateur GODAC prévu (`users.id` désigné lors de la création du code) : **le compte GODAC existant n'est pas dupliqué**. Le chauffeur peut aussi se connecter avec ses identifiants GODAC actuels (e-mail, PIN de badge, passkey) : ce sont les mêmes comptes `auth.users`, GO ajoute simplement le profil.
4. Quitter une source : bouton dans GO ; la source cesse de recevoir des événements. Les données déjà dans la source restent à elle (elle est responsable de traitement de ses missions).

**Rattachement à une autre plateforme** : par **jeton** émis par la plateforme ou par GO (phase 3), avec les mêmes écrans de consentement.

**Cohabitation avec l'essai « GO Navigation » actuel** : les invités par lien continuent de recevoir une organisation d'une personne (offre `go_navigation`) ; ce montage reste le moyen de faire essayer GO à un transporteur. Il ne sert pas au particulier.

### 2.3 (c) Interface de connecteurs

**Modèle neutre.** GO ne parle pas « colis » mais deux objets, définis une fois, versionnés (`schema: "go.mission/1"`).

```ts
// Squelette documentaire (non implémenté)
interface MissionGo {                 // une liste de points pour une journée / un trajet
  id: string;                         // identifiant GO
  sourceId: string; refExterne: string | null;   // idempotence côté source
  jour: string;                       // AAAA-MM-JJ
  titre: string | null;
  depart?: LieuGo; retour?: LieuGo;
  points: PointGo[];
}
interface PointGo {                   // point de remise / d'enlèvement / étape
  id: string; refExterne: string | null;
  genre: "remise" | "enlevement" | "etape";
  libelle: string; adresse: string; lat?: number; lng?: number;
  creneau?: { debut: string; fin: string };
  contact?: { nom?: string; telephone?: string };          // facultatif, masquable par profil
  consignes?: string; quantite?: number;
  preuves?: ("photo" | "signature" | "code" | "aucune")[]; // exigences de la source
  statut: "a_faire" | "fait" | "echec";
}
interface EvenementGo {               // ce que GO renvoie à la source
  id: string;                         // clé d'idempotence
  type: "mission.demarree" | "point.arrive" | "point.fait" | "point.echec" | "mission.cloturee" | "trace.lot";
  missionId: string; pointId?: string; le: string;
  preuve?: { type: string; ref: string }; motif?: string;
  position?: { lat: number; lng: number; precision?: number };   // seulement si la portée l'autorise
}
```

L'identifiant `idempotence` repose sur le mécanisme existant (`lib/offline/idempotence-serveur.ts`) : un événement rejoué n'a pas d'effet double.

**Interface de connecteur** (côté serveur GO) :

```ts
interface ConnecteurGo {
  type: "godac" | "import" | "api" | "partage";
  lireMissions(user, jour, curseur?): Promise<MissionGo[]>;      // tirer
  recevoirEvenement(user, evt: EvenementGo): Promise<"ok" | "doublon" | "refuse">; // pousser vers la source
  capacites: { preuves: string[]; positionEnMission: boolean; ecriture: boolean };
}
```

| Connecteur | Sens | Détail |
|---|---|---|
| **GODAC natif** | Lecture + écriture | Adaptateur **au-dessus des routes existantes** `app/api/colis/**` : `delivery_runs` / `delivery_stops` ↔ `MissionGo` / `PointGo`, sans modifier les tables. Les clés techniques (`delivered`, `parcel_code`) restent celles d'aujourd'hui (règle « clés stables » de `docs/profils-activite.md`) |
| **Import** | Entrant | CSV / Excel (`lireFichier`), lien Google Maps (`lireLienGoogleMaps`, `lireListeGoogle`), liste collée, **photo ou scan d'étiquette** (scanner natif + `ocr_label`, quota), vers une mission locale. Réutilise `lib/colis/import.ts` |
| **Partage entrant** | Entrant | Menu « Partager » d'une autre application (texte, URL Google Maps, Apple Plans, Waze), URI `geo:lat,lng?q=...`, liens universels du domaine GO (`/aller?...`), schéma d'URL de l'application. Android : `intent-filter` `SEND text/plain` et `VIEW geo:` ; iOS : extension de partage (cible native avec groupe d'applications) et/ou schéma d'URL. Le contenu reçu est toujours **validé et nettoyé** : seules des adresses ou coordonnées sont extraites |
| **API publique + webhooks** | Les deux | Pour TMS tiers (phase 3), détail ci-dessous |
| **Export** | Sortant | Trace en **GPX**, liste en **CSV**, preuves de remise (fichier ZIP : photos + CSV horodaté), à la demande de la personne ou de la source |

**API publique (phase 3).**

| Aspect | Décision proposée |
|---|---|
| **Base** | `https://<domaine GO>/api/go/v1/…` ; le préfixe `v1` est dans l'URL, plus un en-tête `GO-Version` à date pour les évolutions rétrocompatibles ; une version majeure supportée au moins 12 mois après l'annonce de la suivante (**durée à décider**) |
| **Ressources** | `POST /missions` (créer ou remplacer par `refExterne`), `GET /missions/{id}`, `POST /missions/{id}/points`, `PATCH /points/{id}`, `GET /evenements` (relecture), `POST /webhooks` (abonnement), `GET /chauffeurs/{ref}` (état du rattachement). Créer une mission **pour un chauffeur rattaché** : `chauffeurRef` choisi par la plateforme, associé au rattachement |
| **Authentification** | Jeton porteur de la source (`Authorization: Bearer go_live_…`), 32 octets aléatoires, **seul le hachage est stocké**, aperçu des 4 derniers caractères, expiration, portées (`missions:ecrire`, `evenements:lire`, `webhooks:gerer`), révocation immédiate. Clés `go_test_…` pour un bac à sable |
| **Webhooks** | Corps JSON `EvenementGo`, en-têtes `GO-Event-Id`, `GO-Timestamp`, `GO-Signature: v1=<HMAC-SHA256(secret, timestamp + "." + corps)>` ; rejet côté récepteur si l'horodatage a plus de 5 minutes ; secret par abonnement, **rotation** avec période de recouvrement ; nouvelles tentatives à délai croissant (par exemple 1 min, 5 min, 30 min, 2 h, 12 h) puis abandon avec alerte ; réponse attendue 2xx en 10 s ; journal des livraisons consultable ; l'événement est **rejouable** à la demande. Appels sortants soumis à la même protection SSRF que le logo de bulletin (`lib/http/fetch-image-sure.ts` : https, adresses publiques, redirections recontrôlées, délai et taille bornés) |
| **Idempotence** | En-tête `Idempotency-Key` sur tout `POST`/`PATCH` ; `refExterne` unique par source |
| **Quotas** | Limites par jeton et par source (requêtes par minute, missions et événements par mois), en-têtes `RateLimit-*` et `Retry-After` ; se branche sur `lib/http/limite-debit.ts` ; dépassement = 429, jamais de facturation surprise (même logique que les plafonds d'essai) |
| **Données sensibles** | Aucun champ de santé ; `contact` facultatif et masquable ; la position n'est envoyée à la source que pendant une mission active et avec la portée consentie par le chauffeur |
| **Documentation** | Spécification OpenAPI publiée, exemples, bac à sable, journal des changements |
| **Ouverture** | Sur liste d'attente avec deux intégrateurs pilotes avant toute inscription libre (question 8) |

### 2.4 (d) Mode « Aller à… » du particulier

Réutilise le moteur existant, sans tournée :

1. **Extraction** : séparer `GoNavigation.tsx` en `MoteurNavigation` (carte, position, tracé, recalcul, manœuvres, voix, limitation, ETA, mode épuré) et `FeuilleTournee` (cartes d'arrêts, appel, clôture, ramasse, horaires). Le moteur reçoit une **liste de destinations** et un **fournisseur d'itinéraire** ; la tournée GODAC devient une instance parmi d'autres.
2. **Routage GO** : `POST /api/go/v1/route` (équivalent organisation-indépendant de la « voie rapide » de `/api/colis/itineraire`, qui accepte déjà `{ depuis, point }` sans base de données). Garde `garderGo`, quota personnel, limiteur de débit, cache. Le corps ne contient **que des coordonnées**, jamais d'identifiant ni de texte.
3. **Recherche de lieux GO** : `GET /api/go/v1/lieux?q=` sur BAN + Photon (+ Nominatim hors France), **sans annuaire interne**, avec biais de proximité facultatif (position approximative arrondie). Google Places seulement pour les comptes Premium (coût à l'usage).
4. **Favoris** : Domicile, Travail, lieux nommés ; stockés **localement** (IndexedDB) ; synchronisation de compte seulement si l'utilisateur l'active (Premium).
5. **Récents** : dernières destinations, 30 derniers jours par défaut, effaçables en un geste, locales.
6. **Multi-étapes** : liste d'étapes avec « ordre libre » ou « optimiser » (réutilise `lib/colis/optimisation.ts` et son quota `route_optimization`).
7. **Écran de départ** : barre de recherche, favoris, récents, bouton « Ma position » ; **un seul geste** pour lancer le guidage ; réglages de voix et de vue conservés.
8. **Cohérence avec la règle de non-manipulation en conduite** : tout se prépare à l'arrêt ; en mouvement, le mode épuré actuel s'applique (aucune saisie).

### 2.5 (e) Stockage local, synchronisation, hors réseau, idempotence

| Sujet | Règle |
|---|---|
| **Où vivent les données** | *Source de vérité* : la source pour ses missions (GODAC, TMS) ; l'appareil pour le mode Perso (favoris, récents, réglages). GO ne garde de la source que la journée utile, puis purge (7 jours après clôture par défaut, **à décider**) |
| **Stockage local** | IndexedDB (déjà utilisé : `godac-offline-v1`) pour la file d'actions et les fichiers ; un second magasin `go-local` pour favoris, récents, mission du jour, préférences. Chiffrement au repos laissé au système (verrouillage de l'appareil) ; rien d'identifiant en `localStorage` autre que les préférences |
| **Synchronisation** | Missions : *tirer* à l'ouverture et à intervalle (et sur notification), *pousser* les événements dans l'ordre par la file existante. Favoris : synchronisation optionnelle, dernier écrit gagne par élément (horodatage), suppression par « pierre tombale » |
| **Idempotence** | Un identifiant d'action par événement (mécanisme existant `X-GODAC-Offline-Action`, à généraliser sous `Idempotency-Key`) ; le serveur renvoie le même résultat pour un rejeu ; la file reste attachée au compte qui l'a créée |
| **Hors réseau (cible)** | Niveau 1 (phase 2, avec le client embarqué) : l'application **s'ouvre sans réseau**, affiche la mission du jour mise en cache, accepte les actions et les preuves. Niveau 2 (phase 4) : fond de carte et itinéraire de la **mission du jour préchargés** (tracé complet et manœuvres téléchargés au démarrage). Niveau 3 (phase 4, native) : carte et routage hors réseau complets |
| **Changement de compte** | Les données locales sont rattachées au compte ; un autre compte sur le même appareil ne les voit pas (comportement déjà présent pour la file d'actions) |

### 2.6 (f) Options technologiques comparées

Les coûts sont en **jours d'effort d'agent**, estimés à ± 40 % ; ils supposent la réutilisation de la logique pure TypeScript quand c'est possible.

| Option | Principe | Effort estimé pour GO particulier + pro | Délai stores | Risque stores | Qualité de navigation | Remarques |
|---|---|---|---|---|---|---|
| **A. Coquille actuelle** (`server.url`) + plugins | Statu quo, ajout de plugins | 15 à 20 j | Court (mises à jour par le site) | **Élevé** (4.2) | Moyenne : localisation de fond tenue par plugin, pas de CarPlay | Plus rapide, mais l'application dépend entièrement du réseau et du serveur |
| **B. Capacitor + client GO embarqué** + plugins natifs ciblés | Le client GO (React) est empaqueté dans l'application ; il appelle l'API GO ; plugins : localisation de fond, voix native, partage entrant, notifications locales ; code natif minimal si besoin | 35 à 45 j (inclus dans les phases 1 et 2) | Moyen (mises à jour du client par les stores ; **correctifs de contenu** possibles par téléchargement de ressources web, à vérifier au regard des règles Apple/Google) | **Moyen** : application réellement installée, ouvrable sans réseau, fonctions natives | Bonne en voiture jusqu'à la phase 3 ; CarPlay et Android Auto possibles par **module natif ajouté** à la coquille (Capacitor héberge du code natif) | Réutilise 100 % de la logique pure et du composant carte ; demande un **client GO séparé de l'application GODAC** (export statique ou application Vite/Next dédiée) |
| **C. React Native** | Réécrire l'interface en React Native, garder la logique TypeScript | 65 à 90 j | Moyen | Faible | Très bonne (carte MapLibre native, localisation de fond mature) | Bonne réutilisation de la logique pure (navigation, manœuvres, import, file hors ligne) ; **réécriture de ~3 300 lignes d'interface** (`GoNavigation` 1 860 + `AppLivreur` 1 467) et de la carte |
| **D. Flutter** | Réécrire en Dart | 80 à 110 j | Moyen | Faible | Très bonne | Aucune réutilisation de la logique TypeScript : double maintenance du moteur (web de GODAC et mobile) |
| **E. Natif Swift + Kotlin** | Deux applications natives | 130 à 200 j | Moyen | Très faible | **Excellente** (CarPlay, Android Auto, routage embarqué, voix, batterie) | Deux bases de code ; compétence native à acquérir ; à réserver à un produit grand public avec traction prouvée |

**Recommandation : B**, par étapes.

1. Phase 1 : le moteur extrait et les écrans « Aller à… » restent dans l'application web actuelle (aucun risque de store, test rapide sur téléphone).
2. Phase 2 : **nouvelle application GO** avec client embarqué (B) et plugins natifs de localisation de fond, voix, partage entrant.
3. Phase 4 : modules natifs ajoutés à la même coquille pour CarPlay / Android Auto ; carte hors réseau par MapLibre natif.
4. **Critères de bascule vers C ou E** (jalon 3) : plus de N utilisateurs particuliers actifs par semaine, CarPlay / Android Auto jugés indispensables par l'étude de marché, ou refus répété d'un store malgré les fonctions natives. Chiffres à fixer avec le fondateur.

Arguments : (i) l'essentiel de la valeur est dans la logique pure déjà écrite et testée, qui se réutilise intégralement en B et en C ; (ii) la qualité « Waze » ne vient pas du langage mais du **trafic**, de la **localisation de fond** et de la **voix**, accessibles par plugins ; (iii) le risque Apple 4.2 baisse nettement dès que le client est embarqué et que des fonctions natives existent ; (iv) CarPlay / Android Auto sont le seul point où une WebView est structurellement insuffisante, et ils arrivent en phase 4.

### 2.7 (g) Routage et trafic

| Besoin | Option | Ordre de grandeur de coût (**à vérifier**) | Remarques |
|---|---|---|---|
| **Routage de base** | **OSRM hébergé par GODAC** (profil voiture ; extrait OpenStreetMap France) | Serveur dédié ou machine virtuelle de quelques dizaines à ~150 € par mois, selon mémoire et disponibilité ; temps de mise à jour des données à planifier (mensuel) | Le serveur public de démonstration (`router.project-osrm.org`, valeur par défaut de `ROUTING_URL`) **ne doit pas rester la production** : politique d'usage restrictive, pas de garantie. La documentation du dépôt prototype le dit déjà (`LICENSE-NOTICE.md`). Remplaçable par variable d'environnement : **aucune modification de code** |
| **Poids lourd, contraintes, multi-profils** | Valhalla ou GraphHopper auto-hébergés | Comparable, plus de mémoire | Profil camion (hauteur, poids) ; à n'ouvrir que si le segment le demande |
| **Routage hébergé payant** | HERE, TomTom, Mapbox, Google (Routes), OpenRouteService | Du gratuit limité à quelques euros pour mille requêtes selon le produit | Intéressant pour démarrer vite ; coût proportionnel à l'usage, à comparer à l'auto-hébergement à partir d'un certain volume |
| **Trafic temps réel** | Options payantes : HERE Traffic, TomTom Traffic, Mapbox Traffic, Google ; ou données de trafic ouvertes locales | Souvent facturé au nombre de requêtes d'itinéraire avec trafic ou à la couverture : de l'ordre de quelques euros à plusieurs dizaines d'euros pour mille requêtes | **Premium seulement** ; le modèle économique doit couvrir ce coût variable (section 3). Condition d'entrée : preuve d'usage de la phase 1 |
| **Fond de carte** | OpenFreeMap (actuel, gratuit, sans clé) ; ou tuiles auto-hébergées (PMTiles) ; ou fournisseur payant (MapTiler, Stadia, Mapbox) | Gratuit à quelques dizaines d'euros par mois selon trafic | Hors réseau : tuiles en fichier (PMTiles) ; la France entière représente **quelques Go** (à vérifier) |
| **Recherche de lieux** | BAN (gratuite) + Photon (public) ; Photon auto-hébergé à l'échelle ; Google Places pour Premium | Places : coût à l'usage | Photon public et Nominatim public ont des règles d'usage : le volume « particulier » les dépassera ; prévoir l'auto-hébergement de Photon ou un fournisseur dès la phase 2 |
| **Limitation de vitesse** | Overpass public (actuel, `OVERPASS_URL`) | Gratuit mais fragile | Pour un volume grand public : instance dédiée ou précalcul dans le serveur de routage |

**Ordre** : OSRM hébergé en phase 1 (variable `ROUTING_URL`, supervision, repli sur ligne droite déjà prévu) ; Photon et Overpass dédiés en phase 2 ; trafic payant en phase 4.

---

## 3. Modèle économique

### 3.1 Principe

Trois niveaux d'usage, **un seul produit** :

| Niveau | Pour qui | Contenu | Facturation |
|---|---|---|---|
| **GO Pro (inclus dans GODAC)** | Chauffeurs d'une organisation | Tout ce que fait GO aujourd'hui, profil d'activité, preuves, hors réseau de base, source GODAC native | Inchangée : module `route_optimizer` facturé par palier d'utilisateurs (`MODULES_PAR_PALIER`, `module_user_tiers`) |
| **GO Free** | Particuliers | « Aller à… », favoris et récents locaux, guidage vocal, routage sans trafic, import et partage entrant limités | Gratuit, avec plafonds mensuels de routage et de recherche |
| **GO Premium** | Particuliers et chauffeurs indépendants | Trafic en direct, cartes hors réseau, synchronisation de compte, multi-étapes optimisées, connecteurs avancés (import en volume, lecture d'étiquettes), CarPlay / Android Auto à terme | Abonnement mensuel ou annuel (prix à fixer après phase 1) |
| **GO Connect** | Plateformes et TMS | API publique, webhooks, jetons, bac à sable | Forfait + volume (missions et événements), ou gratuit pour les intégrateurs pilotes |

### 3.2 Ce qui se paie (et pourquoi)

Ce qui coûte à GODAC à l'usage est ce qui se paie :

| Poste | Coût variable | Traitement |
|---|---|---|
| Trafic | Facturé par le fournisseur à la requête ou à la couverture | Premium |
| Cartes hors réseau | Stockage et bande passante de téléchargement | Premium |
| Lecture d'étiquette (IA) | Jetons IA (suivis par `lib/usage/jetons.ts`) | Quota mensuel ; au-delà, Premium ou paiement à l'usage (comme aujourd'hui en pro) |
| Recherche de lieux enrichie (Places) | Facturée par Google | Premium |
| Connecteurs et API | Appels entrants et sortants, stockage du journal | Quota, puis forfait |
| Synchronisation multi-appareil | Stockage | Premium |

Ce qui reste **gratuit pour tous** : le guidage lui-même, la sécurité (avertissements, mode épuré), l'export de ses propres données et la suppression du compte (obligations RGPD, jamais conditionnées au paiement).

### 3.3 Cohérence avec les paliers actuels

| Existant | Conséquence |
|---|---|
| `OFFRE_GO_NAVIGATION`, `DUREE_ESSAI_JOURS = 30`, `PLAFONDS_ESSAI` (3 000 lectures d'étiquettes, 300 optimisations par mois) | Les plafonds d'essai donnent l'ordre de grandeur d'un usage professionnel soutenu. Pour GO Free, des plafonds **plus bas** et sans date de fin d'essai. L'essai pro (invitation) est inchangé |
| `PLAN_TIERS = essentiel / starter / pro / business` et `usage_events` (organisation obligatoire) | Ajouter une propriété alternative (`user_id` GO) ou une table `go_usage_events` pour les comptes personnels ; **à décider avec la phase 1** pour ne pas déformer la facturation des organisations. Nouvelles fonctions comptées : `go_route`, `go_lieux`, `go_trafic` |
| `lireEtatOffre` ne s'ouvre jamais en cas d'erreur (fail-closed, dernier état utilisable 10 min) | Même discipline pour le plan GO : une lecture impossible n'accorde pas Premium |
| Règle de `docs/profils-activite.md` : « le profil n'est pas un palier » | Étendue : le **mode** (Perso / Pro) n'est pas non plus un palier ; le palier ne touche jamais aux données ni aux clés |
| Page des CGV : GO « gratuit pour le chauffeur, facturé au Client par palier d'utilisateurs » | Reste vrai pour GO Pro ; ajouter les conditions GO particuliers dans des CGU séparées |

### 3.4 Ce qui n'est pas décidé ici

Les **prix**. Ils dépendent du coût réel du trafic, du volume de la phase 1 et du marché. Méthode : mesurer le coût par utilisateur actif pendant la bêta gratuite (routage, recherche, trafic), puis fixer le prix de Premium avec une marge suffisante. La phase 1 livre donc **les compteurs, pas la facturation**.

---

## 4. RGPD et responsabilité

### 4.1 Responsables de traitement

| Mode | Responsable de traitement | Rôle de GODAC / GO |
|---|---|---|
| **Perso** (particulier) | L'éditeur de GO (société GODAC) | Responsable de traitement pour les données du compte, des favoris synchronisés et du routage |
| **Pro** (source = organisation GODAC) | L'organisation | Sous-traitant, cadre du DPA existant (`app/dpa/page.tsx`) |
| **Pro** (source = plateforme tierce via API) | La plateforme | Sous-traitant ou destinataire selon contrat ; **contrat d'intégration** à rédiger avant l'ouverture de l'API |

Le mode actif est **toujours visible** dans l'application (bandeau « Perso » / « Pro — Nom de la source ») et change les règles de collecte.

### 4.2 Position GPS d'un particulier

| Principe | Application |
|---|---|
| **Minimisation** | La position sert au guidage, point. Pas de trace par défaut, pas de profilage, pas de revente, pas de publicité ciblée |
| **Durée très courte** | Position transmise au service de routage = **coordonnées sans identité**, conservées uniquement le temps de la requête (cache d'itinéraire par coordonnées arrondies, expirant en minutes) ; aucun journal de position côté GO en mode Perso. Historique de destinations **local**, effaçable ; synchronisation seulement si activée |
| **Pas de pistage inutile** | Pas d'enregistrement de trajet en mode Perso (la trace de tournée existante est une fonction **Pro**, avec suivi par l'encadrement et conservation 1 an, `lib/retention/purge.ts`). Les journaux techniques (limiteur de débit) gardent l'adresse IP hachée seulement (`docs/garde-fous-techniques.md`) |
| **Consentement** | Autorisation de localisation du système au premier usage, avec message exact sur l'usage réel ; autorisation « en arrière-plan » demandée **seulement quand le guidage est lancé** et expliquée avant la fenêtre système. Consentement séparé et révocable pour : synchronisation des favoris, amélioration du service par statistiques d'usage (sur le modèle de l'accord facultatif `ACCORD_USAGE_TEXTE`, jamais coché par défaut) |
| **Transparence** | Politique de confidentialité GO (langage clair), fiches « Sécurité des données » et « Confidentialité de l'app » alignées sur ce qui se passe réellement (point de départ : corriger le texte de permission inexact relevé en 1.5) |
| **Mineurs** | Âge minimal à fixer dans les CGU GO (à valider juridiquement) ; pas de ciblage |

### 4.3 Sous-traitants et transferts

Liste de départ à intégrer à la politique GO et à l'annexe 3 du DPA (déjà : BAN, Photon / Komoot, Nominatim / OSM, OSRM, OpenFreeMap, Anthropic, Google Places, hébergeurs) :

| Sous-traitant | Données reçues | Remarque |
|---|---|---|
| Hébergeur applicatif et base | Compte, favoris synchronisés | Région à confirmer (`vercel.json` : `cdg1`) |
| Serveur de routage (auto-hébergé) | Coordonnées | Sous-traitant = GODAC lui-même ; l'hébergeur de la machine devient sous-traitant ultérieur |
| Fournisseur de trafic (phase 4) | Coordonnées d'itinéraire, adresse IP du serveur | Contrat et clauses à vérifier ; préférer un fournisseur dans l'Union européenne ou avec garanties adéquates |
| Fournisseurs de cartes et de tuiles | Adresse IP, zone affichée | Déjà signalé dans la politique actuelle |
| Recherche de lieux (BAN, Photon, Places) | Texte saisi, position approximative | Pour Places, ne transmettre que si Premium |
| Lecture d'étiquette (Anthropic) | Photo, uniquement si activée | Désactivable ; pas d'usage pour l'entraînement (déjà indiqué) |
| Service de notification (Apple, Google) | Jeton d'appareil | Déjà indiqué |

### 4.4 Responsabilité de la conduite et conditions d'utilisation

À faire rédiger / relire par un juriste (prérequis de la phase 2) :
- Le **conducteur reste responsable** : le guidage est indicatif, le Code de la route et la signalisation prévalent (limitations « indicatives », itinéraire parfois erroné, fermetures non connues). Reprendre et étendre l'article « Bon usage » des CGU actuelles.
- **Pas d'utilisation en conduisant** pour la saisie ; l'interface se bride en mouvement.
- **Pas de garantie** de disponibilité ni de trafic en temps réel avant la phase 4 ; formulation prudente, comme la page SLA (aucun chiffre de disponibilité sans accord du fondateur).
- **Pas d'avertissement de radars ni de contrôles** (4.5).
- **Pas de poids lourd certifié** : l'itinéraire voiture n'est pas un itinéraire poids lourd (le prototype le disait déjà). Message clair dans l'application.
- **Assurance** : vérifier la couverture en responsabilité civile professionnelle de l'éditeur pour une application de navigation grand public.

### 4.5 Données de santé et radars

- **Données de santé hors périmètre** : GO n'a ni champ, ni stockage de donnée de santé (principe de `docs/profils-activite.md` : référence de mission seulement). Les favoris libres (« Hôpital », « Cabinet ») sont des adresses saisies par l'utilisateur, stockées localement ; le texte de la politique doit rappeler de ne pas y saisir d'information de santé. La lecture d'étiquette reste désactivable par profil.
- **Radars** : voir l'encadré de 1.6 ; décision de principe de ne pas en proposer (question 7).

### 4.6 Droits des personnes

| Droit | Mise en œuvre |
|---|---|
| **Accès, portabilité** | Export du compte : favoris, récents, traces éventuelles (GPX / CSV) à la demande, en un geste dans l'application |
| **Effacement** | **Suppression du compte dans l'application** (obligation Apple) : efface le profil GO, favoris, rattachements, jetons ; les missions déjà remises à une source restent à la source (responsable de ses données) ; délai de traitement annoncé |
| **Rectification, opposition, limitation** | Édition des favoris et du profil ; retrait de chaque consentement ; quitter une source |
| **Retrait d'une source** | Immédiat côté GO ; la source est informée par l'événement `rattachement.quitte` |
| **Contact** | Adresse dédiée dans la politique (délégué ou contact RGPD) |
| **Registre et analyse d'impact** | Mettre à jour le registre de traitements ; **évaluer la nécessité d'une analyse d'impact** pour un service de géolocalisation grand public (à confirmer avec le conseil juridique avant la phase 2) |

---

## 5. Plan par phases

Les durées sont en **jours d'effort d'agent** (une personne-agent à plein temps), tests et documentation compris, hors délais d'attente (validation Apple / Google, juridique, livraison de serveur). Fourchette de précision : ± 25 %.

### 5.1 Phases

| Phase | Contenu | Jours | Dépend de |
|---|---|---|---|
| **0. Corrections préalables** (indépendantes, à faire tout de suite) | Réécrire les textes de permission iOS / Android et la fiche « Sécurité des données » de `mobile/STORES.md` pour qu'ils décrivent l'usage réel (guidage, suivi de la tournée, pointage) ; remplacer `ROUTING_URL` par un serveur à nous en production (dès que l'hébergement existe) ; ajouter `PrivacyInfo.xcprivacy` ; `allowBackup=false` | 2 | — |
| **1. GO particulier : « Aller à… » + favoris + marque + compte** | **1.1** marque et identité GO (nom, charte, hôtes GO dans `lib/domaines/routage.ts`, pages légales GO) 3 j ; **1.2** compte personnel (`go_profiles`, `garderGo`, inscription, **suppression de compte**, consentements versionnés) 5 j ; **1.3** extraction du moteur (`MoteurNavigation` / `FeuilleTournee`), non-régression de GODAC Livreur par les tests existants 6 j ; **1.4** API GO routage + lieux, quotas personnels (compteurs seulement), limiteur de débit 4 j ; **1.5** écrans « Aller à… », favoris, récents, multi-étapes 5 j ; **1.6** serveur de routage hébergé (déploiement, supervision, bascule, repli) 3 j ; **1.7** tests, documentation, bêta fermée par invitation 2 j | **28** | Phase 0, Q1, Q3, Q4 |
| **2. Connecteurs + application des stores séparée** | **2.1** interface de connecteur, modèle neutre, **connecteur GODAC natif**, rattachement par code (`go_sources`, `go_rattachements`, `go_codes_rattachement`, écrans de consentement) 8 j ; **2.2** import CSV / Excel / lien / photo d'étiquette pour le particulier, quotas 4 j ; **2.3** partage entrant (Android intent, iOS extension / schéma, liens universels) 5 j ; **2.4** application GO des stores : nouveau projet Capacitor, client embarqué, plugins (localisation de fond, voix), icônes, fiches, notes de validation, CI, compte de démonstration 8 j ; **2.5** export GPX / CSV / preuves 1,5 j ; **2.6** Photon et Overpass dédiés 2 j (services seulement, hors code) | **28** | Phase 1, jalon 1, Q2, Q5, relecture juridique |
| **3. API publique + webhooks** | Modèle de mission v1 figé, jetons d'API, portées, webhooks signés avec nouvelles tentatives et journal, rotation des secrets, bac à sable, OpenAPI, portail de gestion des jetons, quotas, tests de contrat, documentation, guide de rattachement pour intégrateurs, **deux pilotes** | **20** | Phase 2, Q8 |
| **4. Trafic, hors réseau, CarPlay** | **4.1** trafic (choix du fournisseur par comparaison, intégration au routage, ETA avec trafic, Premium) 8 j ; **4.2** mission du jour préchargée (tracé, manœuvres, tuiles) 6 j ; **4.3** cartes hors réseau (PMTiles + MapLibre natif) 12 j ; **4.4** voix native et localisation de fond affinée (batterie) 5 j ; **4.5** facturation Premium (Stripe, `go_profiles.plan`, caisse d'abonnement, restauration d'achats si achat dans l'application) 8 j ; **4.6** CarPlay et Android Auto (modules natifs, autorisations, tests sur véhicule) 25 à 40 j | **64 à 79** (4.1 à 4.5 : 39 j ; 4.6 : 25 à 40 j) | Phase 3, jalon 3 |
| **Total** | | **~ 145** (2 + 28 + 28 + 20 + 64 à 79 ; fourchette 125 à 165 avec l'incertitude de ± 25 %) | |

**Remarque sur Premium dans l'application** : si Premium s'achète dans l'application, Apple et Google appliquent leurs règles d'achat intégré et leurs commissions. Le calcul du prix doit en tenir compte (**à vérifier**). À défaut, abonnement sur le site seulement, avec les limites de présentation que les stores imposent.

### 5.2 Jalons de validation avec le fondateur

| Jalon | Quand | Ce que le fondateur valide | Critère de passage |
|---|---|---|---|
| **J0** | Avant la phase 1 | Nom, domaine, stratégie « une application GO » (Q1, Q2, Q4) | Vérifications de marque faites |
| **J1** | Fin de phase 1 | Démonstration sur téléphone : « Aller à… », favoris, récents, multi-étapes, guidage vocal, compte, suppression ; coût mesuré par utilisateur actif ; premiers retours de 10 à 20 testeurs | Guidage jugé exploitable en voiture réelle ; coût unitaire connu ; aucune régression GODAC Livreur |
| **J2** | Fin de phase 2 | Application GO en TestFlight / test interne Google ; rattachement d'un chauffeur à une organisation GODAC par code ; import et partage entrant ; relecture juridique terminée | Soumission aux stores autorisée |
| **J3** | Mi-phase 4 | Usage réel (utilisateurs actifs par semaine, rétention, plaintes de batterie ou de trafic), choix de la technologie pour CarPlay (B étendu, C ou E) et du fournisseur de trafic | Critères chiffrés fixés avec le fondateur |
| **J4** | Phase 3 | Deux intégrateurs pilotes ont reçu des missions et renvoyé des événements en production | Contrat d'intégration signé |

### 5.3 Risques et ce qu'il ne faut pas faire trop tôt

| Risque | Gravité | Réponse |
|---|---|---|
| Refus Apple (4.2, permissions, suppression de compte) | Élevée | Client embarqué, fonctions natives, textes exacts, compte de démonstration, suppression de compte dès la phase 1 |
| Coût de routage / trafic supérieur au revenu | Élevée | Compteurs dès la phase 1, plafonds, Premium couvrant le trafic, auto-hébergement |
| Qualité de guidage insuffisante face à Waze / Google (pas de trafic, pas de signalements) | Élevée | Positionner GO sur la **tournée et les preuves** d'abord ; ne pas promettre « comme Waze » avant la phase 4 ; communication honnête |
| Mélange des données Perso et Pro | Élevée | Deux espaces de données, RLS par propriétaire, bandeau de mode, test automatique d'isolation |
| Responsabilité en cas d'accident | Moyenne | CGU relues, interface bridée en mouvement, assurance |
| Régression de GODAC Livreur pendant l'extraction | Moyenne | Tests de non-régression existants (`lib/colis/__tests__`), extraction par étapes, drapeau de repli |
| Dépendance à des services publics gratuits (OSRM démo, Overpass, Photon, OpenFreeMap) | Moyenne | Remplacement par des instances dédiées avant l'ouverture au grand public |
| Dérive du périmètre (« tout Waze ») | Moyenne | Plan par jalons, questions tranchées, liste « à ne pas faire » |

**À ne pas faire trop tôt** :
1. **CarPlay / Android Auto, cartes et routage hors réseau** avant d'avoir prouvé l'usage (phase 4).
2. **Réécriture native complète** (options C à E) sans critère chiffré.
3. **Signalements communautaires** et **toute alerte radar ou contrôle** (légalité, masse critique, modération).
4. **Facturation Premium** avant le jalon J1 (« à ne pas faire maintenant » de la page Notion).
5. **Renommer ou réutiliser `fr.godac.livreur`** pour GO.
6. **API ouverte en libre-service** avant deux intégrateurs pilotes.
7. **Un second projet Supabase** pour GO tant que l'API publique n'existe pas (complexité d'authentification et d'opérations).
8. **Fusion des tables** `delivery_runs` / `delivery_stops` avec le nouveau modèle de mission : l'adaptateur suffit.
9. **Tarifs publics** avant d'avoir mesuré le coût par utilisateur.

### 5.4 Questions à trancher avec le fondateur (8)

| # | Question | Recommandation |
|---|---|---|
| 1 | **Marque et domaine** : « GO » seul, « GO by GODAC », autre ? Domaine propre dès maintenant ? | Marque produit **« GO »** avec mention « un produit GODAC » ; **vérifier d'abord** la disponibilité (INPI, stores, domaines). Sous-domaine de `godac.app` au départ, domaine propre réservé tôt et redirigé |
| 2 | **Une ou deux applications sur les stores** ? Sort de « GODAC Livreur » (publiée ou non ?) | **Une nouvelle application GO** pour tous (particuliers et chauffeurs pros). « GODAC Livreur » reste en service au moins 6 mois puis renvoie vers GO. Si « GODAC Livreur » n'est pas encore publiée, **ne pas la publier** et publier directement GO |
| 3 | **Particulier : quand et comment** ? Bêta gratuite maintenant ou attendre le reste ? | **Bêta gratuite sur invitation en phase 1, sans paywall** ; mesurer coût et usage ; décider Premium au jalon J1. Respecte « GO Free & GO Premium : à ne pas faire maintenant » pour la partie monétisation |
| 4 | **Même base (Supabase) ou projet séparé** pour les comptes GO ? | **Même projet**, tables séparées, aucune ligne dans `users`, test d'isolation. Projet séparé seulement si l'API publique ou un partenaire l'exige |
| 5 | **Technologie** : coquille améliorée, React Native, natif ? | **Capacitor + client embarqué + plugins natifs (option B)** ; réexaminer au jalon J3 avec critères chiffrés (CarPlay, trafic, batterie) |
| 6 | **Trafic** : quand et avec quel fournisseur ? | **Phase 4**, après J1 ; fournisseur choisi par comparaison de coût réel (HERE, TomTom, Mapbox, Google), réservé à Premium. D'ici là, GO n'annonce pas de trafic |
| 7 | **Signalements et radars** : en proposer ? | **Non** : aucun signalement de radars ni de contrôles ; limitations de vitesse et, plus tard, zones de danger issues de données officielles, **après avis juridique**. Signalements d'incident (accident, travaux) seulement si la base d'utilisateurs le justifie |
| 8 | **API publique** : à qui l'ouvrir et dans quel cadre ? | **Deux intégrateurs pilotes** (un TMS, un client GODAC avec outil interne) en phase 3, contrat d'intégration et conditions d'usage ; inscription libre seulement après J4 |

## 6. Prochaines étapes

1. Réponses du fondateur aux questions 1 à 5 (au minimum) ; vérification de la marque.
2. **Phase 0** immédiatement (corrections de permissions et de routage de production), dans une branche séparée, sans attendre le reste.
3. Brief juridique : conditions d'utilisation de la conduite, politique GO, radars, âge minimal, analyse d'impact.
4. Phase 1 dans une branche `feat/go-particulier`, avec **migration proposée, non appliquée**, relue avant toute application.
5. Coordination avec le plan des profils d'activité (`docs/profils-activite.md`) : le vocabulaire neutre de GO Perso et la couche de profils de GO Pro doivent partager le même dictionnaire.
