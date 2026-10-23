# Hiérarchie des demandes et des décisions

Règle fixe (pas de réglage) : chauffeur (0) < manager (1) < exploitation (2) < direction (3).
Le comptable est hors chaîne : il garde ses droits sur la paie, ne décide pas des demandes opérationnelles, et sa propre demande est décidée par la direction. « Conduit » (can_drive) ne change pas le rang.

1. Personne ne décide ni ne résout sa propre demande.
2. Le décideur a un rang strictement supérieur. La direction décide pour une autre personne de la direction ; une direction seule dans l'organisation peut décider la sienne, tracée « auto-validée (direction unique) » au journal d'audit.
3. Un manager reste limité aux services de ses chauffeurs.
4. Les alertes montent d'un niveau (manager du service pour un chauffeur ; exploitation + direction pour un manager ; direction pour une exploitation ; autres membres de la direction pour la direction), avec escalade si le niveau est vide.

Code : `lib/hierarchie/demandes.ts` (règles pures, testées), `lib/hierarchie/serveur.ts` (garde `garderDecision`, routage `alerterNiveauSuperieur`), migration `20261101000001_hierarchie_demandes.sql` (même règle en base).

## Inventaire

« Demandeur » = la personne dont la demande est décidée. « Avant » = faille constatée avant ce lot.

| Domaine (route) | Qui crée | Qui décide | Demandeur | Avant : décision sur sa propre demande | Garde ajouté |
|---|---|---|---|---|---|
| Congés (`/api/leaves`, `[id]`, `[id]/replacement`) | tout salarié | manager (son service), exploitation, direction | `driver_id` | un manager ou une exploitation approuvait son propre congé | garde route + trigger `leave_requests_hierarchie` |
| Arrêts de travail (`/api/arrets`, `[id]`, `[id]/liberer`) | le salarié (statut « reçu ») ; l'encadrement ou la paie saisit pour un autre (directement « validé ») | manager, exploitation, direction, comptable (paie) | `user_id` | la direction validait le sien ; la saisie « validée » pour un pair de même rang passait | garde route (paie : comptable garde ses droits) + trigger `work_stoppages_hierarchie` (insert et update) |
| Acomptes (`/api/paie/acomptes`, `[id]`) | tout salarié | direction (accepte, refuse) ; comptable prépare et marque versé | `user_id` | la direction acceptait le sien ; le comptable préparait et versait le sien | garde route + trigger `salary_advance_requests_hierarchie` |
| Bulletins (`/api/paie/bulletins/validation`) | généré par la paie | direction | `user_id` du bulletin | la direction validait son propre bulletin | contrôle par bulletin + trigger `payslips_hierarchie` |
| Amendes (`/api/fines`, `[id]`) | encadrement | manager (véhicules de son service), exploitation, direction | chauffeur désigné (`driver_id`) | un manager se désignait ou réglait sa propre amende | garde route + trigger `fines_hierarchie` |
| Contestations (`/api/contestations`, `[id]`) | encadrement | manager, exploitation, direction | chauffeur attributaire (`driver_id`) | idem (désigner, clôturer) ; la réponse du chauffeur alertait tous les managers, lui compris | garde route + trigger `customer_disputes_hierarchie` + alertes au niveau supérieur |
| Demandes d'entretien (`/api/vehicle-interventions`, `[id]`) | tout membre | manager, exploitation, direction | `requested_by` | un manager planifiait ou clôturait sa propre demande | garde route (statut, planification, clôture) + trigger `vehicle_interventions_hierarchie` |
| Demandes au loueur (`/api/rental-requests`, `[id]`) | générée par l'entretien d'un véhicule loué | manager, exploitation, direction | auteur de l'entretien d'origine | idem | garde route + trigger `rental_maintenance_requests_hierarchie` |
| Rendez-vous (`/api/meeting-requests`, `[id]`) | tout membre sauf direction | manager, exploitation, direction | `requested_by` | un manager traitait sa propre demande | garde route + trigger `meeting_requests_hierarchie` |
| Assistance (`/api/support-requests/[id]`) | tout membre (via l'assistant) | manager, exploitation, direction | `requested_by` | idem | garde route + trigger `support_requests_hierarchie` |
| Convocations (`/api/convocations`, `[id]`) | encadrement | manager, exploitation, direction | `employee_id` (convoqué) | on pouvait se convoquer, ou convoquer un pair | garde route + trigger `convocations_hierarchie` |
| Écarts carburant (`/api/fuel-entries/[id]/ecart`) | traitement par l'encadrement | manager, exploitation, direction | conducteur du plein | la direction traitait l'écart de son propre plein ; un manager traitait celui d'un autre manager | `droitsEcart` (hiérarchie) + trigger `fuel_gap_reviews_hierarchie` |

Alertes de création routées au niveau supérieur (base) : rendez-vous, assistance, entretien, acompte. Alertes routées côté serveur : arrêts (`notifierArret`), réponse et suite chauffeur d'une contestation (`notifier`), réponse sur un écart carburant.

## Hors périmètre (pas de demande/décision de hiérarchie)

| Domaine | Pourquoi |
|---|---|
| Validation d'un plein par son conducteur (`/api/fuel-entries/[id]` avec `validate`) | confirmation de sa propre saisie (ticket lu), pas une décision ; seul le traitement de l'écart est une décision |
| Inscriptions de chauffeurs (`/api/driver-signups/[id]/approve`, `reject`) | le demandeur n'est pas encore membre (aucun rang) ; périmètre déjà borné par `canManagePendingDriver` |
| Livraisons de cuve (`/api/tank-deliveries/[id]` suppression) | opération, sans demandeur |
| Publication du planning (`/api/planning/publier`) | publication d'un service, pas une demande ; un manager qui conduit y figure comme les autres (limite connue) |
| Pointage assisté, remise des bulletins, PIN | actions personnelles, pas de décision |
