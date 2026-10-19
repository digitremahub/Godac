| Section | Écran | URL | chauffeur | manager | manager_chauffeur | comptable | direction | Modules |
|---|---|---|---|---|---|---|---|---|
| Tableau de bord | Tableau de bord | `/dashboard` | ✅ | ✅ | ✅ | ✅ | ✅ | — |
| Tableau de bord | Reporting BI | `/reporting` | — | — | — | — | ✅ | bi_reporting |
| Mon espace | Démarrer une tournée | `/tours/start` | ✅ | — | ✅ | — | — | planning |
| Mon espace | Terminer une tournée | `/tours/end` | ✅ | — | ✅ | — | — | planning |
| Mon espace | J'entre pour un collègue | `/tours/help` | ✅ | ✅ | ✅ | — | 🔒 | planning |
| Mon espace | Mon planning | `/planning/mine` | ✅ | — | ✅ | — | — | planning |
| Mon espace | Mon véhicule | `/my-vehicle` | ✅ | — | ✅ | — | — | — |
| Mon espace | Signaler un problème | `/maintenance` | ✅ | — | — | — | — | maintenance_requests |
| Mon espace | Mes amendes | `/mes-amendes` | ✅ | — | ✅ | — | — | fines |
| Mon espace | Mes fiches de paie | `/payslips` | ✅ | ✅ | ✅ | ✅ | 🔒 | payslips |
| Mon espace | Mon pointage | `/time-clock` | ✅ | 🔒 | 🔒 | ✅ | 🔒 | time_clock |
| Mon espace | Mes congés | `/leaves` | ✅ | 🔒 | 🔒 | ✅ | 🔒 | leave_management |
| Exploitation | Planning | `/planning` | ↪ /planning/mine | ✅ | ✅ | — | ✅ | planning |
| Exploitation | Tournées & villages | `/tours/routes` | ✅ | ✅ | ✅ | — | ✅ | planning?, route_optimizer? |
| Exploitation | Tournées colis | `/colis` | ✅ | ✅ | ✅ | — | ✅ | route_optimizer |
| Exploitation | Suivi en direct | `/suivi` | — | 🔒 | 🔒 | — | 🔒 | route_optimizer |
| Exploitation | Historique des tournées | `/tours/history` | ✅ | ✅ | ✅ | ✅ | ✅ | planning |
| Exploitation | Rapports de tournée | `/reports` | ↪ /tours/history | ✅ | ✅ | ✅ | ✅ | planning |
| Exploitation | Contestations clients | `/contestations` | ✅ | ✅ | ✅ | — | ✅ | customer_disputes |
| Flotte | Véhicules | `/vehicles` | ↪ /my-vehicle | ✅ | ✅ | ✅ | ✅ | fleet |
| Flotte | Fiche véhicule | `/vehicles/[id]` | ↪ /my-vehicle | 🔒 | 🔒 | 🔒 | 🔒 | fleet |
| Flotte | Nouveau véhicule | `/vehicles/new` | — | 🔒 | 🔒 | — | 🔒 | fleet |
| Flotte | Actions rapides véhicule (QR) | `/v/[id]` | 🔒 | 🔒 | 🔒 | 🔒 | 🔒 | — |
| Flotte | Demandes d'entretien | `/maintenance` | 🔒 | ✅ | ✅ | — | ✅ | maintenance_requests |
| Flotte | Demandes aux loueurs | `/loueurs/demandes` | — | ✅ | ✅ | — | ✅ | rental_providers |
| Flotte | Loueurs & prestataires | `/loueurs` | — | ✅ | ✅ | — | ✅ | rental_providers |
| Flotte | Amendes | `/fines` | ↪ /mes-amendes | ✅ | ✅ | ✅ | ✅ | fines |
| Flotte | Badges QR | `/qr-codes` | — | ✅ | ✅ | — | ✅ | — |
| Carburant | Pleins | `/fuel` | ✅ | ✅ | ✅ | ✅ | ✅ | — |
| Carburant | Revue OCR | `/ocr-review` | — | ✅ | ✅ | — | ✅ | ocr |
| Carburant | Cuves & approvisionnements | `/tanks` | — | ✅ | ✅ | ✅ | ✅ | — |
| Carburant | Export TICPE | `/ticpe` | — | — | — | ✅ | ✅ | ticpe_export |
| Carburant | Détail export TICPE | `/ticpe/[id]` | — | — | — | 🔒 | 🔒 | ticpe_export |
| Équipe & RH | Utilisateurs | `/admin/users` | — | ✅ | ✅ | — | ✅ | — |
| Équipe & RH | Fiche salarié | `/admin/users/[id]` | — | 🔒 | 🔒 | 🔒 | 🔒 | — |
| Équipe & RH | Chauffeurs à valider | `/driver-signups` | — | ✅ | ✅ | — | ✅ | — |
| Équipe & RH | Pointage | `/time-clock` | — | ✅ | ✅ | — | ✅ | time_clock |
| Équipe & RH | Congés & absences | `/leaves` | — | ✅ | ✅ | — | ✅ | leave_management |
| Équipe & RH | Calendrier des congés | `/leaves/planning` | — | ✅ | ✅ | — | ✅ | leave_management |
| Équipe & RH | Paie & salaires | `/paie` | — | — | — | ✅ | ✅ | payslips |
| Équipe & RH | Bulletin d'un salarié | `/paie/[userId]` | — | — | — | 🔒 | 🔒 | payslips |
| Équipe & RH | Réglages de paie | `/paie/parametres` | — | — | — | — | 🔒 | payslips |
| Équipe & RH | Salaires | `/payroll` | — | — | — | 🔒 | 🔒 | planning?, time_clock? |
| Communication | Messenger | `/messenger` | ✅ | ✅ | ✅ | ✅ | ✅ | messenger |
| Communication | Intranet & convocations | `/intranet` | ✅ | ✅ | ✅ | ✅ | ✅ | intranet |
| Communication | Alertes | `/alerts` | ✅ | ✅ | ✅ | ✅ | ✅ | — |
| Communication | Demandes d'assistance | `/support` | — | ✅ | ✅ | — | ✅ | assistant |
| Administration | Organisation | `/admin/organizations` | — | — | — | — | ✅ | — |
| Administration | Abonnement & modules | `/admin/billing` | — | — | — | — | ✅ | — |
| Administration | Journal d'audit | `/admin/journal` | — | — | — | — | ✅ | — |
| Administration | FAQ plateforme | `/admin/faq` | 🔒 | 🔒 | 🔒 | 🔒 | 🔒 | — |
| Aide | Guide d'utilisation | `/guide` | ✅ | ✅ | ✅ | ✅ | ✅ | — |
| Aide | Questions fréquentes | `/faq` | ✅ | ✅ | ✅ | ✅ | ✅ | — |
| Aide | Mon compte | `/account` | ✅ | ✅ | ✅ | ✅ | ✅ | — |
