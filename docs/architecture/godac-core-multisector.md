# GODAC Core multi-métiers — audit et trajectoire

**Statut :** décision d'architecture proposée, à valider par étapes  
**Périmètre :** faire évoluer le produit existant vers un socle duplicable, sans réécriture complète et sans régression du transport.  
**Production :** aucune modification de production ni migration de base n'est exécutée par ce document.

## Décision produit

GODAC doit d'abord fournir un noyau opérationnel utile à plusieurs métiers, puis accueillir des extensions sectorielles. La spécialisation est progressive : transport en premier, puis autres secteurs selon les besoins observés.

Le noyau commun doit couvrir :
- organisations et sites ;
- utilisateurs, rôles et permissions ;
- ressources et disponibilités ;
- opérations planifiées, affectations et contraintes ;
- statuts d'exécution, incidents et historique ;
- notifications et indicateurs opérationnels ;
- activation de modules par organisation.

Les règles propres aux tournées, colis, carburant et TICPE restent dans les modules transport. Les concepts spécifiques aux hôtels, restaurants, taxis, chantiers ou services publics ne doivent pas être forcés dans les tables transport existantes.

## Constat sur le code actuel (branche main auditée)

### Éléments déjà réutilisables
- `organizations` est la racine multi-tenant et de nombreuses tables portent déjà `organization_id`.
- Le catalogue `modules` et le commutateur `organization_modules` permettent déjà de décrire les modules vendables et leur activation par organisation.
- L'onboarding enregistre le plan et les modules sélectionnés ; `lib/organization/modules.ts` fournit les gardes d'activation.
- Le planning possède des affectations datées, des modèles de tournées réutilisables et une API de génération qui conserve les créneaux existants.
- Le build local communiqué le 18 octobre 2026 passe compilation, vérification TypeScript, génération des 180 pages et traces. Il affiche toutefois un avertissement de configuration Next.js pour `outputFileTracingIncludes`. Ce résultat provient du log utilisateur ; il n'a pas été relancé depuis GitHub.

### Couplages transport à traiter
- La migration initiale décrit explicitement une « client transport company ».
- `planning_entries` impose `service_id` et `tour_number`, et référence des chauffeurs et véhicules : c'est un planning de tournées, pas un planning universel.
- Les rôles et écrans opérationnels utilisent des termes comme chauffeur, service, tournée, colis et carburant.
- Le catalogue de modules mélange des fonctionnalités transverses et des offres spécifiques au transport. Certaines descriptions de planning sont TRM-spécifiques.
- Les modèles actuels référencent `tour_routes` et les villages ; ils ne constituent donc pas des modèles génériques d'intervention ou de tâche.

### Conséquence
Ne pas remplacer immédiatement les tables existantes par un modèle universel. Les données et workflows transport sont en production : il faut introduire les abstractions communes en parallèle, avec compatibilité ascendante, puis migrer fonctionnalité par fonctionnalité.

## Architecture cible

### Couche 1 — noyau commun
1. **Organisation et site** : identité de l'entreprise, secteur initial indicatif, paramètres et sites.
2. **Identité et accès** : utilisateurs, appartenance, rôles et permissions vérifiés côté serveur.
3. **Ressources** : personnes, espaces, véhicules, matériels et équipements, avec disponibilité et compétences.
4. **Opérations** : objet planifié indépendant du vocabulaire d'un secteur, avec type, statut, priorité, fenêtre temporelle, lieu et historique.
5. **Affectations** : lien explicite entre une opération et une ou plusieurs ressources, avec contrôle de conflits.
6. **Modèles et récurrences** : génération d'opérations datées, sans écraser les éléments modifiés manuellement.
7. **Pilotage** : audit, notifications et indicateurs transverses.

