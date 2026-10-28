# Profils d'activité pour tout GODAC (et GODAC Core)

Document de **conception uniquement** : aucun code applicatif, aucune migration appliquée. Rédigé le 28 octobre 2026 à partir de `origin/main` (commit `8ced825`) et de l'état de travail de la branche `feat/stock-codes-etiquettes` (voir « État de départ »).

## Résumé exécutif

1. **Le fondateur veut la mécanique des profils du Stock (vocabulaire, champs affichés ou obligatoires, règles d'alerte, étiquettes, valeurs par défaut) pour tout GODAC.** Elle devient la mécanique de **GODAC Core**, la version neutre pour tout type de livraison. Le sujet avait été **« REPORTÉ (23 oct.) »** dans Notion ; le fondateur le relance : ce document est la reprise.
2. **Constat** : le « colis / livré / arrêt » est codé en dur dans environ 3 260 occurrences (`app/`, `components/`, `lib/`) : tournée, preuve de livraison, scanner, bordereaux, alertes de retard, exports, guides, textes juridiques, assistant, vitrine.
3. **Cible** : un seul profil d'activité par organisation (registre de 7 profils prédéfinis + ajustements en `jsonb` validé par zod + contraintes `check`), résolu côté serveur (`lireProfil(org)`) et côté client (contexte React). C'est le modèle du Stock (`lib/stock/profils.ts`) généralisé, pas un concurrent : le Stock devient un sous-ensemble (sa lecture bascule sur le profil central).
4. **Deux couches distinctes** : le *profil d'activité* (règles : champs, alertes, preuves, contraintes) et la *couche de vocabulaire* (« colis / arrêt / livré » ou « élément transporté / point de remise / mission »), plus un *jeu de modules* (avec ou sans carburant, flotte, paie).
5. **GO (application chauffeur : liste de points, optimisation, navigation, preuve de remise, hors réseau, scan) est le SOCLE COMMUN de tous les profils et des deux offres** (GODAC et GODAC Core), pas un module d'un profil. Il doit être entièrement profil-aware et fonctionner **sans paie, sans carburant, sans planning** : des couplages restent à découper (section 2.0). GODAC = transporteurs (carburant/TICPE, flotte, planning, paie) ; GODAC Core = laboratoires, pharmacies, cliniques, traiteurs, coursiers (GO + modules activables, version sans carburant/paie possible).
6. **Compatibilité ascendante stricte** : organisation sans profil = profil « colis / messagerie » implicite = comportement actuel, octet pour octet (test de non-régression).
7. **Migration additive** : une table de configuration neuve, des colonnes neuves avec défaut, aucune suppression. RLS par organisation, audit (`journaliser`), règles par pays réutilisées (`lib/pays`).
8. **Garde-fou de contrat** : un test détecte les libellés « colis / livré / arrêt » hors dictionnaire dans les écrans migrés (cliquet : le compteur ne peut que baisser).
9. **Plan** : 6 phases, environ **30 jours d'effort d'agent** (socle + Stock 4 j ; GO profil-aware + preuve + découplage + hors réseau 9 j ; alertes/exports/documents 5 j ; flotte/exploitation 4 j ; onboarding/vitrine/guides/Core 5 j ; tests utilisateurs 3 j).
10. **À ne pas promettre** : aucune conformité sanitaire (sang, médicaments, alimentaire) ; GODAC fournit un suivi logistique configurable ; **jamais de donnée de santé nominative, seulement une référence de mission**.
11. **Point dur découvert** : l'optimiseur de tournée n'a ni fenêtre dure, ni priorité urgente, ni ordre d'enlèvement fixe (vérifié dans `lib/colis/optimisation.ts`) : le profil Santé exige un vrai travail d'algorithme (phase 2).
12. **Autre point dur** : la lecture IA des étiquettes et bordereaux (`lib/ocr/bordereau.ts`) envoie des photos à un sous-traitant ; elle doit être désactivable par profil (Santé : désactivée par défaut).
13. **8 questions** au fondateur en section 3.5 (types de missions au lancement, version sans carburant/paie, tarification, qui valide la conformité santé, marque/fiches stores, **périmètre minimal « GO seul » par profil**, etc.), avec une recommandation chacune.

---

## 0. État de départ

- **Branche Stock** : `feat/stock-codes-etiquettes` n'est **pas poussée** sur `origin` (`git fetch origin` ne la liste pas). Son état est dans le worktree local `/home/user/godac-stock-codes` : HEAD = `8ced825` (= `origin/main`) avec un important travail **non commité** (fichiers modifiés et nouveaux : `lib/stock/profils.ts` 499 lignes, `attributs.ts`, `etiquettes*.ts`, `fefo.ts`, `formats-etiquette.ts`, migrations `20261115000001` à `20261115000004`). Ce document lit cet état tel quel ; il peut évoluer. **Rien n'a été modifié dans ce worktree.**
- **Modèle du Stock réutilisé** (état local lu) :
  - `PROFILS = messagerie, palettes, sante, pharmacie, alimentaire, vrac, personnalise` (7 profils : ce sont exactement les 7 profils prédéfinis demandés).
  - `Profil` = `{ cle, libelle, description, suivi (unites|articles), famille, vocabulaire {un, plusieurs, code, codeAide}, typesUnite, champs (12 champs × masque|affiche|requis), alertes {dlcJours, seuilMini, nonRentre, ecartInventaire}, fefo, etiquette {champs, format}, defauts {nature, temperature, urgent}, exempleEmplacement, avertissement }`.
  - Personnalisation : `schemaConfigProfil` / `schemaProfilsConfig` (zod strict, `version: 1`, `actifs`, `profils`) ; **seules les différences avec le catalogue sont enregistrées** (`differencesProfil`) ; `resoudreProfil(cle, config)` fusionne ; `lireProfilsConfig` ne lève jamais d'exception.
  - Base : `stock_parametres.profils_config jsonb not null default '{}'` avec `check` de forme (objet, ≤ 30 000 caractères, `version = 1`, `actifs` tableau, `profils` objet) ; `stock_unites.profil` avec `check` sur les 7 clés ; `stock_parametres.profils` reste limité aux 3 « familles » historiques (`messagerie`, `palettes`, `vrac`).
  - Avertissements : `AVERTISSEMENT_SANTE`, `AVERTISSEMENT_PHARMA`, `AVERTISSEMENT_ALIMENTAIRE`, `MENTION_SUIVI_LOGISTIQUE` (« GODAC ne garantit aucune conformité réglementaire »).
- **Document de référence côté architecture** : la branche `origin/architecture/godac-core-multisector` (`docs/architecture/godac-core-multisector.md`) pose le noyau commun + modules sectoriels, la règle « configuration = données, pas de branche permanente », la règle « une abstraction n'est créée que si elle sert deux cas réels », et « pas de données médicales sensibles dans le noyau générique ». Ce document s'y inscrit sans l'opposer : les profils d'activité sont la **couche de configuration** de ce noyau, et la section 2.8 relie les deux.
- **Page Notion « GODAC Core — version neutre pour tout type de livraison »** : son contenu (transmis par le fondateur, non relu directement dans Notion par l'auteur de ce document) est repris en section 2.8. Elle était marquée « REPORTÉ (23 oct.) » ; le fondateur relance le sujet.

---

## 1. Inventaire : ce qui est codé en dur pour « colis / messagerie »

Méthode : parcours de `app/`, `components/`, `lib/`, `supabase/migrations/`. Environ 3 262 occurrences de « colis / livré / arrêt » (insensible à la casse, hors tests) ; elles se concentrent dans `lib/colis/` (≈ 70 fichiers), `app/api/colis/` (26 fichiers), `components/tours`, `components/planning`, `components/suivi`, `components/marketing`, `lib/guides`, `lib/exploitation`. Le tableau donne, pour chaque module, **le codé en dur** (avec fichiers) et **ce qui devrait varier**.

### 1.1 Tournée colis et GO (préparation, exécution, clôture)

| Codé en dur aujourd'hui | Fichiers | Doit varier selon le profil |
|---|---|---|
| Statuts d'arrêt `pending / delivered / failed`, tournée `loading / in_progress / done` ; libellés « Livré », « Non livré », « Ramassé », « Déposé au relais », « Ramasse manquée » | `lib/colis/cloture.ts`, `lib/colis/livraison.ts` (`libelleFait`, `libelleStatut`) | Libellés (mission remise / non remise, prélevé / remis au laboratoire) ; statuts internes inchangés (clés stables) |
| Types d'arrêt : `livraison`, `ramasse`, `point_relais` (contrainte `delivery_stops_kind_check`) | `lib/colis/livraison.ts` (`TYPES_ARRET`), migrations `...170_colis_ramasses_qr`, `...174_points_relais` | Types de mission paramétrables : enlèvement de prélèvement, livraison de médicaments, repas, document urgent. Le « point relais » n'a de sens que pour la messagerie |
| Motifs d'échec : client absent, adresse introuvable, accès impossible, fermé, « colis refusé », rien à ramasser, relais complet | `lib/colis/cloture.ts` (`MOTIFS_ECHEC`) | Santé : « laboratoire fermé », « échantillon non prêt », « refus de réception » ; alimentaire : « rupture de chaîne du froid constatée », « refus à la réception » |
| Durée d'arrêt par défaut 3 min ; durée observée bornée 1 à 30 min | `lib/colis/estimation.ts` (`MINUTES_PER_ARRET = 3`), `lib/colis/fiche-client.ts` (`DUREE_SERVICE_MIN/MAX`) | Défaut par profil (prélèvement 5 à 10 min, palette avec quai 15 à 30 min, repas 2 min). La borne de 30 min doit monter pour les palettes |
| Cycle de vie : chargement, départ, scan, ordre optimisé, clôture ; une ou plusieurs tournées par jour | `lib/colis/fiche-du-jour.ts`, `lib/colis/tournee-globale.ts`, `components/tours/*` | Ordre d'enlèvement fixe (Santé), rendez-vous de quai (Palettes) |
| Vocabulaire à l'écran : « Ma tournée colis », « Clôturer la tournée colis », « Ajouter ou modifier des colis », menu « Tournées colis » | `lib/acces/catalogue.ts` (l. 122, 330, 452, 538), `components/tours/*`, `components/dashboard/*` | Dictionnaire (section 2.3) ; le menu est généré depuis le catalogue, donc un seul endroit à brancher |
| Glossaire « tournée » avec anciens libellés interdits, vérifié par test | `lib/guides/glossaire.ts`, `lib/acces/__tests__/glossaire.test.ts` | Le glossaire devient une vue du dictionnaire ; le test existant est le modèle du test de contrat (section 2.9) |
| Champs d'un arrêt : adresse, destinataire, téléphone, nombre de colis, poids (`POIDS_MAX_KG = 10 000`), créneau, notes | `lib/colis/poids.ts`, `lib/colis/creneau.ts`, `lib/colis/envoi-arret.ts`, `lib/colis/telephone.ts` | Champs affichés / obligatoires par profil : température, lot, urgent, référence de mission ; téléphone et nom du destinataire à **masquer** en Santé |
| Rapport de tournée IA, nombre d'arrêts de ramasse inscrit à la main | `lib/ocr/tour-report.ts`, `components/shared/TourReportPhotoCapture.tsx`, migration `...066_tour_report_extra_fields` | Optionnel selon profil |

### 1.2 Livraison et preuve de livraison

| Codé en dur | Fichiers | Doit varier |
|---|---|---|
| 7 lieux de remise avec exigences : main propre, QR code, boîte aux lettres (photo obligatoire), jardin (photo obligatoire), voisin, autre lieu sûr, point relais (nom + photo ou code) | `lib/colis/livraison.ts` (`LIEUX_LIVRAISON`, `refusPreuve`) ; colonnes `delivery_stops.delivered_place` (`check` sur 5 valeurs d'origine, élargi ensuite), `proof_photo_path`, `proof_code` (`CODE_QR_MAX = 500`) | Santé / médicaments : **remise à un professionnel nommé** (nom et qualité du réceptionnaire, jamais le patient), signature, code ou pièce, heure et position ; « boîte aux lettres » et « jardin » **interdits** ; alimentaire : relevé de température à la remise ; documents urgents : signature |
| Photo de livraison privée (bucket `delivery-proofs`, 5 Mo, JPEG/PNG/WebP), lue par lien signé | migration `...107_delivery_proof` | En Santé, la photo peut montrer des documents patient : option « photo de l'emballage seulement » ou photo désactivée |
| Conservation : téléphones, consignes et noms complets des destinataires effacés à 30 jours (nom réduit aux initiales) ; adresses, initiales et photos conservées 12 mois pour les contestations ; trace GPS 1 an | `lib/retention/purge.ts` (`parcelRecipients: 30`, `parcelRuns: 365`, `parcelTrack: 365`), `app/confidentialite/page.tsx` l. 237-243 | Durées par profil : une chaîne de responsabilité qui/quand/où peut exiger une conservation plus longue (**décision, voir Q4**) |
| Contestations « colis non reçu » | `lib/rattachement/contestation.ts`, `components/contestations/Contestations.tsx`, migration `...104_customer_disputes` | Vocabulaire (« réclamation de remise ») ; en Santé, circuit différent (écart de réception, pas litige client) |

### 1.3 Scanner, étiquettes, bordereaux

| Codé en dur | Fichiers | Doit varier |
|---|---|---|
| Formats lus : QR, Datamatrix, Code 128, Code 39, EAN-13, ITF, PDF417, Aztec ; formats indispensables Code 128 et Datamatrix | `lib/colis/scan.ts`, `components/colis/ParcelScanner.tsx` | Ajouter GS1-128 / SSCC (palettes) ; le scanner reste commun |
| Analyse du contenu scanné : reconnaissance d'adresse française par code postal à 5 chiffres + ville, téléphone, poids | `lib/colis/etiquette.ts` (`CP_VILLE`, `analyserCode(brut, pays)`) | Santé : **ne rien extraire** d'une étiquette (traiter le contenu comme une simple référence) ; le pays est déjà paramétré |
| Bordereau de tournée de transporteurs (DPD, GLS, Chronopost, Colissimo…), lecture IA page par page, compteur face au total imprimé, type d'arrêt déduit des codes de service (CR, PRE, RDV…) | `lib/colis/bordereau.ts` (764 lignes), `lib/ocr/bordereau.ts` (modèle `claude-sonnet-5`) | Propre à la messagerie : à masquer hors profil Colis ; remplacé par un « bon de mission » ou une import de liste (CSV) pour les autres profils |
| Lecture IA des étiquettes, des rapports, des réclamations | `lib/ocr/*`, quotas dans `lib/usage/quotas.ts` (« la lecture des étiquettes colis ») | Drapeau `ia.etiquettes` par profil ; **désactivé par défaut en Santé** |
| Import de listes, recherche d'adresse, annuaire de villages (« tournée-modèle + villages ») | `lib/colis/import.ts`, `lib/colis/listes.ts`, `lib/colis/villages*.ts`, `lib/colis/fiche-client*.ts` | « Villages » est un concept messagerie rurale ; les autres profils parlent de sites (laboratoire, pharmacie, établissement) |
| Étiquettes imprimées du Stock | branche Stock : `lib/stock/etiquettes*.ts`, `formats-etiquette.ts` | Déjà par profil (`etiquette.champs`, `format`) : à généraliser aux étiquettes de mission |

### 1.4 Optimisation et estimation

| Codé en dur | Fichiers | Doit varier |
|---|---|---|
| Heuristique du voyageur de commerce (plus proche voisin + 2-opt + Or-opt), facteur routier 1,3, matrice OSRM | `lib/colis/optimisation.ts`, `lib/colis/matrice.ts` | **Constat : ni fenêtre horaire dure, ni priorité urgente, ni ordre imposé dans le moteur** (aucune occurrence de fenêtre/priorité dans ces deux fichiers) |
| Fenêtres d'ouverture utilisées seulement pour *estimer l'attente* et le retard, pas comme contrainte de l'ordre | `lib/colis/estimation.ts` (`attentesOuverture`), `lib/colis/horaires.ts`, `lib/colis/creneau.ts` (créneau ponctuel `window_start/window_end`) | Santé : créneau strict, priorité urgente, ordre d'enlèvement fixe, durée de transport maximale ; alimentaire : délai maximal ; palettes : rendez-vous de quai |
| Vitesse 35 km/h, 3 min par arrêt, rythme observé dès 3 arrêts | `lib/colis/estimation.ts` | Paramètres de planification par profil (utilitaire, poids lourd, vélo cargo) |
| Navigation GO Navigation, ETA, limitation de vitesse | `lib/go-navigation/*`, `lib/colis/eta.ts`, `lib/colis/limitation-vitesse.ts` | Commun (peu de variation) ; le produit « GO Navigation » est lui-même un positionnement commercial (`organizations.offre = 'go_navigation'`) |

### 1.5 Planning, RH, paie

| Codé en dur | Fichiers | Doit varier |
|---|---|---|
| Planning de **tournées** : `planning_entries` impose `service_id` et `tour_number`, chauffeurs et véhicules ; affectations, modèles de tournées, villages | migration `...027_tour_reports`, `lib/planning/*`, `components/planning/*` (6 fichiers parlent de colis) | Planning de missions (créneaux, astreintes) pour Core ; l'audit Core note déjà que ce n'est pas un planning universel |
| Pôles : `exploitation, direction, administratif, secretariat, comptabilite, rh, atelier, commercial, qualite` | `lib/organization/poles.ts` (contrainte `services.pole`) | Neutre : réutilisable tel quel |
| Paie transport (TRM), moteur FR uniquement, paliers livreur, temps de conduite RTE (CE 561/2006) | `lib/paie/*`, `lib/pays/pays.ts` (`tempsConduite`, `paie.moteur`), `lib/organization/paliers.ts` (`MODULES_PAR_PALIER = ["route_optimizer"]`) | Paie et chronotachygraphe = jeu de modules (absent pour Core) ; les règles par pays existent déjà |
| Pointage, auto-pointage, sortie du dépôt | `lib/time-clock/*` (`tournees-chauffeur.ts`, `sortie-depot.ts`) | Commun ; vocabulaire « tournée » |

### 1.6 Flotte, véhicules, carburant, TICPE

| Codé en dur | Fichiers | Doit varier |
|---|---|---|
| `vehicle_type` = `VL`, `PL`, `SPL` ; `tank_capacity_liters` ; `fuel_type` = `diesel`, `adblue` | `supabase/migrations/20260101000001_extensions_and_enums.sql`, `...0002_core_tables.sql` | Attributs de véhicule absents : frigorifique / plage de température, charge utile, volume, hayon, équipements (kit UN3373, caisse isotherme), capacités en palettes. **Pas d'enum à étendre** : une colonne `jsonb` d'« aptitudes » validée par zod (section 2.6) |
| Types de documents véhicule : carte grise, assurance, contrôle technique, licence, carte conducteur, location | `lib/vehicles/document-types.ts` | Santé : attestation ATP / étalonnage, formation conducteur, assurance spécifique (liste par profil, tolérante : l'actuelle reste valable) |
| Échéances J-30, J-7, J0 | `lib/alerts/echeances.ts` (`PALIERS_ECHEANCE`) | Paliers paramétrables (par exemple étalonnage de sonde annuel) |
| Carburant, cuves, TICPE, OCR de tickets | `lib/fuel/*`, `lib/ticpe/*`, `app/api/fuel-entries`, `app/api/ticpe` | Appartient au positionnement GODAC (transporteurs) ; **absent du jeu de modules Core** (Q2) |
| Fiche véhicule IA (specs) | `lib/vehicles/ai-specs.ts`, `lib/ocr/carte-grise.ts` | Commun |

### 1.7 Exploitation, suivi, alertes, notifications

| Codé en dur | Fichiers | Doit varier |
|---|---|---|
| Retards : seuils 15 min (à surveiller), 30 min (en retard), 10 min sans GPS (hors ligne) | `lib/exploitation/retards.ts` (`SEUIL_*`) | Seuils par profil : urgent 5 min ; palettes 60 min ; texte « tournées colis en cours » |
| Surveillance (tournées non démarrées, sans chauffeur) | `lib/exploitation/surveillance*.ts`, migration `...20261106000001` | Commun, seuils paramétrables |
| « Clôture » de tournée et « à traiter aujourd'hui » | `lib/exploitation/cloture*.ts`, `lib/a-traiter/*` | Libellés |
| Types d'alerte : enum Postgres `alert_type` (≈ 45 valeurs, ajouts additifs, policies RLS `alerts` redéclarées à chaque ajout, dernier état `20261111000006`) | `supabase/migrations/*alert*`, `lib/alerts/destinataires.ts`, `lib/alerts/resolve-url.ts` | Règles d'alerte paramétrables (seuil, destinataires, activation) **sans créer une valeur d'enum par règle** : voir section 2.5 |
| Alertes Stock (`stock_seuil`, `stock_ecart`, `stock_non_rentre`, DLC) | branche Stock | Déjà par profil : à intégrer au registre central |
| Notifications push et e-mail | `lib/push/*`, `lib/email/*`, table `notifications` (`...099`) | Libellés des modèles de message |

### 1.8 Rapports, exports, documents PDF

| Codé en dur | Fichiers | Doit varier |
|---|---|---|
| Export des tournées : en-têtes « Arrêts, Livrés, Non livrés, Colis », libellés « Historique des tournées colis », nom de fichier `tournees-colis-AAAA-MM-JJ`, statut « En livraison » | `lib/exploitation/export.ts` (`ENTETE_EXPORT`, `LIBELLE_TYPE_EXPORT`, `STATUTS_EXPORT`, `nomFichier`), `lib/exploitation/export-pdf.tsx`, `export-serveur.ts` | En-têtes, noms de fichier et colonnes selon le profil (température relevée, lot, heure de remise, réceptionnaire) ; **les identifiants techniques de colonnes restent stables** |
| Historique et rapports | `components/historique/VueRapports.tsx`, `components/reports/ReportsTable.tsx`, `app/api/reports` | Libellés, colonnes |
| Feuille de route / feuille à repartir (impression) | `lib/colis/feuille.ts`, `components/planning/FeuilleRepartir.tsx` | Titre, colonnes, mentions (chaîne de responsabilité) |
| PDF techniques (TICPE, paie, registres, bon de commande) | `lib/ticpe/generate-pdf.tsx`, `lib/paie/pdf*.tsx`, `app/bon-de-commande` | Indépendants du profil (hors périmètre) |
| Export Stock CSV / Excel | `lib/stock/export-excel.ts` | Déjà par profil dans la branche |

### 1.9 Assistant, guides, onboarding, vitrine, juridique

| Codé en dur | Fichiers | Doit varier |
|---|---|---|
| Assistant : « logiciel de gestion de flotte et de carburant pour les entreprises françaises de transport routier » ; FAQ idem | `lib/assistant/system-prompt.ts` l. 9, `lib/assistant/faq.ts` l. 46, `lib/assistant/help-content.ts`, `content/help` | Le prompt reçoit le profil (secteur, vocabulaire, jeu de modules) ; interdiction explicite de traiter des données de santé |
| Guides par rôle (« Ma tournée colis », « Valider une livraison », DPD/GLS/Colissimo…) | `lib/guides/roles.ts`, `lib/guides/premiers-pas.ts`, `lib/guides/glossaire.ts` | Guides générés depuis le dictionnaire ; blocs entiers par profil |
| Onboarding : plan, modules, création d'organisation (pôles standard) | `components/onboarding/*`, `app/onboarding/page.tsx`, `app/api/onboarding/*` | Nouvelle étape « votre activité » (choix du profil, jeu de modules) ; aucun choix = profil colis |
| Vitrine et pages commerciales | `components/marketing/*` (≈ 10 fichiers citent les colis : `SectionsAccueil`, `ModulesProfondeur`, `IllustrationsModules`, `HeroScene3D`, `MaquetteGoNavigation`…), `app/modules/page.tsx`, `lib/site.ts`, `app/manifest.ts` | Pages sectorielles ; métadonnées ; **fiches stores** (`mobile/`, GODAC Livreur) |
| Textes juridiques : CGU (« tournées colis »), CGV (module « Tournée colis », 30 jours d'essai), confidentialité (position GPS, destinataires, Stock), DPA (catégories de données : destinataires des colis, photos) | `app/cgu/page.tsx`, `app/cgv/page.tsx`, `app/confidentialite/page.tsx`, `app/dpa/page.tsx`, `lib/legal/*` | Mentions par profil (Santé : pas de donnée de santé, référence de mission seulement) ; **à relire par un juriste avant ouverture** |
| Catalogue des modules et tarifs : clé `route_optimizer` « Tournée colis », `stock` « Stock (palettes, colis, références) » ; paliers facturés par utilisateurs | `lib/acces/catalogue.ts` l. 122-125, `lib/organization/catalog.ts`, `lib/organization/paliers.ts`, migrations `...015`, `...116` | Jeux de modules et grille propres à Core (Q3) |
| Démo | `lib/demo/*`, migration `...098_demo_organization` | Données de démonstration par profil |

### 1.10 Stock

Déjà en cours par profil dans la branche `feat/stock-codes-etiquettes` (voir section 0). Restent codés en dur à la source (`origin/main`) : `docs/module-stock.md` (3 profils), l'intégration tolérante avec les tournées `lib/stock/integration-tournee.ts` (qui suppose `delivery_stops.parcel_code`), les libellés de `lib/stock/erreurs.ts` et `mouvements.ts`.

---

## 2. Architecture cible

### 2.0 GO, socle commun de tous les profils et des deux offres

**Principe.** « Tous les types de transports ont besoin de GO » (fondateur). GO = la liste de points du jour, l'optimisation, la navigation, la preuve de remise, le fonctionnement hors réseau et le scan. Il est le **socle** : le profil le *configure*, il ne le *conditionne* pas. Il n'existe pas de « profil sans GO ». Les modules d'un profil (Stock, carburant, flotte, paie, planning) s'ajoutent autour de GO.

**Constat sur le code (dépendances actuelles de GO).** L'offre d'essai « GO Navigation » existe déjà comme sous-ensemble autonome (`lib/go-navigation/offre.ts` : modules `route_optimizer`, `mobile_app`, `alerts`, `auth_onboarding`, organisation avec `offre = 'go_navigation'`, écrans limités par `ECRANS_GO_NAVIGATION`, marqueur `MARQUEUR_GO_NAVIGATION` dans `lib/acces/catalogue.ts`). Ce montage montre que GO tourne sans carburant ni paie. Il reste des couplages à traiter pour une offre « GODAC Core » avec GO seul :

| Couplage constaté | Où | Effet pour « GO seul » | Découplage proposé |
|---|---|---|---|
| Clé de module `route_optimizer` libellée « Tournée colis » : toutes les routes `app/api/colis/**` exigent `garderApi({ modules: ["route_optimizer"] })` | `lib/acces/catalogue.ts` l. 122, `app/api/colis/*` | GO est vendu sous un nom de module « colis » ; facturation par palier d'utilisateurs (`MODULES_PAR_PALIER = ["route_optimizer"]`) | **Ne pas renommer la clé** (stabilité) : changer son libellé via le dictionnaire (« GO : tournée ») ; la clé reste un identifiant technique |
| Lecture du planning pour retrouver véhicule et service du jour : `planning_entries`, `tour_routes`, `tour_route_villages`, fusions de fiches | `lib/colis/serveur.ts` l. 91-124 (`planningDuJour`, déjà tolérant : `.catch` donne véhicule et service nuls), `lib/colis/fiche-du-jour.ts`, `fusion-fiches.ts`, `villages-serveur.ts` (importent `lib/planning/*`), `app/api/colis/tournees/[id]`, `app/api/colis/lancement` (`refusDemarrageFiche`, `lib/planning/ouverture-serveur.ts`), `app/api/colis/affectations` | Sans module planning, la fiche du jour doit exister **sans affectation** (le conducteur ouvre sa liste, ou le responsable la lui crée) | Interface `SourceAffectation` (planning ou « aucune ») ; sans planning, `refusDemarrageFiche` est sans objet ; tests « GO sans planning » |
| Départ/retour du véhicule : kilométrage, photos, changement de véhicule | `components/tours/StartTourFlow.tsx`, `EndTourFlow.tsx`, `lib/tours/changement-vehicule.ts`, migration `...040_tour_vehicle_state` | Dépend de la flotte et du relevé kilométrique ; inutile pour un coursier à vélo ou à pied | Étape « véhicule » **facultative** selon le profil et le module flotte (`fonctionnalites.vehicule`) |
| Pointage (badge, sortie du dépôt) lié à la tournée | `lib/time-clock/tournees-chauffeur.ts`, `sortie-depot.ts` | Le pointage est du module RH, pas de GO | Aucun appel au pointage si le module `time_clock` est absent |
| Quotas d'usage et facturation à la dépense (lecture d'étiquette, optimisation) | `lib/usage/quotas.ts` (`ocr_label`, `route_optimization`), `PLAFONDS_ESSAI` | Indépendants de la paie ; libellés (« étiquettes colis ») en dur | Libellés par dictionnaire ; plafonds par palier GO |
| Tableaux de bord, contestations, rattachement des amendes, Stock | `components/dashboard/*`, `lib/rattachement/*`, `lib/stock/integration-tournee.ts` | Liens facultatifs (le Stock est déjà tolérant : try/catch, module absent = rien ne change) | Règle conservée : **aucune écriture bloquante vers un module non actif** |
| Paie / carburant | `lib/paie/*`, `lib/fuel/*`, `lib/ticpe/*` | Aucun import depuis `lib/colis`, `components/colis`, `components/tours`, `app/livreur`, `app/api/colis` (vérifié par recherche d'imports) : GO ne dépend ni de la paie ni du carburant | À verrouiller par un **test d'architecture** (voir ci-dessous) |

**Test d'architecture proposé.** Un test lit les imports de `lib/colis/**`, `components/colis/**`, `components/tours/**`, `app/livreur/**`, `app/api/colis/**` et échoue si l'un importe `lib/paie`, `lib/payslips`, `lib/fuel`, `lib/ticpe` ou `lib/vehicles/consumption` ; un second recense les imports de `lib/planning/*` (dette connue, cliquet à la baisse jusqu'à zéro).

**GO entièrement profil-aware (phase 1 du plan).** Tout ce que le conducteur voit ou fait passe par le profil :

| Fonction de GO | Ce que le profil règle |
|---|---|
| Vocabulaire | mission / colis / palette / poche / échantillon / repas ; verbes de clôture (remis, prélevé, enlevé) ; motifs d'échec |
| Liste de points | champs affichés et **obligatoires à l'arrêt** (température, référence de mission, lot…) ; champs masqués (téléphone, nom du destinataire en Santé) |
| Optimisation | **ordre d'enlèvement fixe**, **urgence**, **créneaux stricts**, durée de transport maximale, durée d'arrêt par défaut (section 2.4) |
| Navigation | commune ; avertissement quand un créneau est compromis |
| Preuve de remise | modes autorisés et exigés par profil : signature, photo, pièce ou code, relevé de température, **remise nominative à un professionnel sans donnée de santé** (section 2.7) |
| Scan | formats (GS1-128/SSCC pour les palettes) ; le contenu scanné est une référence (aucune extraction en Santé) ; lecture IA coupée ou non |
| Alertes au conducteur | urgence, créneau, température hors plage (section 2.5) |
| Hors réseau | mêmes règles sans connexion (section 2.9, « Hors réseau ») |

**Articulation avec GO gratuit / GO Premium et le module gratuit chauffeurs.** La page Notion « GO Free & GO Premium » n'a pas pu être relue directement par l'auteur de ce document ; ce qui suit vient du code, des CGV et de la consigne du fondateur, et **est à confirmer sur la page**.

- Constat dans le code : l'application est « gratuite pour le chauffeur et facturée au Client par palier d'utilisateurs » (`app/cgv/page.tsx` l. 92-93 ; grille `module_user_tiers`, `lib/organization/paliers.ts`, migrations `...116`, `...118`, `...119`) ; un essai de 30 jours sur invitation (`DUREE_ESSAI_JOURS = 30`) avec plafonds mensuels (3 000 lectures d'étiquettes, 300 optimisations : `PLAFONDS_ESSAI`) ; les fonctions payantes à la dépense sont déjà mesurées (`lib/usage/quotas.ts`).
- **Règle proposée : le profil n'est pas un palier.** Le profil règle le *métier*, le palier règle le *niveau de service* ; les deux sont indépendants. Toute entreprise, même sur l'offre gratuite, choisit son profil et obtient vocabulaire, champs, preuve de base et alertes de base : c'est ce qui rend GO utilisable pour son métier.
- Ce qui peut dépendre du palier (plafonds et options **coûteuses**, pas les règles de métier) : lectures IA d'étiquettes ou de bordereaux, nombre d'optimisations, durée d'historique et exports, tracés GPS conservés, modes de preuve avancés (signature, pièce, relevé de température), journal de chaîne de responsabilité, plafonds de missions.
- Ce qui ne doit **pas** être réservé au palier payant : l'**avertissement légal** du profil, l'interdiction de saisir une donnée de santé, la validation locale des champs obligatoires et le fonctionnement hors réseau de base.
- Mise en œuvre : une table `palier → capacités` (`gratuit`, `premium`) consultée avec les `fonctionnalites` du profil ; si le palier ne permet pas une fonction, l'écran la montre grisée avec la raison. Le **module gratuit chauffeurs** choisit son profil à l'inscription (ou « personnalisé ») avec les plafonds du palier gratuit. Changer de palier **ne modifie jamais les données ni les clés**.
- Décisions associées : Q3 (tarification) et Q8 (périmètre « GO seul »).

### 2.1 Principes

1. **Le profil est une donnée, pas une branche** (règle de l'audit Core). Aucun `if (profil === "sante")` dispersé : les écrans demandent une *capacité* (`profil.champs.temperature`, `profil.preuve.modes`) ou un *mot* (`t("element.un")`).
2. **Clés stables, libellés variables.** Les statuts, colonnes, routes et clés d'export restent ceux d'aujourd'hui (`delivered`, `parcel_code`, `delivery_stops`) ; seul l'affichage change. Aucune migration de renommage.
3. **Repli systématique sur « colis »** : toute clé absente du dictionnaire d'un profil prend la valeur du profil colis ; toute configuration invalide produit le profil colis (jamais d'exception, comme `lireProfilsConfig`).
4. **Le Stock est un sous-ensemble**, pas un second système.
5. **Pas de logique réglementaire** dans le profil : il décrit des champs, des seuils et des preuves *paramétrables*. La conformité reste à la charge de l'entreprise.

### 2.2 Modèle de profil (généralisation du `Profil` du Stock)

Un profil central contient des **sections**. La section `stock` est exactement le `Profil` actuel (champs, alertes d'unités, étiquette, FEFO) ; les autres sections sont nouvelles.

```ts
// Squelette documentaire (non implémenté) — lib/profils/types.ts
type CleProfil = "messagerie" | "palettes" | "sante" | "pharmacie" | "alimentaire" | "vrac" | "personnalise";
type ModeChamp = "masque" | "affiche" | "requis";
type Genre = "m" | "f";

interface ProfilActivite {
  cle: CleProfil;
  version: 1;
  libelle: string;                      // « Santé : prélèvements et produits biologiques »
  vocabulaire: { couche: "colis" | "neutre" | "sante" | "..."; remplacements: Record<CleVocab, EntreeVocab> };
  fonctionnalites: Record<CleFonction, boolean>;  // ramasse, point_relais, bordereau_ia, ocr_etiquettes, carte_villages…
  champs: Record<ChampMission, ModeChamp>;        // téléphone, nom destinataire, température, lot, urgent, référence…
  typesMission: TypeMission[];                    // livraison, ramasse, point_relais | prelevement, remise_medicament…
  motifsEchec: { cle: string; libelle: string }[];
  preuve: ExigencePreuve;               // voir 2.7
  alertes: RegleAlerte[];               // voir 2.5
  planification: ContraintesPlanification;         // voir 2.4
  documents: { exports: ModeleExport; feuille: ModeleDocument; etiquette: ModeleEtiquette };
  defauts: { dureeArretMin: number; nature?: string; temperature?: string; urgent: boolean; ... };
  conservation: { destinatairesJours: number; preuvesJours: number; traceGpsJours: number };
  ia: { etiquettes: boolean; bordereaux: boolean; rapports: boolean };
  vehicule: { aptitudesRequises: string[]; documentsAttendus: string[] };
  avertissement: string | null;         // reprend AVERTISSEMENT_* du Stock
  stock: ProfilStock;                   // = Profil actuel de lib/stock/profils.ts
}
```

Catalogue prédéfini en code (`DEFINITION_PROFILS`, comme aujourd'hui) + **ajustements de l'entreprise** : seules les différences sont stockées (`differencesProfil`), fusionnées par `resoudreProfil`. Les 7 profils : section 4.

### 2.3 Dictionnaire de vocabulaire

- **Clés sémantiques** (pas de texte comme clé) : `element` (colis), `point_remise` (arrêt), `mission` (tournée colis / arrêt), `action.remis` (livré), `action.non_remis`, `action.enleve` (ramassé), `destinataire`, `expediteur`, `tournee`, `depart`, `retour`, `preuve`, `etiquette`, `bordereau`…
- **Chaque entrée porte ses accords** : `{ un, plusieurs, genre, participe: { m, f, mp, fp } }`. Raison : en français, « colis » (masculin, invariable) devient « échantillon » (masculin), « palette » (féminin), « prélèvement » (masculin), « mission » (féminine) ; « Livré » devient « Remise effectuée » ou « Prélevé ». Un simple remplacement de mots produirait des fautes d'accord. Fonction `t(cle, { n, casse })` côté serveur et client.
- **Trois couches empilées**, la dernière gagne : (1) *couche de base* « colis » (aujourd'hui) ; (2) *couche du profil* (sante : échantillon, prélèvement, laboratoire) ; (3) *couche neutre GODAC Core* (« mission », « point de remise », « élément transporté ») utilisable seule ou sous un profil ; (4) *surcharges de l'entreprise* (comme `vocabulaire { un, plusieurs }` du Stock, plafonné à 30 caractères).
- Le **glossaire « tournée »** (`lib/guides/glossaire.ts`) devient la vue documentaire du dictionnaire.
- **Pays** : les libellés sont en français ; l'i18n par pays existante (`lib/pays/pays.ts` : loi, autorité, temps de conduite, paie, identifiants) reste une dimension séparée. Le profil ne duplique rien : les règles qui dépendent du pays (SIRET/NIF, réglementation transport de matières dangereuses, géocodage) lisent `paysOrganisation()` ; un profil peut déclarer une exigence *conditionnelle au pays* (`pays: ["FR"]`) pour ne pas afficher une mention française en Belgique.

### 2.4 Contraintes d'optimisation

Nouvelle section `planification`, lue par `lib/colis/optimisation.ts` (aujourd'hui sans aucune de ces notions) :

| Paramètre | Colis (défaut actuel) | Exemples d'autres profils |
|---|---|---|
| `fenetre` | souple (estimation d'attente seulement) | **dure** (Santé : le créneau doit être tenu ou l'écart est alerté) |
| `priorite` | aucune | `urgent` passe avant (Santé, documents urgents) |
| `ordreFixe` | non | oui (enlèvements dans un ordre imposé) |
| `dureeTransportMaxMin` | aucune | Santé, repas (délai maximal entre enlèvement et remise) |
| `temperature.dureeHorsPlageMaxMin` | aucune | alimentaire, médicaments |
| `dureeArretMin` | 3 | selon profil |
| `vitesseKmH` | 35 | selon véhicule |
| `capacite` | aucune | poids, volume, nombre de palettes (véhicule) |
| `compatibilite` | aucune | un véhicule « frigorifique » seulement pour les missions « froid » |

Principe de livraison : d'abord les **paramètres lus et affichés** (alerte si un créneau dur est compromis, calculée par `estimation.ts`), ensuite la contrainte dans l'heuristique (insertion respectant fenêtres et priorités). Le moteur actuel reste inchangé tant que `planification` vaut les défauts colis (test de non-régression sur l'ordre produit).

### 2.5 Règles d'alerte paramétrables

- Aujourd'hui : enum `alert_type` (≈ 45 valeurs) ; chaque nouvelle règle exige une migration d'enum **isolée** (une valeur d'enum ne s'utilise pas dans la transaction qui l'ajoute) puis la redéclaration de **toutes** les policies RLS de `alerts` en conservant tous les types (pratique du Stock : migrations `...003` + `...004`). Ce coût ne doit pas être multiplié par profil.
- Cible : **peu de types génériques** (ajoutés une fois : `mission_urgente`, `chaine_du_froid`, `remise_non_confirmee`, `regle_profil`) + un champ `payload`/clé de règle (`regle: "temperature_hors_plage"`) pour distinguer les règles, avec `cle_dedoublonnage` existante. Les types historiques (`tournee_retard`, `echeance_vehicule`, `stock_*`) restent tels quels.
- `RegleAlerte` = `{ cle, active, seuil?, unite?, roles destinataires, perimetre (service/organisation), message (clé de dictionnaire) }`. Les défauts reprennent les constantes actuelles : retard 15/30/10 min (`lib/exploitation/retards.ts`), échéances J-30/J-7/J0 (`lib/alerts/echeances.ts`), DLC à J-n (Stock).
- Règles de profil à prévoir : urgence non prise en charge en N min ; remise non confirmée à T+N ; température hors plage ou relevé manquant ; durée de transport dépassée ; DLC proche ; écart d'inventaire ; sonde/étalonnage à renouveler.
- Destinataires : `lib/alerts/destinataires.ts` reste le seul endroit qui décide des rôles ; le profil fournit des *propositions* de rôles, pas de contournement des droits.

### 2.6 Véhicules : aptitudes, pas profil

Un véhicule n'« a » pas de profil : il porte des **aptitudes** (frigorifique avec plage, volume, charge utile, hayon, nombre d'emplacements palette, équipements) validées par zod dans une colonne `jsonb` additive (`vehicles.aptitudes`, défaut `'{}'`), avec `check` de forme comme `profils_config`. Le profil de la mission dit ce qui est *requis* ; l'affectation (planning) compare. Les enums `vehicle_type` (`VL/PL/SPL`) ne sont pas touchés.

### 2.7 Exigences de preuve de remise

Généralisation de `LIEUX_LIVRAISON` / `refusPreuve` (`lib/colis/livraison.ts`) : le profil déclare une liste de **modes de remise** autorisés avec, pour chacun, ses exigences.

```ts
interface ModeRemise { cle: string; libelle: string; photo: "non"|"conseillee"|"requise"; code: boolean; signature: boolean;
  reception: "aucune"|"nom_qualite"; position: boolean; releveTemperature: boolean; }
```

- Colis : les 7 modes actuels, **identiques** (même `refusPreuve`, mêmes messages).
- Santé / médicaments : modes « remise à un professionnel » (nom et qualité du réceptionnaire, signature ou code, position, heure) ; modes sans réceptionnaire (boîte aux lettres, jardin, voisin) **absents**.
- **Chaîne de responsabilité qui / quand / où** : chaque transfert enregistre l'agent GODAC (qui), l'horodatage serveur (quand), la position et le site (où), et le réceptionnaire professionnel. Journal immuable sur le modèle de `stock_mouvements` (écriture par fonction `security definer`, aucune mise à jour, droits retirés).
- **Jamais de donnée de santé** : le « nominatif » désigne le *réceptionnaire professionnel* (la personne du laboratoire ou de la pharmacie qui signe), jamais le patient ni le donneur. La mission porte une **référence** (code de mission ou numéro de bon de l'entreprise), aucun champ de contenu médical, diagnostic ou identité de patient. Les champs libres (notes, consigne) affichent `AVERTISSEMENT_DONNEES_SANTE` ; la lecture IA des photos est coupée (section 1.3).
- Données au repos : colonnes additives sur `delivery_stops` (par exemple `remise_mode`, `receptionnaire_nom`, `receptionnaire_qualite`, `temperature_remise`, `signature_path`) ; `delivered_place` et son `check` historique ne sont pas touchés pour le profil colis.

### 2.8 GODAC et GODAC Core : un profil, un vocabulaire, un jeu de modules

La mécanique se lit sur **trois axes indépendants**, ce qui permet aux deux positionnements de partager la **même application chauffeur GO** :

| Axe | Rôle | Exemples |
|---|---|---|
| **Profil d'activité** | règles de métier : champs, alertes, preuve, planification | Colis, Santé, Médicaments, Alimentaire… |
| **Couche de vocabulaire** | les mots à l'écran | « colis / arrêt / livré » ou « élément transporté / point de remise / mission » ou mots du profil |
| **Jeu de modules** | ce qui est activé (`organization_modules`, existant) | GODAC (carburant/TICPE, flotte, planning, paie) ; GODAC Core (missions, GO, preuve, alertes, planning simple, sans carburant ni paie) |

- **GODAC** (transporteurs) : vocabulaire « colis » (ou palette…), jeu de modules complet.
- **GODAC Core** (laboratoires, pharmacies, cliniques, traiteurs, coursiers) : vocabulaire neutre **ou** du profil, offre plus simple, modules activables, **version sans carburant ni paie** possible (Q2). Les modules carburant, TICPE, paie existent déjà comme modules activables (`organization_modules`, `lib/organization/modules.ts`) : la « version sans » est un *jeu de modules par défaut* et un onboarding qui ne les propose pas, pas un fork.
- **Types de missions paramétrables** (repris de la page Notion) :
  - *Sang / prélèvements* : créneaux stricts, priorité urgente, température et durée de transport, preuve de remise nominative (réceptionnaire professionnel), ordre d'enlèvement fixe, chaîne de responsabilité qui / quand / où.
  - *Médicaments* : traçabilité, preuve de remise avec pièce ou code, confidentialité, chaîne du froid.
  - *Repas* : délai maximal, chaud / froid, multi-points.
  - *Urgent / documents* : créneau court, signature.
  Ils correspondent à `typesMission` + `preuve` + `planification` du profil ; il n'y a pas de code propre à chaque type.
- **Lien avec le noyau** (`docs/architecture/godac-core-multisector.md`, branche `architecture/godac-core-multisector`) : le profil est la couche de *configuration* du noyau « opération générique » ; la mission générique du noyau et `delivery_stops` coexistent (l'audit interdit de remplacer en place). Règle commune : une abstraction n'est créée que si elle sert deux cas réels ; ici, colis et prélèvements sont les deux premiers.
- **Modèle de données du noyau et profils** : décision à prendre ensemble (Q1) pour ne pas construire deux « missions ».

### 2.9 Où vit le profil : structure de données et résolution

**Table centrale (nouvelle, additive)** `organisation_profils` (une ligne par organisation) :

| Colonne | Type | Rôle |
|---|---|---|
| `organization_id` | uuid PK, FK `organizations` `on delete cascade` | |
| `profil_principal` | text `check in (7 clés)` | profil par défaut |
| `actifs` | text[] `check` sur les 7 clés | profils activés (le Stock en permet plusieurs) |
| `couche_vocabulaire` | text `check in ('profil','neutre','colis')` | défaut `'colis'` |
| `config` | jsonb `not null default '{}'` | différences avec le catalogue, `check` de forme identique à `profils_config` (objet, `version = 1`, taille ≤ 30 000 caractères) |
| `jeu_modules` | text `check` | `'transport'`, `'core'`… (indicatif ; l'activation réelle reste `organization_modules`) |
| `maj_par`, `maj_le` | uuid, timestamptz | audit |

- **Aucune ligne = profil colis** (compatibilité). Pas de `drop`, pas de `delete`, pas de mise à jour de masse.
- **RLS** : lecture pour tout membre de l'organisation (`current_organization_id()`), écriture pour la direction (et l'exploitation pour les ajustements non sensibles), comme `stock_parametres`. Écriture par API validée zod ; `check` en base pour la forme. Aucune référence inter-organisations possible.
- **Audit** : chaque changement passe par `journaliser()` (`lib/audit/journal.ts`, table `audit_log`) avec ancienne et nouvelle valeur ; l'activation d'un profil Santé est une action tracée.
- **Reprise du Stock** : `stock_parametres.profils_config` n'est ni supprimé ni vidé. Lecture à deux étages : `lireProfil(org)` lit d'abord `organisation_profils`, sinon retombe sur `stock_parametres.profils_config` (le Stock continue de fonctionner tel quel). Une fonction de copie unique (idempotente, sans suppression) peuple la table centrale ; après une période d'observation, le Stock ne lit plus que le central (décision ultérieure, toujours sans drop).
- **Multi-profils** : trois niveaux, du plus général au plus précis :
  1. **Entreprise** : `actifs` + `profil_principal` (comme le Stock).
  2. **Service** : `services.profil_cle` (colonne additive nullable, repli sur le principal). Un transporteur peut avoir un service « colis » et un service « santé » : c'est le niveau naturel, car le service porte déjà les droits, le dépôt (`services.depot_*`) et les managers.
  3. **Tournée / mission** : `delivery_runs.profil` et `delivery_stops.profil` en **instantané** (texte, nullable, défaut `null` = profil du service) écrit à la création ; ainsi l'historique ne change pas de sens quand le profil évolue (même idée que `stock_unites.profil`).
  Le **véhicule** n'a pas de profil (section 2.6). Recommandation : démarrer en niveaux 1 et 3 (entreprise + instantané), ajouter le niveau 2 en phase 2 (Q5).

**Résolution serveur** : `lireProfil(supabase, organizationId, contexte?: { serviceId?, profil? }): Promise<ProfilActivite>`, enveloppé dans `React.cache` (une lecture par requête), qui : lit la ligne ; valide (`schema.safeParse`) ; en cas d'échec retourne le profil colis ; fusionne catalogue + config. Aucune exception ne remonte. Les routes `app/api/**` sous `garderApi` appellent cette fonction ; les contrôles de champs obligatoires et de preuve se font **toujours côté serveur** (le client n'est qu'un confort), comme `refusPreuve` aujourd'hui partagé.

**Résolution client** : le layout du tableau de bord (`app/(dashboard)/layout`) charge le profil une fois et le passe à `<ProfilProvider value={profilSerialisable}>` ; hooks `useProfil()`, `useT()`. Le profil sérialisé est volontairement petit (vocabulaire résolu, champs, modes de remise, seuils utiles à l'écran). Le seul contexte React existant (`components/planning/AffectationElements.tsx`, `components/colis/Triable.tsx`) est local : c'est le premier contexte global de l'application. Les pages publiques (vitrine) n'utilisent pas le contexte : elles ont des textes par page sectorielle.

**Hors réseau (GO applique le profil sans connexion).** La file hors ligne existe (`lib/offline/outbox.ts` : IndexedDB `godac-offline-v1`, mutations et photos encodées, jamais rejouées sous un autre compte ; `rejeu.ts`, `verrou-onglets.ts`) et l'idempotence serveur aussi (`lib/offline/idempotence-serveur.ts` : en-tête `X-GODAC-Offline-Action`, table `offline_actions`, réponse « duplicate »). À ajouter :
1. **Profil en cache** : le profil résolu et sérialisé est stocké en IndexedDB avec sa `version` et sa date, rechargé à chaque ouverture réseau ; une tournée démarrée garde l'**instantané** de son profil (colonne `profil` sur `delivery_runs` / `delivery_stops`) : un changement de profil en cours de tournée ne s'applique qu'à la suivante.
2. **Validation locale** des champs obligatoires et de la preuve (`champsManquants`, `refusPreuve` : fonctions pures partagées, donc exécutables sur le téléphone) : le conducteur ne peut pas clore un point sans la preuve exigée, même hors réseau.
3. **Idempotence à la synchro** : chaque remise porte un identifiant d'action stable ; le serveur **revalide** avec le profil de l'instantané (jamais le profil courant) et répond « duplicate » si l'action est déjà passée ; un refus de validation à la synchro est montré au conducteur et à l'exploitation (aucune perte silencieuse).
4. **Horodatage** : la chaîne de responsabilité (qui / quand / où) garde l'heure de l'appareil *et* l'heure de réception par le serveur ; l'écart est visible.
5. **Données sensibles hors ligne** : une preuve nominative (réceptionnaire professionnel) n'est gardée dans la file que le temps de la synchro ; aucune donnée de santé n'existe de toute façon (référence de mission seulement).
6. **Profil en cache trop ancien** : GO continue avec lui et avertit ; il ne bloque jamais le travail du conducteur.

### 2.10 Compatibilité ascendante

- Aucune ligne `organisation_profils`, ou ligne invalide, ou clé de dictionnaire inconnue → profil colis implicite.
- Les tests existants (`lib/colis/__tests__/`, `lib/acces/__tests__/`, glossaire) passent **sans modification** ; en plus, un test d'instantané compare, pour une organisation sans profil, chaque libellé produit via le dictionnaire au libellé historique.
- Les exports gardent leur nom et leurs colonnes pour le profil colis (`tournees-colis-…`, `ENTETE_EXPORT`).
- Le Stock : tant que le central est vide, `profils_config` fait foi.

### 2.11 Tests de contrat

1. **Aucune chaîne en dur nouvelle** : un test (`lib/profils/__tests__/vocabulaire-horsdico.test.ts`) lit les fichiers d'une liste `ECRANS_MIGRES` et cherche, dans les littéraux de chaîne et le JSX, `/\b(colis|livr[ée]e?s?|arr[êe]ts?|ramass\w+|tournée colis)\b/i` hors dictionnaire. Modèle : `lib/acces/__tests__/glossaire.test.ts` (lit déjà `RACINE`, catalogue, menu, barre mobile).
2. **Cliquet** : un fichier `liste-autorisee.json` recense les occurrences restantes par fichier ; le test échoue si le compteur augmente ; la liste ne fait que baisser, et un fichier migré est retiré de la liste (donc interdit à jamais).
3. **Complétude du dictionnaire** : chaque profil définit les clés obligatoires ou retombe sur « colis » ; aucune clé orpheline ; accords (genre, pluriel) testés.
4. **Schéma** : config invalide → profil colis ; tout `check` SQL de forme relu par un test de migration (modèle : `lib/stock/__tests__/migrations-codes.test.ts`).
5. **Preuve** : table de vérité `refusPreuve` pour chaque profil ; pour le profil colis, les 7 cas actuels identiques.
6. **Migrations** : additives, idempotentes, aucun `drop table/column`, aucun `delete`/`update` de masse (test de relecture du SQL, déjà pratiqué par le Stock).
7. **Contrat d'accès** : toute nouvelle route derrière `garderApi`, listée dans un `audit-routes-*.test.ts`.
8. **Données de santé** : test qui vérifie qu'aucune colonne du schéma « mission/remise » n'a un nom évoquant patient, diagnostic ou identité (liste d'interdits) et que les libellés Santé n'emploient jamais « patient ».

---

## 3. Plan de livraison

Effort exprimé en **jours d'agent** (un jour = une session de travail d'un agent avec vérifications `tsc` + `vitest`, relue par un humain). Chaque phase est livrable seule, additive et désactivée par défaut.

### 3.1 Phases

| # | Phase | Contenu | Jours |
|---|---|---|---|
| 0 | **Socle central + migration du Stock** | `lib/profils/` (types, catalogue, zod, `lireProfil`, `ProfilProvider`, `useT`) ; migration `organisation_profils` + `check` + RLS + audit ; dictionnaire colis (historique) + test d'instantané ; le Stock lit le central avec repli sur `profils_config` ; test de contrat v1 (cliquet) | **4** |
| 1 | **GO profil-aware + preuve de livraison + découplage + hors réseau** (GO = socle commun, section 2.0) | `libelleFait/libelleStatut/MOTIFS_ECHEC/TYPES_ARRET` via dictionnaire ; champs affichés/obligatoires de l'arrêt ; `ModeRemise` généralisé (signature, photo, pièce ou code, température, remise à un professionnel) ; colonnes additives de remise ; masquage téléphone/nom ; flag IA ; écrans `components/tours/*`, `components/colis/*`, `app/livreur` ; **découplage** planning / véhicule / pointage + test d'architecture « GO sans paie ni carburant » ; **profil en cache, validation locale, idempotence à la synchro** ; ordre fixe, urgence et créneaux lus par l'optimisation (paramètres) | **9** |
| 2 | **Alertes, exports, documents** | règles d'alerte paramétrables (types génériques + migration enum isolée + policies redéclarées) ; retards/échéances/DLC/température ; en-têtes et noms d'export ; feuille de route ; paliers ; optimiseur : fenêtres dures, priorité, ordre fixe, durée max (paramètres puis contrainte) | **5** |
| 3 | **Flotte et exploitation** | `vehicles.aptitudes` ; comparaison mission/véhicule à l'affectation ; documents véhicule par profil ; suivi en direct, historique, tableau de bord ; profil par service (`services.profil_cle`) | **4** |
| 4 | **Onboarding, vitrine, guides, GODAC Core** | étape « votre activité » ; jeu de modules Core (GO seul + modules activables, sans carburant/paie) ; articulation GO gratuit / Premium (table palier → capacités) ; couche de vocabulaire neutre ; guides et glossaire générés ; assistant (prompt par profil) ; pages sectorielles ; textes CGU/CGV/confidentialité/DPA (relecture juridique) ; fiches stores | **5** |
| 5 | **Tests utilisateurs** | 2 pilotes (par exemple un coursier de laboratoire et un traiteur), parcours chronométrés, correction des libellés et accords, rétrospective ; réglage des défauts de chaque profil | **3** |
| | **Total** | | **30** |

Ordre conseillé : 0 → 1 → 2 → 3 → 4 → 5. **GO est profil-aware dès la phase 1** (le deuxième temps de l'ordre conseillé, juste après le socle) ; l'optimisation complète (contraintes dures) arrive en phase 2. Les phases 1 et 2 peuvent se chevaucher après le socle. La phase 4 (Core, vitrine) ne doit **pas** précéder la validation des questions Q1 à Q8.

### 3.2 Critères d'acceptation transverses
Organisation sans profil : aucune différence visible ni de données ; `npx tsc --noEmit` et `npx vitest run` verts ; aucune migration destructive ; chaque profil documenté avec son avertissement ; chaque écran migré sorti de la liste autorisée du test de contrat.

### 3.3 Risques

| Risque | Gravité | Parade |
|---|---|---|
| Régression sur le produit colis en production | haute | repli systématique, test d'instantané, migration par écran, drapeau par organisation |
| Accords de grammaire français faux (« palette livré ») | moyenne | entrées avec genre/participes, tests d'accords, relecture humaine |
| Optimiseur : fenêtres dures et priorités changent l'algorithme | haute | paramètres d'abord ; contrainte ensuite ; ordre identique pour les défauts colis |
| Conflit avec le travail en cours du Stock (branche non poussée, non commitée) | moyenne | coordonner avec l'agent Stock avant la phase 0 ; ne rien changer à sa branche ; reprise par lecture à deux étages |
| Enum `alert_type` : coût de chaque nouveau type | moyenne | types génériques + clé de règle |
| Données de santé saisies par erreur (champs libres, photos, étiquettes) | haute | avertissements, champs libres limités, IA des photos coupée en Santé, aucun champ patient, test de contrat, mention contractuelle |
| Promesse de conformité sanitaire implicite (vocabulaire « traçabilité », « chaîne du froid ») | haute | section 3.4 ; relecture juridique de la vitrine et des CGV |
| Deux « missions » concurrentes (noyau Core vs `delivery_stops`) | moyenne | Q1 ; on étend `delivery_stops` par colonnes additives, puis on adopte l'opération générique si elle sert deux cas |
| Explosion de la configuration (trop de réglages) | moyenne | catalogue sensé, « seules les différences sont enregistrées », profil « Personnalisé » réservé |
| Quotas et coûts IA, hébergeur | faible | flags `ia.*` par profil |
| Textes juridiques non à jour (RGPD, DPA catégories de données) | haute | relecture avant toute ouverture d'un profil santé |

### 3.4 Ce qu'il ne faut PAS promettre commercialement

- **Aucune conformité réglementaire** : GODAC fournit un **suivi logistique configurable**. Le respect des règles du secteur (santé, pharmacie, alimentaire) est **à la charge de l'entreprise**. Pas de mots « conforme », « certifié », « validé » ; pas de « pharmacovigilance », « dispositif médical », « HACCP » comme argument de conformité.
- **Aucune donnée de santé nominative** : GODAC ne conserve qu'une **référence de mission**, jamais de contenu médical, diagnostic ou identité de patient/donneur. Si ce principe devait changer : **hébergement certifié de données de santé et analyse d'impact (AIPD)** préalables ; ce n'est pas prévu.
- **Points réglementaires à porter tels quels, sans les trancher** (à la charge de l'entreprise ; à faire valider par un conseiller compétent avant toute offre) :
  - *Prélèvements biologiques* : catégorie B / **UN3373**, emballages, formation du conducteur, assurance, **conseiller ADR**.
  - *Distribution et transport de produits de santé* : **pharmacien responsable**, chaîne du froid.
  - *Données de santé* : ne conserver qu'une référence de mission ; hébergement certifié santé et AIPD si ce principe devait changer.
  - *Hygiène alimentaire* : exigences sanitaires de l'entreprise.
- Pas de promesse de chaîne du froid « garantie » : GODAC enregistre des relevés saisis ou importés, il ne certifie ni la sonde ni la mesure.
- Pas de promesse de disponibilité par secteur avant la fin des tests utilisateurs ; les profils sont décrits comme « modèles de départ ajustables ».
- Pas de promesse d'ouverture d'un secteur sans avoir validé la grille tarifaire (Q3).

### 3.5 Questions à trancher par le fondateur (8 maximum)

| # | Question | Recommandation |
|---|---|---|
| 1 | **Types de missions au lancement de GODAC Core** (page Notion) : lesquels ouvrir en premier (sang/prélèvements, médicaments, repas, urgent/documents) ? Et la « mission » du noyau remplace-t-elle `delivery_stops` ou l'étend-on ? | Lancer **un seul secteur pilote** : prélèvements de laboratoire (exigences les plus strictes, donc validation du modèle), puis médicaments ; repas et documents ensuite car ils n'ajoutent presque rien au modèle. **Étendre `delivery_stops` par colonnes additives** et n'adopter l'opération générique qu'au deuxième cas réel (règle de l'audit Core) |
| 2 | **Version sans carburant / paie** pour Core : oui ou non, et sous quelle forme ? | **Oui, comme jeu de modules par défaut** (pas un fork) : missions, GO, preuve, alertes, planning simple, flotte allégée ; carburant, TICPE, paie restent activables à la demande |
| 3 | **Tarification propre à Core** : grille distincte de GODAC ? | **Grille distincte et plus simple** (palier par utilisateurs GO, modules à la carte), pour ne pas comparer un traiteur à un transporteur ; décider **après** le pilote (phase 5), la fiche du Stock étant déjà « sans prix » |
| 4 | **Qui valide la conformité santé ?** (formulations de la vitrine, des CGV, durée de conservation de la chaîne de responsabilité) | Un **conseil externe** (juriste et personne compétente en transport de produits de santé) avant toute offre ; GODAC garde le rôle de **suivi logistique**. Conservation de la preuve : **12 mois par défaut, durée réglable**, à confirmer par ce conseil |
| 5 | **Granularité du profil** : entreprise seule, ou aussi par service ? | **Entreprise + instantané sur la tournée** dès la phase 0 ; **par service** en phase 3 (cas d'un transporteur colis qui ouvre un service santé) |
| 6 | **Marque et fiches stores** : « GODAC Core » comme marque visible, et une seule application GO sur les stores ou une fiche distincte ? | **Une seule application GO** (même code, un seul binaire), avec un **écran d'accueil et une fiche store qui parlent des deux usages** ; marque « GODAC Core » sur le site et les offres, pas de seconde application (double maintenance, double validation Apple/Google) |
| 7 | **Lecture IA des étiquettes et bordereaux** pour les profils santé : autorisée ou coupée ? | **Coupée par défaut en Santé** (photo envoyée à un sous-traitant, risque de donnée nominative) ; activable seulement après décision explicite et mise à jour du DPA |
| 8 | **Périmètre minimal « GO seul » par profil** : que contient l'offre GO sans autre module ? | Socle identique pour tous : liste de points, optimisation, navigation, scan, preuve de remise du profil, hors réseau, alertes conducteur, historique court. Par profil, seulement ce qui fait la valeur métier : **Santé** = urgence, créneaux stricts, ordre fixe, remise à un professionnel, température saisie ; **Médicaments** = remise contre signature ou code, température ; **Alimentaire** = relevés de température, délai max ; **Palettes** = SSCC, signature de quai ; **Colis** = comme GO Navigation aujourd'hui. Stock, flotte, carburant, paie, planning = hors « GO seul ». Le « Personnalisé » complet et le réglage fin ouvert aux clients viennent **après** les tests utilisateurs |

---

## 4. Annexe : tableau profil × module (ce qui change)

Légende : « = » identique au profil Colis (comportement actuel) ; « + » ajouté ; « – » masqué ou retiré. Les valeurs chiffrées sont des **défauts proposés**, ajustables ; elles ne sont pas des exigences réglementaires. Les profils Santé, Médicaments et Alimentaire portent systématiquement l'avertissement de la section 3.4.

| Module | Colis / messagerie | Palettes / fret | Santé (prélèvements, produits biologiques, dont sang) | Médicaments et pharmacie | Alimentaire frais / surgelé | Références en vrac | Personnalisé |
|---|---|---|---|---|---|---|---|
| **Vocabulaire** | colis, arrêt, livré, ramassé | palette, quai, remise | échantillon, prélèvement, laboratoire, remis au laboratoire | produit, officine, remise | produit, point de livraison, livré | article, référence, sortie | neutre : élément, point de remise, mission |
| **GO (socle commun, tous profils)** | liste de points, optimisation, navigation, scan, hors réseau = | + SSCC, signature de quai | + urgence, créneaux stricts, ordre fixe, remise à un professionnel, température | + signature/code, température | + relevés de température, délai max | = | selon choix |
| **Tournée / missions** | tournée colis, ramasse, point relais | rendez-vous de quai, enlèvement, livraison | enlèvements dans un **ordre fixe**, créneau strict, **urgent par défaut** | livraison de commande, tournée de remise | multi-points, délai maximal, chaud/froid | enlèvement / livraison simple | types de mission au choix |
| **Livraison / preuve** | 7 modes (main propre, QR, boîte, jardin, voisin, autre, relais) | signature du réceptionnaire, bon d'enlèvement, photo palette, **échanges de palettes** (à définir) | remise à un **professionnel nommé** (nom, qualité), signature ou code, heure, position, **pas de boîte/jardin/voisin**, aucune donnée patient | remise **contre signature** ou code/pièce, réceptionnaire professionnel, pas de dépôt sans réceptionnaire ; **produits sensibles (stupéfiants) : à traiter hors périmètre sans décision** | relevé de température à la remise, refus motivé, photo du produit | accusé de réception simple | modes au choix |
| **Scanner / codes** | Code 128, Datamatrix, QR ; adresse/téléphone extraits | **+ SSCC / GS1-128** (18 chiffres) | code = **référence seule**, aucune extraction | lot et DLC lus si GS1 (Datamatrix) | lot/DLC, GS1 | EAN-13, code article | selon choix |
| **Bordereaux / lecture IA** | bordereau transporteur + IA (DPD, GLS…) = | CMR / bon de livraison (import) | **IA coupée** ; bon de mission ou import CSV | bon de livraison / import | bon de livraison / import | import CSV | selon choix |
| **Champs** | poids, volume, référence client, fragile, urgent, consigne | poids, SSCC, température (facultative), type EUR/demi/autre | **température requise**, relevé, urgent, lot/DLC facultatifs, référence de mission, téléphone/nom destinataire **masqués** | **lot et DLC requis**, température, nature | **lot et DLC requis**, température, relevés | lot/DLC facultatifs | choix |
| **Alertes** | retard 15/30 min, hors ligne 10 min, échéances J-30/J-7/J0 = | retard élargi (60 min), quai non tenu | **urgence non prise en charge**, créneau compromis, température hors plage, durée de transport dépassée, remise non confirmée | DLC proche (90 j proposé), température, remise non confirmée | DLC proche (7 j proposé), rupture de chaîne du froid, relevé manquant | seuil mini, DLC (30 j), écart d'inventaire | choix |
| **Optimisation** | TSP + 2-opt/Or-opt, 3 min/arrêt = | durée d'arrêt longue (15 à 30 min), rendez-vous | **fenêtre dure**, priorité urgent, **ordre fixe**, durée de transport max | fenêtres souples, capacité, compatibilité froid | délai max, compatibilité chaud/froid, multi-points | aucune | choix |
| **Étiquettes (Stock)** | A4 3×7, fragile/urgent/consigne | 100×150 thermique + SSCC | 62×29, **sans donnée nominative**, température | A4 3×7 : lot, DLC, température | A4 3×7 : lot, DLC, température | A4 3×7 : emplacement, date | choix |
| **Stock** | unités (code colis), alerte « non rentré » | unités palettes, emplacements quai/zone/allée | unités échantillons (réfrigérateur) | **articles**, lot/DLC, **FEFO**, seuil mini | **articles**, lot/DLC, FEFO | articles, seuil, lot/DLC facultatifs | unités ou articles |
| **Planning / RH** | planning de tournées, villages = | = + quai | planning de missions / astreintes (Core) | idem | idem | = | idem |
| **Paie** | TRM (France), temps de conduite RTE = | = | module **optionnel** (absent de la version Core simple) | idem | idem | = | idem |
| **Flotte / véhicules** | VL/PL/SPL, documents standard = | **capacité en palettes**, hayon, plateau | **kit d'emballage UN3373, caisse isotherme**, sonde, formation conducteur (document), assurance spécifique | véhicule **à température dirigée** possible, étalonnage | **frigorifique**/**surgelé**, plage de température, relevé, ATP (document) | utilitaire standard | aptitudes au choix |
| **Carburant / TICPE** | oui = | oui = | module optionnel (hors Core simple) | idem | idem | = | idem |
| **Exploitation / suivi** | suivi en direct, retards, clôture = | rendez-vous, quai | urgences en tête, créneaux, écarts | remises non confirmées | températures, délais | = | choix |
| **Rapports / exports** | « Arrêts, Livrés, Non livrés, Colis » ; `tournees-colis-…` = | + palettes, échanges, SSCC | + créneaux, durée de transport, réceptionnaire, **chaîne qui/quand/où** (sans donnée patient) | + lot, DLC, réceptionnaire | + relevés de température, délais | + références, quantités | choix |
| **Documents PDF** | feuille de route = | bon de livraison / enlèvement | bon de mission, fiche de chaîne de responsabilité | bon de remise signé | fiche de relevés | bon de sortie | choix |
| **Conservation** | destinataires 30 j ; adresses, photos 12 mois ; GPS 1 an = | = | **réglable** (chaîne de responsabilité), pas de destinataire nominatif | réglable | réglable (relevés) | = | choix |
| **Assistant / guides** | = | guides palettes | guides santé + **avertissement** | guides pharmacie + avertissement | guides alimentaire + avertissement | guides vrac | générique |
| **Onboarding / vitrine** | parcours actuel = | page « palettes / fret » | page « laboratoires et cliniques » (sans promesse de conformité) | page « pharmacies » (idem) | page « traiteurs, produits frais » (idem) | page « stock » | – |
| **Jeu de modules** | complet (GODAC) | complet ou Core | **Core** (sans carburant/paie) | Core | Core ou complet | Core | choix |
| **Avertissement** | – | – | `AVERTISSEMENT_SANTE` + mention suivi logistique | `AVERTISSEMENT_PHARMA` | `AVERTISSEMENT_ALIMENTAIRE` | – | – |

---

## 5. Prochaine étape

1. Le fondateur répond aux questions Q1 à Q8 (au minimum Q1, Q2, Q4, Q5).
2. Coordination avec l'agent du Stock : branche `feat/stock-codes-etiquettes` à commiter et pousser ; accord sur la lecture à deux étages.
3. Phase 0 (socle) dans une branche `feat/profils-socle`, avec migration **proposée, non appliquée**, relue avant toute application.
