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

Trois **profils d'activité**, activables séparément (une entreprise peut en activer plusieurs) dans Stock › Paramètres. Chaque profil fixe le vocabulaire et les unités :

| Profil | Clé | On suit | Unité | Particularités |
|---|---|---|---|---|
| Messagerie / colis | `messagerie` | des **unités** individuelles (un colis = un code) | colis | code-barres ou code colis, poids (kg), volume (m³) |
| Palettes / fret | `palettes` | des **unités** individuelles (une palette = un code) | palette | type EUR, demi-palette ou autre, poids, SSCC (18 chiffres) facultatif, emplacement quai / zone / allée |
| Marchandises en vrac / références | `vrac` | des **articles** en quantité | unité de l'article (pièce, carton, kg, litre…) | référence, seuil mini, lots et DLC facultatifs |

Écrans (mobile-first, `/exploitation/stock/…`) : tableau de bord, mouvement rapide (scan ou saisie : entrée, sortie, transfert, retour, casse, perte, ajustement), liste et recherche des unités et des articles, historique des mouvements filtrable avec export CSV / Excel, inventaire guidé par zone, paramètres (profils, dépôts, zones et emplacements, articles et seuils).

## Modèle de données

Toutes les tables : `organization_id` avec `on delete cascade` vers `organizations` (la suppression de fin de contrat les efface), RLS par organisation, index, contraintes `check`.

- `stock_parametres` : une ligne par organisation, profils actifs (`messagerie`, `palettes`, `vrac`).
- `stock_sites` (dépôt, rattaché à un service facultatif) > `stock_emplacements` (une **zone** : quai, zone, allée…, puis ses **emplacements** ; `parent_id`).
- `stock_articles` : nom, référence (code), unité, seuil mini, activité, lots et DLC facultatifs. Suppression logique (`actif`).
- `stock_unites` : colis ou palette individualisé (code unique par organisation, type, poids, volume, SSCC), **statut** `dans_depot`, `en_tournee`, `livre`, `retour`, `perdu`, `endommage`, emplacement courant, lien facultatif vers `delivery_runs` et `delivery_stops` (`on delete set null`).
- `stock_soldes` : quantité courante par article, site, emplacement et lot. Jamais écrite par l'application directement : mise à jour par la fonction SQL de mouvement, dans la même transaction que l'écriture du registre.
- `stock_mouvements` : **registre immuable**. Type (`entree`, `sortie`, `transfert`, `ajustement`, `casse`, `perte`, `retour`), sens, quantité, unité ou article, sites et emplacements, lot, DLC, motif, auteur, date, tournée et arrêt, statuts avant et après, clé d'idempotence (unique par organisation). Aucune mise à jour ni suppression : droits retirés à tous les rôles applicatifs (y compris `service_role`) et déclencheur qui refuse toute modification (seul le lien vers une tournée supprimée peut passer à `null`). Seule la suppression de l'organisation, en fin de contrat, efface le registre (cascade exécutée par le propriétaire de la table).
- `stock_inventaires` et `stock_inventaire_lignes` : comptage par zone, écarts calculés à la validation, qui produit des mouvements d'ajustement.

Écritures : uniquement par des fonctions SQL `security definer` (`stock_enregistrer_mouvement`, `stock_creer_inventaire`, `stock_compter`, `stock_valider_inventaire`) qui revérifient l'organisation et le rôle de l'appelant. Aucune policy d'écriture directe sur le registre, les soldes, les unités et les inventaires. La configuration (sites, emplacements, articles, paramètres) s'écrit par RLS pour l'exploitation et la direction.

## Transitions de statut d'une unité

Source de vérité : `lib/stock/transitions.ts`, reproduite dans la fonction SQL `stock_transition_autorisee` (comparaison testée).

- `entree` : nouvelle unité, ou `livre`, `retour`, `perdu`, `endommage` vers `dans_depot`.
- `sortie` : `dans_depot` ou `retour` vers `en_tournee` (avec tournée) ou `livre` (sortie définitive).
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
| Paramètres (profils, sites, emplacements, articles, seuils) | non | non | oui | oui | non |

