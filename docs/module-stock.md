# Module Stock (palettes, colis, références)

Document de conception de la V1. Clé de module : `stock` (table `modules`, activation par organisation dans `organization_modules`, comme les autres modules). Tarification : **non décidée** (voir « Décisions à prendre »).

## Repérage (ce sur quoi le module s'appuie)

- **Activation** : `organization_modules (organization_id, module_key, enabled)` ; `getEnabledModuleKeys` / `garderApi({ modules: [...] })` / `garderPage(id)`. Les écrans, leurs rôles et leurs modules sont déclarés une seule fois dans `lib/acces/catalogue.ts` (menu latéral, barre mobile, gardes de page et d'API, matrice testée).
- **Rôles** : chauffeur < manager < exploitation < direction ; comptable hors chaîne. Manager limité à ses services (`user_services`), exploitation et direction : toute l'organisation (`lib/roles/perimetre.ts`, `current_user_service_ids()` côté base).
- **Colis existants** : `delivery_runs` (tournée du chauffeur et du jour, statuts `loading`, `in_progress`, `done`) et `delivery_stops` (arrêt, `parcel_code`, `parcel_count`, statuts `pending`, `delivered`, `failed`). Scanner : `components/colis/ParcelScanner.tsx` (QR, Datamatrix, codes-barres, saisie manuelle) et `lib/colis/scan.ts`.
- **Dépôts** : `services.depot_*` et `organizations.depot_*` (adresse seulement, pas de modèle d'emplacements).
- **Audit** : `journaliser()` (`lib/audit/journal.ts`), table `audit_log`.
- **Alertes** : enum `alert_type` additif, policies RLS de `alerts` re-déclarées à chaque nouveau type (dernier état : `20261111000006`), `cle_dedoublonnage`, destinataires dans `lib/alerts/destinataires.ts`, liens dans `lib/alerts/resolve-url.ts`.
- **Pays** : le module n'a aucune règle propre à la France (`moduleDisponible` : actif partout).
- **Tests de contrat d'accès** : `lib/acces/__tests__/` (matrice rôle × écran en instantané, `audit-routes-lot*.test.ts`).

## Périmètre V1

**GODAC fournit un suivi logistique configurable.** Le respect des exigences réglementaires propres au secteur de l'entreprise (chaîne du froid, traçabilité sanitaire, pharmacie, produits sanguins, bonnes pratiques de distribution) reste à la charge de l'entreprise : aucun écran, aucun document ni aucune étiquette ne promet une conformité (GDP, HACCP, traçabilité sanitaire…). La mention est affichée sur le tableau de bord, l'entrée, la fiche d'unité, les étiquettes et les paramètres, et reprise dans le DPA et la politique de confidentialité.

### Profils d'activité adaptables

L'entreprise active un ou plusieurs profils dans Stock › Paramètres, puis **ajuste chacun sans code**. Chaque profil prédéfini apporte des valeurs par défaut sensées (`lib/stock/profils.ts`).

| Profil | Clé | Suivi | Vocabulaire | Par défaut |
|---|---|---|---|---|
| Colis / messagerie | `messagerie` | unités | colis | poids, volume, référence client, fragile, urgent, consigne ; étiquette A4 3 × 7 |
| Palettes / fret | `palettes` | unités | palette | type de palette (EUR, demi, autre), poids, SSCC, température ; étiquette thermique 100 × 150 |
| Santé : prélèvements et produits biologiques (dont sang) | `sante` | unités | échantillon | **température obligatoire**, urgent coché, nature « prélèvement », alerte DLC J-2, étiquette 62 × 29 sans donnée nominative |
| Médicaments et pharmacie | `pharmacie` | articles | produit | **lot et DLC obligatoires**, FEFO, alerte DLC J-90, seuil mini |
| Alimentaire (frais, surgelé, sec) | `alimentaire` | articles | produit | **lot et DLC obligatoires**, FEFO, alerte DLC J-7, température frais / surgelé / ambiante, seuil mini |
| Références en vrac | `vrac` | articles | article | lot et DLC facultatifs, FEFO, alerte DLC J-30, seuil mini |
| Personnalisé | `personnalise` | au choix (unités ou articles) | unité | neutre : tout est à composer |

Ce que l'entreprise ajuste pour chaque profil (enregistré dans `stock_parametres.profils_config`, seules les différences avec le catalogue) :

- (a) **vocabulaire** : nom de l'unité (colis, palette, poche, échantillon, boîte, bac…), singulier et pluriel ;
- (b) **champs** parmi poids, volume, SSCC, lot, DLC, température cible, température relevée, nature, fragile, urgent, consigne, référence client / bordereau : *masqué*, *affiché* ou *obligatoire* (fragile et urgent ne peuvent pas être obligatoires) ;
- (c) **alertes** : DLC proche à J-n (1 à 365 jours, ou aucune), seuil mini, unités non rentrées, écart d'inventaire ;
- (d) **contenu de l'étiquette** (le QR code et le code-barres Code 128 y sont toujours) : entreprise (et logo), dépôt, emplacement, nature, température, pictogrammes fragile et urgent, consigne, date, lot, DLC, référence client ;
- (e) **format d'étiquette** par défaut du profil ; la suggestion FEFO se règle aussi par profil.

Les profils « messagerie » et « palettes » suivent des **unités** individualisées (un code = une unité). Les profils « articles » suivent des quantités avec lots et DLC. Les anciens profils (`messagerie`, `palettes`, `vrac`) gardent leurs clés ; la colonne historique `stock_parametres.profils` (limitée par une contrainte à ces trois valeurs) reçoit la « famille » de chaque profil actif, la liste réelle étant dans `profils_config->'actifs'`.

Les champs obligatoires sont contrôlés **deux fois** : côté API (`validerMouvement`, message en français qui nomme le champ) et dans la fonction SQL `stock_enregistrer_mouvement_v2` (`stock_champ_requis_<champ>`). Défauts du catalogue répétés dans `stock__champs_requis` ; un test compare les deux. Une unité déjà connue garde ses valeurs : la ré-entrée n'oblige pas à les ressaisir.

Écrans (mobile-first, `/exploitation/stock/…`) : tableau de bord, mouvement rapide (scan ou saisie : entrée, sortie, transfert, retour, casse, perte, ajustement), liste et recherche des unités et des articles, fiche d'unité, étiquettes, historique des mouvements filtrable avec export CSV / Excel, inventaire guidé par zone, paramètres.

## Modèle de données

Toutes les tables : `organization_id` avec `on delete cascade` vers `organizations` (la suppression de fin de contrat les efface), RLS par organisation, index, contraintes `check`.

- `stock_parametres` : une ligne par organisation : famille des profils actifs (`profils`, trois valeurs historiques), `profils_config` (jsonb : profils actifs et ajustements, contraintes de forme), `prefixe_code` (2 à 6 caractères A-Z0-9), `format_etiquette`.
- `stock_sites` (dépôt, rattaché à un service facultatif) > `stock_emplacements` (une **zone** : quai, zone, allée…, puis ses **emplacements** ; `parent_id`).
- `stock_articles` : nom, référence (code), unité, seuil mini, activité, profil, lots et DLC facultatifs. Suppression logique (`actif`).
- `stock_compteurs` : compteur atomique des codes internes, une ligne par organisation et par année (dernier numéro attribué, 0 à 999 999). `stock_generations` : journal des générations de codes (clé d'idempotence unique par organisation, codes générés). Lecture exploitation et direction ; écriture uniquement par la fonction SQL.
- `stock_unites` : colis, palette, échantillon… individualisé (code principal unique par organisation, **code interne complémentaire** unique par organisation, profil, type, poids, volume, SSCC, et les attributs facultatifs : nature, température, température relevée, fragile, urgent, consigne, référence client, lot, DLC), **statut** `dans_depot`, `en_tournee`, `livre`, `retour`, `perdu`, `endommage`, emplacement courant, lien facultatif vers `delivery_runs` et `delivery_stops` (`on delete set null`).
- `stock_soldes` : quantité courante par article, site, emplacement et lot. Jamais écrite par l'application directement : mise à jour par la fonction SQL de mouvement, dans la même transaction que l'écriture du registre.
- `stock_mouvements` : **registre immuable**. Type (`entree`, `sortie`, `transfert`, `ajustement`, `casse`, `perte`, `retour`), sens, quantité, unité ou article, sites et emplacements, lot, DLC, motif, auteur, date, tournée et arrêt, statuts avant et après, clé d'idempotence (unique par organisation). Aucune mise à jour ni suppression : droits retirés à tous les rôles applicatifs (y compris `service_role`) et déclencheur qui refuse toute modification (seul le lien vers une tournée supprimée peut passer à `null`). Seule la suppression de l'organisation, en fin de contrat, efface le registre (cascade exécutée par le propriétaire de la table).
- `stock_inventaires` et `stock_inventaire_lignes` : comptage par zone, écarts calculés à la validation, qui produit des mouvements d'ajustement.

Écritures : uniquement par des fonctions SQL `security definer` (`stock_enregistrer_mouvement` et sa version `_v2`, `stock_generer_codes`, `stock_definir_prefixe`, `stock_modifier_unite`, `stock_creer_inventaire`, `stock_compter`, `stock_valider_inventaire`) qui revérifient l'organisation et le rôle de l'appelant. Aucune policy d'écriture directe sur le registre, les soldes, les unités et les inventaires. La configuration (sites, emplacements, articles, paramètres) s'écrit par RLS pour l'exploitation et la direction.

## Transitions de statut d'une unité

Source de vérité : `lib/stock/transitions.ts`, reproduite dans la fonction SQL `stock_transition_autorisee` (comparaison testée).

- `entree` : nouvelle unité, ou `livre`, `retour`, `perdu`, `endommage` vers `dans_depot`.
- `sortie` : `dans_depot` ou `retour` vers `en_tournee` (avec tournée) ou `livre` (sortie définitive) ; `en_tournee` vers `livre` (remise au destinataire).
- `transfert` : `dans_depot` ou `retour`, statut inchangé, emplacement modifié.
- `retour` : `en_tournee`, `livre` ou `retour` vers `retour` (rentré, à ranger) ou `dans_depot`.
- `casse` : `dans_depot`, `en_tournee`, `retour` vers `endommage`. `perte` : idem vers `perdu`.
- `ajustement` : `+1` depuis `perdu`, `endommage`, `livre`, `retour`, `en_tournee` vers `dans_depot` ; `-1` depuis `dans_depot` ou `retour` vers `perdu`.

Pour les articles : jamais de solde négatif (`stock_insuffisant`).

## Rôles

| Action | Chauffeur | Manager | Exploitation | Direction | Comptable |
|---|---|---|---|---|---|
| Lire (tableau de bord, listes, historique, export) | oui | ses services | oui | oui | non |
| Entrée, sortie, transfert, retour, casse, perte | oui | oui | oui | oui | non |
| Ajustement manuel, créer et valider un inventaire | non | ses services | oui | oui | non |
| Compter dans un inventaire en cours | oui | oui | oui | oui | non |
| Paramètres (profils adaptables, préfixe des codes, format d'étiquette, sites, emplacements, articles, seuils) | non | non | oui | oui | non |
| Générer des codes, imprimer des étiquettes, lire les fiches, exporter | oui | ses services | oui | oui | non |
| Modifier les attributs d'une unité, ajouter un code interne depuis la fiche | non | ses services | oui | oui | non |

Le comptable n'a aucun accès : le module ne contient aucune valeur (pas de prix ni de valorisation), donc rien qu'il utiliserait. Si une valorisation est ajoutée en V2, un accès en lecture seule sera ouvert.

Audit (`audit_log`) : ajustement, inventaire validé, désactivation (suppression logique) d'un dépôt, d'une zone, d'un emplacement ou d'un article, changement de profils, d'un seuil ; **personnalisation d'un profil**, **préfixe des codes**, **format d'étiquette**, **génération de codes** (nombre et première / dernière valeur, jamais la liste), **impression d'étiquettes** (nombre, format, mode), modification des attributs d'une unité (clés modifiées, jamais les valeurs), exports des unités et de l'historique.

## Codes internes et règle « garder le code existant »

- **Une unité qui arrive avec un code** (code-barres du transporteur ou du client, SSCC, bordereau) **le garde comme code principal**. Un code interne n'est ajouté que si l'entreprise le demande (case « Ajouter aussi un code interne de l'entreprise » à l'entrée, ou bouton depuis la fiche) ; c'est alors un code **complémentaire**, qui ne remplace jamais le code principal.
- **Sans code**, le bouton « Générer un code » de l'écran d'entrée (champ code vide) crée un code interne qui devient le code principal.
- Format `PREFIXE-AAAA-NNNNNN` : préfixe de 2 à 6 caractères A-Z0-9 (par défaut dérivé du nom de l'entreprise : « Transports Martin et Fils » donne `TMF`, enregistré à la première génération ; modifiable ensuite, les anciens codes restent valides), année de Paris, compteur à 6 chiffres.
- `stock_generer_codes(p_nombre, p_cle)` : compteur incrémenté par une seule instruction `insert … on conflict do update` (atomique, par organisation et par année ; vérifié avec deux sessions simultanées : aucun doublon), 500 codes au plus par appel, idempotence par clé (le rejeu renvoie les mêmes codes sans consommer de numéro), numéros dont le code existe déjà (saisi à la main) sautés. Les codes sont donc uniques et contigus, sauf collision avec un code déjà saisi.
- **Le scan résout les deux codes** : `stock_enregistrer_mouvement_v2`, `GET /api/stock/unites?code=`, la recherche, le comptage d'inventaire et l'historique trouvent l'unité par son code principal ou par son code interne.
- **Aucune ambiguïté** : un code (principal ou interne) ne désigne qu'une unité par organisation. Index uniques sur `code` et sur `code_interne`, plus un déclencheur qui refuse un code principal égal au code interne d'une autre unité, et inversement (`stock_code_ambigu`, message clair). Seuls les codes générés pour l'entreprise peuvent être rattachés comme codes internes.
- **Planche d'étiquettes vierges numérotées** : l'entreprise génère 24, 50, 100 codes (ou un autre nombre, 500 au plus) d'avance, les imprime et les colle ensuite. Le premier scan d'un code pré-imprimé inconnu, à l'écran d'entrée, **crée l'unité avec ce code** (comportement de `stock__appliquer`, conservé et testé).
- Les liens avec les tournées (`parcel_code`) continuent de retrouver les unités par leur code principal ; le rapprochement par code interne n'est pas fait (voir « Limites »).

## Attributs génériques d'une unité

Tous facultatifs (sauf ce qu'un profil rend obligatoire) : `nature` (colis, palette, prélèvement / échantillon biologique, médicament, produit alimentaire, produit pharmaceutique, autre + libellé libre de 60 caractères au plus), `temperature` (ambiante, frais 2 à 8 °C, congelé, autre + libellé libre), `temperature_releve` (°C, information), `fragile`, `urgent`, `consigne` (120 caractères au plus, imprimée sur l'étiquette), `reference_client` (60), `lot`, `dlc`. Ils s'affichent sur la fiche d'unité, dans la recherche et la liste (filtres nature, température, urgent, fragile), dans l'historique (valeurs actuelles de la fiche) et sur l'étiquette. Ils s'écrivent à l'entrée (`stock_enregistrer_mouvement_v2`) et depuis la fiche par l'encadrement (`stock_modifier_unite`, qui refuse d'effacer un champ obligatoire). **Aucune logique réglementaire** : la température est une information d'étiquetage et de recherche, pas un contrôle de chaîne du froid.

Les champs libres (consigne, référence client, libellés) portent l'avertissement « ne saisissez aucune donnée de santé nominative » (écran d'entrée, fiche, paramètres). Le stock ne contient aucune donnée de patient, de donneur ni de destinataire ; les données ajoutées sont mentionnées dans le DPA (annexe 1) et la politique de confidentialité.

## Étiquettes

Page `/exploitation/stock/etiquettes` (planche vierge numérotée), bouton « Imprimer ou réimprimer l'étiquette » sur la fiche d'unité, case « Imprimer l'étiquette après l'entrée » (lien d'impression de chaque unité entrée, et bouton pour toute la séance de scan en rafale).

- PDF produit côté serveur (`@react-pdf/renderer`, route `/api/stock/etiquettes`, GET pour une ou plusieurs unités, POST pour une planche vierge). 500 étiquettes au plus par document.
- Contenu : **QR code** (le code seul), **code-barres Code 128** du même code, code en gros caractères, nom de l'entreprise et logo de l'organisation (`organizations.logo_url`, PNG ou JPEG, sinon rien), dépôt et emplacement, nature, température, pictogrammes fragile (cadre) et urgent (plein, lisible en noir et blanc), consigne, date. Les champs imprimés se règlent par profil.
- Le code porté par l'étiquette d'une unité est son code interne s'il existe, sinon son code principal ; le scan résout les deux.
- Formats (`lib/stock/formats-etiquette.ts`) : feuille A4 2 × 4 (8 étiquettes de 99,1 × 67,7 mm), feuille A4 3 × 7 (21 étiquettes de 63,5 × 38,1 mm), thermique 100 × 150 mm, étiquette 62 × 29 mm. Le format par défaut est mémorisé **par organisation** (`stock_parametres.format_etiquette`), à défaut celui du profil. Une planche entamée se réutilise (nombre d'emplacements déjà pris).
- Encodeur **Code 128 écrit dans le code** (`lib/stock/code128.ts`, jeux B et C choisis au plus court, somme de contrôle modulo 103, zone de silence de 10 modules) et QR code par la bibliothèque `qrcode` déjà présente : aucune nouvelle dépendance. Tests sur vecteurs de référence (« PJJ123C » : contrôle 54 en jeu A) et relecture indépendante des modules.
- Imprimer à l'échelle 100 % (sans « ajuster à la page ») pour que les étiquettes tombent sur la planche.

## FEFO et alerte « DLC proche »

- **FEFO** (first expired, first out) : à la sortie (ainsi qu'à la casse, la perte et le transfert) d'un article dont le profil a la suggestion FEFO, l'écran propose le lot dont la DLC est la plus proche (« Choisir ce lot »). C'est une aide : l'opérateur garde le choix. Le détail par lot de la liste des articles est trié par DLC.
- **Alerte `stock_dlc_proche`** : par le cron quotidien existant (`/api/cron/stock`, une fois par jour, rien de plus fréquent), une alerte par lot (clé `stock:dlc:<article>:<lot>`) dont la DLC tombe dans le délai du profil de l'article (J-7 alimentaire, J-90 pharmacie, J-30 vrac, J-2 santé par défaut ; réglable, ou désactivable) ou est dépassée, et une alerte récapitulative pour les unités individualisées. Elle se referme quand le lot est épuisé ou sort du délai. Lecture : direction et exploitation. Valeur d'enum additive dans un fichier séparé, puis policies d'alertes re-déclarées en conservant **tous** les types existants (y compris `stock_seuil`, `stock_ecart`, `stock_non_rentre`).
- Les autres règles d'alerte du profil sont appliquées : le seuil mini n'alerte pas pour un profil qui l'a désactivé, ni les unités non rentrées, ni l'écart d'inventaire.

## Liens avec les tournées (intégration tolérante)

`lib/stock/integration-tournee.ts`, appelée **après** l'action colis et **jamais bloquante** (try/catch, journal serveur seulement). Si le module `stock` n'est pas actif, ou si les migrations ne sont pas appliquées, rien ne change.

- Passage de la tournée à `in_progress` (départ) : pour chaque arrêt en attente dont `parcel_code` correspond à une unité `dans_depot` (ou `retour`), mouvement `sortie` lié à la tournée et à l'arrêt, statut `en_tournee`. Clé d'idempotence `tournee:<tournée>:<arrêt>:depart` : relancer la requête ne sort pas deux fois le colis.
- Arrêt `delivered` (route de l'arrêt ou route de livraison) : l'unité correspondante passe `livre` (mouvement `sortie`, clé `tournee:<arrêt>:livre`).
- Arrêt `failed` : l'unité `en_tournee` passe `retour` (mouvement `retour`, clé `tournee:<arrêt>:echec`) : elle est « à rentrer », toujours dans le véhicule jusqu'à son retour au dépôt.
- Clôture de la tournée (`done`) : les unités encore `en_tournee`, ou `retour` sans emplacement (pas rangées), de cette tournée déclenchent l'alerte `stock_non_rentre`, qui se referme quand elles sont rentrées (mouvement `retour` avec « Remis en stock » et un emplacement). Le cron quotidien refait ce contrôle.
- Les codes sans unité en stock sont ignorés : le flux colis ne dépend pas du stock. Chaque appel est enveloppé dans un `try/catch` et n'écrit qu'une ligne de journal en cas d'échec. Au plus 400 mouvements et 5 s par requête de départ.
- Statut « retour » : l'unité est revenue (échec de livraison, retour client) et attend d'être rangée ; elle compte dans les « retours à traiter ».

## Interface et programmes

- Écrans : `/exploitation/stock` (tableau de bord), `/mouvement`, `/liste`, `/etiquettes`, `/unites/[id]` (fiche d'unité, hors menu), `/historique`, `/inventaire`, `/parametres`, sous-onglets de la section Exploitation du menu ; une entrée « Stock » dans « Plus » sur mobile.
- Routes `app/api/stock/*` : toutes derrière `garderApi` (rôles et module `stock`), listées dans `lib/acces/__tests__/audit-routes-stock.test.ts` (dont `codes`, `etiquettes`, `unites/[id]`, `unites/export`). Le cron `/api/cron/stock` (une fois par jour, 5 h 40 UTC) est protégé par `CRON_SECRET`.
- Mouvement : choix du mouvement et de l'emplacement une fois, puis scan en rafale (`ParcelScanner`) ou saisie ; chaque envoi a sa clé d'idempotence, conservée tant qu'une coupure réseau n'a pas permis de confirmer l'action. La file hors ligne complète (mise en attente locale) est reportée en V2.

## Alertes

Types additifs : `stock_seuil` (article sous son seuil mini), `stock_ecart` (écart à la validation d'un inventaire), `stock_non_rentre` (unités en tournée non rentrées après clôture). Migration d'enum séparée, puis policies RLS re-déclarées en conservant tous les types existants. Lecture : direction et exploitation ; manager pour les alertes de ses services ; ni chauffeur ni comptable. Vérification quotidienne par le cron `/api/cron/stock` (une fois par jour) et, pour le seuil, après chaque retrait d'article et chaque changement de seuil. Une alerte par article (clé `stock:seuil:<article>`), rouverte si le stock repasse sous le seuil après avoir été résolue, close automatiquement quand le stock remonte. Le seuil est global à l'organisation : son alerte n'a pas de service et ne va qu'à la direction et à l'exploitation (le tableau de bord montre aux managers les articles sous le seuil de leurs dépôts).

Tolérance : tant que les migrations 3 et 4 ne sont pas appliquées, aucune alerte n'est créée (`typeAbsent`), tout le reste fonctionne. Tant que les migrations 1 et 2 ne sont pas appliquées, les écrans affichent « module installé, base pas encore mise à jour » et les routes répondent 503.

## Données personnelles et conservation

- Le stock ne contient **aucune donnée de destinataire** : ni nom, ni adresse, ni téléphone. Le seul lien est l'identifiant d'un arrêt ou d'une tournée existants (qui, eux, suivent leurs propres durées).
- Le registre garde le nom de l'auteur d'un mouvement (salarié du client) pour la traçabilité.
- **Conservation du registre : 5 ans proposés, aucune purge automatique** (le registre peut servir de pièce comptable ou de preuve en cas de litige). La durée est à confirmer par le fondateur ; une purge éventuelle serait une décision séparée. Les unités, soldes et inventaires sont conservés pendant le contrat. Tout est effacé avec l'organisation à la fin du contrat (cascade).
- Mention ajoutée à la politique de confidentialité et à l'annexe 1 du DPA (catégories de données).

## Migrations (à appliquer dans l'ordre, par `execute_sql`)

1. `20261114000001_stock_schema.sql` : fiche du module (sans prix), tables, index, RLS, registre immuable.
2. `20261114000002_stock_fonctions.sql` : fonctions SQL transactionnelles.
3. `20261114000003_alerte_stock_types.sql` : trois valeurs d'enum (à appliquer seule : une valeur d'enum ne s'utilise pas dans la transaction qui l'ajoute).
4. `20261114000004_alerte_stock_lecture.sql` : policies d'alertes re-déclarées avec tous les types existants.
5. `20261114000005_stock_sites_lecture_corrigee.sql` : correctif de la policy de lecture de `stock_sites` (piège RLS de l'insertion avec `returning`).
6. `20261115000001_stock_codes_attributs_schema.sql` : colonnes (paramètres, unités, articles), `stock_compteurs`, `stock_generations`, cohérence des codes, RLS.
7. `20261115000002_stock_codes_fonctions.sql` : `stock_generer_codes`, `stock_definir_prefixe`, `stock_enregistrer_mouvement_v2`, `stock_modifier_unite` et leurs fonctions internes.
8. `20261115000003_alerte_stock_dlc_type.sql` : valeur d'enum `stock_dlc_proche` (à appliquer seule).
9. `20261115000004_alerte_stock_dlc_lecture.sql` : policies d'alertes avec tous les types, `stock_dlc_proche` en plus.

Toutes sont additives et rejouables (aucun `drop`, aucune suppression ni mise à jour de masse ; colonnes `add column if not exists`, policies créées seulement si absentes de `pg_policies`). Leur contenu est relu par `lib/stock/__tests__/migrations.test.ts` et `migrations-codes.test.ts` (dont une vérification générale qu'aucune policy de lecture ne relit sa propre table). La table `lib/stock/__tests__/transitions-sql.json` a été générée en exécutant `stock_transition_autorisee` sur PostgreSQL 16 ; elle empêche toute divergence entre la fonction SQL et `lib/stock/transitions.ts`. Les migrations 6 à 9 ont de plus été exécutées deux fois de suite sur PostgreSQL 16 (rejouabilité) et la génération de codes, la résolution des deux codes, les refus d'ambiguïté, les champs obligatoires, le rôle de chaque appelant et la concurrence (deux sessions) ont été vérifiés sur une base de test.

Tolérance : tant que les migrations 6 à 9 ne sont pas appliquées, le stock fonctionne comme avant (profils historiques, mouvement par la fonction d'origine) ; les profils nouveaux, les codes, les attributs et les étiquettes indiquent « disponible après la mise à jour de la base » ou répondent 503.

## Hors périmètre V1

- Valorisation du stock (prix, PMP), facturation du stockage, lien avec la comptabilité.
- Réservations et préparation de commandes, picking guidé, génération de SSCC GS1 (l'étiquette porte le code interne ou le code lu, pas un SSCC calculé).
- Scan en rafale avec file hors ligne complète (l'idempotence est prête côté serveur : chaque mouvement porte une clé ; la mise en file côté téléphone viendra en V2).
- Chargement automatique des colis d'une tournée avant le départ (V1 : sortie au passage en `in_progress`).
- Import de références en masse, lecture des étiquettes SSCC/GS1 (le code lu est utilisé tel quel), gestion des palettes consignées (échanges de palettes EUR).
- Accès en lecture du comptable, tableau de bord multi-dépôts avec cartes.
- Tarification : la fiche du module est ajoutée **sans prix** ; elle est activable tant que le fondateur n'a pas décidé de tarif.

## Limites connues

- L'intégration avec les tournées retrouve les unités par leur code principal (`parcel_code`), pas par leur code interne complémentaire.
- Les attributs affichés dans l'historique sont les valeurs actuelles de la fiche de l'unité, pas celles du jour du mouvement (le registre immuable ne les recopie pas).
- Le profil d'une unité est celui de son entrée ; le profil d'un article est choisi à sa création (non modifiable depuis l'écran dans cette version).
- Pas de lecture des étiquettes GS1 / SSCC : le code lu est utilisé tel quel.

## Décisions à prendre

1. Tarification du module (à la carte ? inclus dès quelle formule ?).
2. Durée de conservation du registre (5 ans proposés) et purge éventuelle.
3. Accès du comptable (valorisation) et périmètre V2.
4. Les profils santé, pharmacie et alimentaire portent des valeurs par défaut (température obligatoire, lot et DLC obligatoires, délais d'alerte) : à valider avec un premier client de chaque secteur avant de les mettre en avant commercialement.
5. Vocabulaire commercial et wording réglementaire : la mention « suivi logistique, conformité à la charge de l'entreprise » doit être relue par le conseil juridique avant diffusion à des clients santé.
