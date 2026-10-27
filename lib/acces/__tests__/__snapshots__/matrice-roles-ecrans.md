| Section | Écran | URL | chauffeur | manager | exploitation | comptable | direction | Modules |
|---|---|---|---|---|---|---|---|---|
| Tableau de bord | Tableau de bord | `/dashboard` | ✅ | ✅ | ✅ | ✅ | ✅ | — |
| Tableau de bord | Faire essayer GO | `/partage-go` | — | — | — | — | — | droit:partage_go |
| Tableau de bord | À traiter aujourd'hui | `/dashboard/a-traiter` | — | 🔒 | 🔒 | — | 🔒 | — |
| Tableau de bord | Reporting BI | `/dashboard/reporting` | — | — | ✅ | ✅ | ✅ | bi_reporting |
| Mon espace | Départ | `/moi/tournee/depart` | ✅ | — | — | — | — | planning |
| Mon espace | Retour | `/moi/tournee/retour` | 🔒 | — | — | — | — | planning |
| Mon espace | Départ ou retour d'un collègue | `/moi/tournee/collegue` | 🔒 | 🔒 | 🔒 | — | 🔒 | planning |
| Mon espace | Ma tournée colis | `/livreur` | ✅ | ↪ /exploitation/colis | ↪ /exploitation/colis | — | ↪ /exploitation/colis | route_optimizer |
| Mon espace | Mon planning | `/moi/planning` | ✅ | — | — | — | — | planning |
| Mon espace | Mon véhicule | `/moi/vehicule` | ✅ | — | — | — | — | — |
| Mon espace | Signaler un problème | `/moi/signaler` | ✅ | 🔒 | 🔒 | — | 🔒 | maintenance_requests |
| Mon espace | Mes amendes | `/moi/amendes` | ✅ | — | — | — | — | fines |
| Mon espace | Mes fiches de paie | `/moi/fiches-de-paie` | ✅ | ✅ | ✅ | ✅ | ↪ /equipe/paie/fiches | payslips |
| Mon espace | Demander un acompte | `/moi/acomptes` | ✅ | ✅ | ✅ | ✅ | ↪ /equipe/paie/acomptes | payslips |
| Mon espace | Mon pointage | `/moi/pointage` | ✅ | ✅ | ✅ | ✅ | ↪ /equipe/pointage | time_clock |
| Mon espace | Mes congés | `/moi/conges` | ✅ | ✅ | ✅ | ✅ | ↪ /equipe/conges | leave_management |
| Mon espace | Mes arrêts de travail | `/moi/arrets` | ✅ | ✅ | ✅ | ✅ | ↪ /equipe/conges/arrets | — |
| Exploitation | Planning | `/exploitation/planning` | ↪ /moi/planning | ✅ | ✅ | — | ✅ | planning |
| Exploitation | Modèles de tournées & villages | `/exploitation/tournees` | ✅ | ✅ | ✅ | — | ✅ | planning?, route_optimizer? |
| Exploitation | Préparation des tournées colis | `/exploitation/colis` | ↪ /livreur | ✅ | ✅ | — | ✅ | route_optimizer |
| Exploitation | GO Navigation | `/livreur/navigation` | ✅ | — | — | — | — | route_optimizer |
| Exploitation | Tournées en cours | `/exploitation/en-cours` | — | ✅ | ✅ | — | ✅ | planning?, route_optimizer? |
| Exploitation | Clôture de la journée | `/exploitation/cloture` | — | ✅ | ✅ | — | ✅ | planning?, route_optimizer? |
| Exploitation | Suivi en direct | `/exploitation/suivi` | — | ✅ | ✅ | — | ✅ | route_optimizer |
| Exploitation | Historique des tournées | `/exploitation/historique` | ✅ | ✅ | ✅ | ✅ | ✅ | planning |
| Exploitation | Rapports de tournée | `/exploitation/historique/rapports` | ↪ /exploitation/historique | 🔒 | 🔒 | 🔒 | 🔒 | planning |
| Exploitation | Photos de tournée | `/exploitation/historique/photos` | ↪ /exploitation/historique | 🔒 | 🔒 | 🔒 | 🔒 | planning |
| Exploitation | Tournées colis passées | `/exploitation/historique/colis` | 🔒 | 🔒 | 🔒 | — | 🔒 | route_optimizer |
| Exploitation | Contestations clients | `/exploitation/contestations` | ✅ | ✅ | ✅ | — | ✅ | customer_disputes |
| Flotte | Véhicules | `/flotte/vehicules` | ↪ /moi/vehicule | ✅ | ✅ | ✅ | ✅ | fleet |
| Flotte | Fiche véhicule | `/flotte/vehicules/[id]` | ↪ /moi/vehicule | 🔒 | 🔒 | 🔒 | 🔒 | fleet |
| Flotte | Nouveau véhicule | `/flotte/vehicules/nouveau` | — | 🔒 | 🔒 | — | 🔒 | fleet |
| Flotte | Actions rapides véhicule (QR) | `/v/[id]` | 🔒 | 🔒 | 🔒 | 🔒 | 🔒 | — |
| Flotte | Demandes d'entretien | `/flotte/entretien` | ↪ /moi/signaler | ✅ | ✅ | — | ✅ | maintenance_requests |
| Flotte | Demandes aux loueurs | `/flotte/loueurs` | — | ✅ | ✅ | — | ✅ | rental_providers |
| Flotte | Loueurs & prestataires | `/flotte/loueurs/prestataires` | — | 🔒 | 🔒 | — | 🔒 | rental_providers |
| Flotte | Amendes | `/flotte/amendes` | ↪ /moi/amendes | ✅ | ✅ | ✅ | ✅ | fines |
| Flotte | Badges QR | `/flotte/badges` | — | ✅ | ✅ | — | ✅ | — |
| Carburant | Pleins | `/carburant/pleins` | ✅ | ✅ | ✅ | ✅ | ✅ | — |
| Carburant | Tickets à vérifier | `/carburant/revue-ocr` | — | ✅ | ✅ | — | ✅ | ocr |
| Carburant | Cuves | `/carburant/cuves` | — | ✅ | ✅ | ✅ | ✅ | — |
| Carburant | Approvisionnements | `/carburant/approvisionnements` | — | 🔒 | 🔒 | 🔒 | 🔒 | — |
| Carburant | TICPE | `/carburant/ticpe` | — | — | ✅ | ✅ | ✅ | ticpe_export |
| Carburant | Documents TICPE | `/carburant/ticpe/documents` | — | — | 🔒 | 🔒 | 🔒 | ticpe_export |
| Carburant | Détail export TICPE | `/carburant/ticpe/[id]` | — | — | 🔒 | 🔒 | 🔒 | ticpe_export |
| Carburant | TICPE : à régler | `/carburant/ticpe/controles` | — | — | 🔒 | 🔒 | 🔒 | ticpe_export |
| Carburant | Véhicules TICPE | `/carburant/ticpe/vehicules` | — | — | 🔒 | 🔒 | 🔒 | ticpe_export |
| Carburant | Réglages TICPE | `/carburant/ticpe/reglages` | — | — | — | 🔒 | 🔒 | ticpe_export |
| Équipe & RH | Utilisateurs | `/equipe/utilisateurs` | — | ✅ | ✅ | — | ✅ | — |
| Équipe & RH | Fiche salarié | `/equipe/utilisateurs/[id]` | — | 🔒 | 🔒 | 🔒 | 🔒 | — |
| Équipe & RH | Chauffeurs à valider | `/equipe/inscriptions` | — | ✅ | ✅ | — | ✅ | — |
| Équipe & RH | Pointage | `/equipe/pointage` | ↪ /moi/pointage | ✅ | ✅ | ↪ /moi/pointage | ✅ | time_clock |
| Équipe & RH | Congés & absences | `/equipe/conges` | ↪ /moi/conges | ✅ | ✅ | ↪ /moi/conges | ✅ | leave_management |
| Équipe & RH | Calendrier des congés | `/equipe/conges/calendrier` | — | 🔒 | 🔒 | — | 🔒 | leave_management |
| Équipe & RH | Arrêts de travail | `/equipe/conges/arrets` | ↪ /moi/arrets | 🔒 | 🔒 | ✅ | 🔒 | — |
| Équipe & RH | Paie & salaires | `/equipe/paie` | — | — | — | ✅ | ✅ | payslips |
| Équipe & RH | Préparer la paie du mois | `/equipe/paie/preparer` | — | — | — | 🔒 | 🔒 | payslips |
| Équipe & RH | Heures & salaires | `/equipe/paie/heures` | — | — | — | 🔒 | 🔒 | planning?, time_clock? |
| Équipe & RH | Fiches de paie | `/equipe/paie/fiches` | — | — | — | 🔒 | 🔒 | payslips |
| Équipe & RH | Demandes d'acompte | `/equipe/paie/acomptes` | ↪ /moi/acomptes | ↪ /moi/acomptes | ↪ /moi/acomptes | 🔒 | 🔒 | payslips |
| Équipe & RH | Journal de paie | `/equipe/paie/journal` | — | — | — | 🔒 | 🔒 | payslips |
| Équipe & RH | Export pour le comptable | `/equipe/paie/export` | — | — | — | 🔒 | 🔒 | payslips |
| Équipe & RH | Réglages de paie | `/equipe/paie/reglages` | — | — | — | — | 🔒 | payslips |
| Équipe & RH | Bulletin d'un salarié | `/equipe/paie/[userId]` | — | — | — | 🔒 | 🔒 | payslips |
| Équipe & RH | Registre du personnel | `/equipe/registre` | — | — | — | — | ✅ | — |
| Communication | Messenger | `/communication/messenger` | ✅ | ✅ | ✅ | ✅ | ✅ | messenger |
| Communication | Intranet & convocations | `/communication/intranet` | ✅ | ✅ | ✅ | ✅ | ✅ | intranet |
| Communication | Notifications | `/communication/alertes` | ✅ | ✅ | ✅ | ✅ | ✅ | — |
| Communication | Demandes d'assistance | `/communication/assistance` | — | ✅ | ✅ | — | ✅ | assistant |
| Administration | Organisation | `/admin/organisation` | — | — | — | — | ✅ | — |
| Administration | Abonnement & modules | `/admin/abonnement` | — | — | — | — | ✅ | — |
| Administration | Journal d'audit | `/admin/journal` | — | — | — | — | ✅ | — |
| Administration | FAQ plateforme | `/admin/faq` | 🔒 | 🔒 | 🔒 | 🔒 | 🔒 | — |
| Aide | Guide d'utilisation | `/aide/guide` | ✅ | ✅ | ✅ | ✅ | ✅ | — |
| Aide | Questions fréquentes | `/aide/faq` | ✅ | ✅ | ✅ | ✅ | ✅ | — |
| Aide | Mon compte | `/account` | ✅ | ✅ | ✅ | ✅ | ✅ | — |