Le comptable n'a aucun accès : le module ne contient aucune valeur (pas de prix ni de valorisation), donc rien qu'il utiliserait. Si une valorisation est ajoutée en V2, un accès en lecture seule sera ouvert.

Audit (`audit_log`) : ajustement, inventaire validé, désactivation (suppression logique) d'un dépôt, d'une zone, d'un emplacement ou d'un article, changement de profils, d'un seuil.

## Liens avec les tournées (intégration tolérante)

`lib/stock/integration-tournee.ts`, appelée **après** l'action colis et **jamais bloquante** (try/catch, journal serveur seulement). Si le module `stock` n'est pas actif, ou si les migrations ne sont pas appliquées, rien ne change.

- Passage de la tournée à `in_progress` (départ) : pour chaque arrêt dont `parcel_code` correspond à une unité `dans_depot`, mouvement `sortie` lié à la tournée et à l'arrêt, statut `en_tournee`.
- Arrêt `delivered` : l'unité `en_tournee` correspondante passe `livre` (mouvement `sortie`, lié à l'arrêt).
- Arrêt `failed` : l'unité passe `retour` (à rentrer au dépôt).
- Clôture de la tournée (`done`) : les unités encore `en_tournee` ou `retour` de cette tournée déclenchent l'alerte `stock_non_rentre`, qui se referme quand elles sont rentrées. Le chauffeur ou le magasinier les rentre par un mouvement `retour` (scan).
- Les codes sans unité en stock sont ignorés (le flux colis ne dépend pas du stock).

## Alertes

Types additifs : `stock_seuil` (article sous son seuil mini), `stock_ecart` (écart à la validation d'un inventaire), `stock_non_rentre` (unités en tournée non rentrées après clôture). Migration d'enum séparée, puis policies RLS re-déclarées en conservant tous les types existants. Lecture : direction et exploitation ; manager pour les alertes de ses services ; ni chauffeur ni comptable. Vérification quotidienne par le cron `/api/cron/stock` (une fois par jour) et, pour le seuil, après chaque sortie.

## Données personnelles et conservation

- Le stock ne contient **aucune donnée de destinataire** : ni nom, ni adresse, ni téléphone. Le seul lien est l'identifiant d'un arrêt ou d'une tournée existants (qui, eux, suivent leurs propres durées).
- Le registre garde le nom de l'auteur d'un mouvement (salarié du client) pour la traçabilité.
- **Conservation du registre : 5 ans proposés, aucune purge automatique** (le registre peut servir de pièce comptable ou de preuve en cas de litige). La durée est à confirmer par le fondateur ; une purge éventuelle serait une décision séparée. Les unités, soldes et inventaires sont conservés pendant le contrat. Tout est effacé avec l'organisation à la fin du contrat (cascade).
- Mention ajoutée à la politique de confidentialité et à l'annexe 1 du DPA (catégories de données).

## Hors périmètre V1

- Valorisation du stock (prix, PMP), facturation du stockage, lien avec la comptabilité.
- Réservations et préparation de commandes, picking guidé, étiquettes imprimées (code colis, SSCC généré).
- Scan en rafale avec file hors ligne complète (l'idempotence est prête côté serveur : chaque mouvement porte une clé ; la mise en file côté téléphone viendra en V2).
- Chargement automatique des colis d'une tournée avant le départ (V1 : sortie au passage en `in_progress`).
- Import de références en masse, lecture des étiquettes SSCC/GS1 (le code lu est utilisé tel quel), gestion des palettes consignées (échanges de palettes EUR).
- Accès en lecture du comptable, tableau de bord multi-dépôts avec cartes.
- Tarification : la fiche du module est ajoutée **sans prix** ; elle est activable tant que le fondateur n'a pas décidé de tarif.

## Décisions à prendre

1. Tarification du module (à la carte ? inclus dès quelle formule ?).
2. Durée de conservation du registre (5 ans proposés) et purge éventuelle.
3. Accès du comptable (valorisation) et périmètre V2.
