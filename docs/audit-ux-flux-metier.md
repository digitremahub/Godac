# Audit UX et continuité métier GODAC

Date : 18 octobre 2026  
Base examinée : `main` au commit `c9a6ab5cc8bc94861b9739a2d555bbda89a616f7`

## Objectif

Réduire les actions, les champs à ressaisir et les changements de contexte dans trois parcours liés : création/gestion des tournées, planning, communication interne. Préserver les fonctions existantes et avancer par petites PR testables, sans refonte globale risquée.

## Périmètre examiné

- Pages serveur : `app/(dashboard)/planning/page.tsx`, `app/(dashboard)/colis/page.tsx`, `app/(dashboard)/intranet/page.tsx`.
- Interfaces : `components/colis/TourneeColis.tsx`, `AffecterTourneeColis.tsx`, `ImportTournee.tsx`, `components/planning/PlanningGrid.tsx`, `PlanningTemplatesPanel.tsx`, `components/intranet/AnnouncementForm.tsx`, `AnnouncementsList.tsx`.
- API : `/api/colis/tournees`, `/api/planning/entries`, annonces et convocations.
- Architecture : Next.js App Router, Supabase/RLS, rôles, modules et plusieurs vues du planning.

Cet audit est une revue du code disponible. Il ne remplace pas les tests utilisateurs, le build de production, ni une inspection authentifiée de chaque écran en fonctionnement.

## Constatations

### 1. Des données métier déjà liées, mais encore trop dispersées

- Le planning possède des affectations (service, tournée, chauffeur, véhicule, date/heure).
- Les tournées colis possèdent des modèles de parcours et des villages, puis des tournées quotidiennes avec listes et arrêts.
- L'API de création de tournée tente déjà de récupérer les affectations du chauffeur du jour et de préremplir les informations, puis de charger les villages des modèles correspondants.
- Les modèles hebdomadaires de planning savent générer des affectations récurrentes.

**Conséquence UX :** des mécanismes de liaison existent, mais ils ne sont pas encore présentés comme un parcours unique et explicite. Il faut rendre visible la source des valeurs préremplies et permettre de corriger une valeur à un seul endroit.

### 2. Le planning offre plusieurs vues, ce qui est puissant mais peut brouiller l'action principale

La page expose semaine, jour, mois, kanban et liste, ainsi que la présence et les modèles. Les affectations et les modèles récurrents cohabitent dans le même domaine fonctionnel.

**Amélioration :** conserver toutes les vues, mais établir une action primaire claire (« Préparer la semaine » / « Affecter une tournée »), garder le contexte de date/service lors des changements de vue, et mettre les actions secondaires dans un panneau repliable. Afficher les conflits et affectations manquantes avant validation.

### 3. La création d'une tournée colis peut mélanger plusieurs responsabilités

Le composant `TourneeColis.tsx` gère notamment saisie d'adresse avec suggestions, scan d'étiquette, ramasses, poids, créneaux, optimisation, historique, export, livraison et clôture. Il contient donc un nombre élevé de responsabilités dans une seule interface.

**Amélioration :** découper visuellement en étapes progressives sans supprimer les fonctions : (1) sélectionner/reprendre la tournée planifiée, (2) importer/scanner/ajouter les arrêts, (3) vérifier les exceptions et créneaux, (4) optimiser, (5) exécuter la tournée. Afficher les champs avancés uniquement quand ils sont pertinents et conserver l'état en cas de retour.

### 4. Les informations d'arrêt devraient être réutilisées systématiquement

Les données d'arrêt peuvent inclure entreprise/adresse, téléphone, type (livraison/ramasse/point relais), poids et créneau. La recherche d'adresse agrège déjà des sources de géocodage et déduplique les suggestions.

**Amélioration :** faire de l'entreprise/adresse normalisée la base de réutilisation des coordonnées et préférences connues. À la saisie, proposer les valeurs déjà connues et ne demander que les informations manquantes. Ne pas recopier un même arrêt entre listes ou tournées sans expliciter s'il s'agit d'une nouvelle visite ou d'un arrêt récurrent.

### 5. L'intranet fonctionne comme un espace séparé des opérations

La page intranet gère les annonces, accusés de lecture, demandes de rendez-vous et convocations. Une annonce cible toute l'organisation ou un service, mais le formulaire ne relie pas directement l'annonce à une affectation, une tournée ou une date de planning.