### Couche 2 — modules métier
- Transport : tournées, colis, dépôts, optimisation d'itinéraires, flotte, carburant et TICPE.
- Maintenance/BTP : interventions, chantiers, matériels, équipes et comptes rendus.
- Hôtellerie/restauration : tâches, chambres, postes, réservations et équipements.
- Taxis/transport sanitaire : courses ou missions, compétences et contraintes réglementaires dédiées.
- Collectivités : interventions, tournées de collecte et équipements publics.

Un secteur ne doit activer que ses modules et son vocabulaire. Les contraintes de sécurité, de conformité et les champs sensibles restent propres au module concerné.

## Stratégie de branches

- `main` reste la référence stable.
- Les changements communs sont développés dans des branches courtes `feature/core-...` puis fusionnés par PR après CI.
- Les adaptations sectorielles ont des branches `sector/transport`, `sector/maintenance`, etc. quand un développement sectoriel le justifie.
- Les différences de configuration ou de modules ne doivent pas créer une branche permanente inutile : elles restent des données de configuration.
- Toute amélioration générique découverte dans une branche sectorielle doit revenir dans le noyau par PR ; éviter les copies qui divergent.

## Plan d'évolution, sans big bang

### Étape 0 — stabilisation
- Garder la PR #147 comme brique de génération du planning transport ; elle est fusionnée dans `main`.
- Vérifier les workflows CI de `main` et corriger l'avertissement de configuration Next séparément, sans mélanger les changements.
- Ne pas déployer une branche d'architecture directement en production.

### Étape 1 — contrat de domaine du noyau
- Définir les concepts métier génériques et leurs relations avant toute migration SQL.
- Établir les invariants : propriété par organisation, permissions serveur, ressources affectées, dates/fuseaux horaires, statuts et historique.
- Définir une stratégie de compatibilité entre `planning_entries` et le futur modèle générique.

### Étape 2 — première tranche fonctionnelle verticale
- Introduire une première opération générique et ses affectations dans une migration additive.
- Ajouter API, permissions, tests et une interface simple pour créer, planifier, affecter et clôturer une opération.
- Garder le planning transport actuel intact ; aucun remplacement en place.
- Valider l'isolement multi-tenant et les conflits avant toute adoption réelle.

### Étape 3 — premier test duplicable
- Vérifier le même noyau sur deux cas très différents : tournée transport et intervention de maintenance.
- Ajouter le troisième cas (tâche d'hôtel/restaurant) seulement après validation des abstractions.
- Ne créer une abstraction que si elle sert au moins deux cas réels ou supprime un couplage avéré.

## Garde-fous de migration et sécurité
- Toutes les nouvelles lignes métier sont rattachées à `organization_id`; l'appartenance est vérifiée côté serveur et protégée par RLS.
- Les références croisées entre organisations doivent être impossibles, pas simplement masquées dans l'interface.
- Les migrations sont additives, idempotentes lorsque possible et testées sur une base de test.
- Pas de renommage ou suppression des tables historiques pendant la première phase.
- Pas de données médicales sensibles dans le noyau générique ; les modules réglementés ont leurs propres contrôles et politiques.
- Les tests doivent couvrir au minimum : droits, isolation entre organisations, conflits de ressources, récurrence, fuseaux horaires et non-écrasement des affectations existantes.

## Critères d'acceptation du Core v1
- Une organisation peut activer ses modules sans modifier le code du noyau.
- Un responsable peut créer, planifier, affecter, suivre et clôturer une opération générique.
- Les conflits de disponibilité sont expliqués avant validation.
- Une opération d'une organisation n'est jamais visible ou modifiable par une autre.
- Le transport existant continue de fonctionner sans migration destructive.
- Build, tests et vérifications de permissions passent avant fusion ; la production n'est mise à jour qu'après validation explicite du déploiement.

## Prochaine tâche de développement

Après cet audit, la première PR de code doit porter sur le **contrat du domaine opérationnel générique et une tranche verticale minimale**, pas sur une refonte de tous les écrans. La migration SQL ne doit être écrite qu'après validation des relations et des règles de sécurité ci-dessus.