**Amélioration :** ajouter des actions contextuelles (« Envoyer une consigne à l'équipe de cette tournée », « Prévenir le chauffeur affecté ») qui préremplissent le service, les destinataires et le contexte. L'annonce doit rester une communication ; elle ne doit pas modifier implicitement le planning ou l'affectation.

### 6. Les retours d'action doivent être uniformes et explicites

Les formulaires utilisent des stratégies de gestion des réponses différentes. Par exemple, certains parsements JSON supposent une réponse valide ; d'autres gèrent les réponses vides. Les annonces rafraîchissent la page après publication, mais la liste ne traite pas explicitement les réponses d'erreur lors du marquage comme lu.

**Amélioration :** adopter un patron commun : chargement, prévention du double clic, succès explicite, message d'erreur actionnable, traitement des réponses non JSON et conservation des saisies si l'enregistrement échoue.

### 7. Le mobile doit être le parcours de référence côté chauffeur

Le parcours colis inclut caméra, scan, appels, SMS et navigation. Ces actions sont sensibles au contexte mobile et à la connectivité.

**Amélioration :** conserver une action principale visible, limiter les saisies au clavier, rendre l'état réseau et la synchronisation hors ligne visibles, et placer téléphone/navigation/SMS au niveau de l'arrêt concerné. Tester sur appareil réel avant toute généralisation.

## Architecture cible recommandée

La source de vérité reste la base métier Supabase et ses règles RLS. L'interface ne doit pas dupliquer la logique.

1. **Référentiels réutilisables** : entreprises/adresses, services, chauffeurs, véhicules, modèles de tournées et créneaux connus.
2. **Planification** : une affectation identifie la tournée, la date/heure, le chauffeur, le véhicule et le service. Les champs déjà connus sont préremplis.
3. **Exécution** : la fiche quotidienne du chauffeur est construite depuis les affectations du jour et les modèles associés. Les changements opérationnels sont enregistrés une fois et leur statut est partagé.
4. **Communication contextuelle** : annonces/consignes peuvent pointer vers une affectation ou une tournée et préremplir destinataires. Les accusés de lecture restent distincts du statut opérationnel.
5. **Alertes ciblées** : absence de chauffeur/véhicule, conflit horaire, tournée non confirmée, créneau manquant ou consigne non lue ; une alerte doit mener directement à l'action de correction.

## Plan de travail priorisé

### P0 — Fiabilité et sécurité avant refonte UX
- Obtenir un build vert et vérifier le commit réellement déployé.
- Vérifier les erreurs API, les doublons et les échecs partiels entre création de tournée, planning et listes.
- Vérifier les règles d'accès par organisation/rôle et l'idempotence des actions qui peuvent être répétées.

### P1 — Réduire la saisie dans le parcours planification → tournée
- Afficher les tournées planifiées disponibles dès l'entrée dans Tournée colis.
- Préremplir chauffeur, véhicule, service, horaire, modèle et villages depuis l'affectation sans nouvelle saisie.
- Présenter les informations préremplies avec leur provenance et permettre une correction unique.
- Détecter les doublons d'affectation/arrêt et demander une confirmation explicite seulement en cas d'ambiguïté.

### P2 — Simplifier l'interface de création et d'exécution
- Découper `TourneeColis` en étapes UI avec progression et sauvegarde robuste.
- Rendre les actions principales explicites et les options avancées repliables.
- Harmoniser les états chargement/erreur/succès et les confirmations destructives.
- Tester les parcours mobiles réels et le mode hors ligne.

### P3 — Relier planning et communication
- Permettre de créer une consigne depuis une affectation ou une tournée avec service/chauffeur prérempli.
- Relier la consigne à l'objet métier et afficher les communications pertinentes depuis le planning/la fiche tournée.
- Ajouter une vue direction « à traiter » : affectations manquantes, conflits, confirmations attendues, consignes urgentes/non lues.

## Critères d'acceptation

- Un utilisateur ne ressaisit pas le chauffeur, le véhicule, le service, la date et l'heure lorsqu'ils sont déjà définis dans le planning.
- Une tournée planifiée ouvre directement la fiche quotidienne correspondante.
- Une modification de référence est réutilisée dans les nouveaux formulaires, sans réécriture historique involontaire.
- Toute création ou mise à jour affiche un résultat explicite ; un échec conserve les valeurs saisies.
- Les communications liées à une tournée ont un lien de contexte et des destinataires vérifiables.
- Les contrôles d'accès restent côté serveur/RLS ; aucun accès inter-organisation n'est introduit.
- Build, tests ciblés et scénarios de validation manuelle sont verts avant fusion.

## Décision d'implémentation

Ne pas réaliser une refonte massive en un seul commit. Commencer par le parcours de plus grande valeur et de plus faible risque : **planning → ouverture d'une tournée quotidienne → données préremplies**, ajouter des tests de non-régression, puis relier les consignes contextuelles. Chaque étape sera livrée dans une PR dédiée pour isoler les régressions.
