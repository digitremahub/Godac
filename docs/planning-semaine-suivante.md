# Planning de la semaine suivante : génération du jeudi, envoi du vendredi 17 h

Document interne. Migrations (additives, rejouables, NON appliquées à la création) : `20261111000001_planning_semaines_auto.sql` (table de suivi et masquage côté chauffeur), `20261111000002_alerte_planning_a_confirmer_type.sql` (valeur d'enum, seule dans son fichier), `20261111000003_alerte_planning_a_confirmer_unique.sql` (dédoublonnage et lecture des alertes). Sans elles, la génération est sautée avec un message et rien ne casse.

## Le flux en 10 lignes

1. **Jeudi, ~5-6 h (Paris)** : `/api/cron/planning-semaine-suivante` (`0 4 * * 4`) génère, pour chaque service d'exploitation, la semaine suivante (lundi → dimanche) en recopiant la semaine en cours (`lib/planning/semaines-auto.ts`).
2. Rien n'est écrasé : une case (tournée × jour) déjà présente est laissée telle quelle ; les tournées **fermées** ne sont pas recopiées ; les modèles de tournées comblent les cases encore vides, sans doublon.
3. Chauffeur en congé (approuvé ou demandé), en arrêt, inactif ou sorti : la case est créée **« à remplacer »**. Les noms sont donnés sans motif (« en congé du 12/11 au 14/11 », « absent »).
4. Les lignes sont **non publiées** : invisibles des chauffeurs (RLS `planning_semaine_masquee`), aucune notification pour eux. Une ligne `planning_semaines_auto` par service et par semaine bloque une seconde génération.
5. Direction, exploitation et managers du service reçoivent l'alerte « Planning du lundi 9 au dimanche 15 novembre généré : à confirmer avant vendredi 17 h » (cloche, push, e-mail) ; « À traiter » la liste (urgente le vendredi).
6. Sur le Planning (vue Semaine), le bandeau montre le résumé et les cases à remplacer. **Confirmer et envoyer aux chauffeurs** publie tout de suite (même fonction que « Publier aux chauffeurs ») ; s'il reste des cases à remplacer, il faut choisir « Envoyer quand même ».
7. Toute modification manuelle (affecter, remplacer, fermer, glisser-déposer, copier…) renseigne `modifie_at` (`noterModificationPlanning`). Un congé approuvé après la génération prévient l'encadrement (alerte `planning_conflict`).
8. **Vendredi 17 h (Paris)** : `/api/cron/planning-envoi-auto`, planifié à 15 h et 16 h UTC (17 h Paris l'été et l'hiver), n'agit que si l'heure de Paris est ≥ 17:00 et reste idempotent.
9. Semaine **non modifiée** : publiée automatiquement (`publie_mode = 'auto'`), chauffeurs notifiés, alerte d'information à l'encadrement. Semaine **modifiée mais non confirmée** : pas d'envoi, rappel critique « confirmez maintenant » (une seule fois), elle reste dans « À traiter ». Réglage : `PUBLICATION_AUTO_SI_MODIFIE` (faux par défaut).
10. Le résumé du vendredi (`weekly-planning-digest`) n'annonce plus que les semaines **publiées**, et pas celles qui viennent de l'être ; le rappel de la veille ignore les semaines non publiées.

## Limites du plan Vercel Hobby

- Une tâche planifiée s'exécute **au plus une fois par jour** (une expression plus fréquente fait échouer tous les déploiements) ; `lib/acces/__tests__/planning-semaine-suivante.test.ts` et les audits de lots gardent `vercel.json`.
- Le déclenchement n'est garanti que **dans l'heure** prévue : l'envoi du vendredi a lieu en pratique entre 17:00 et 17:59 (Paris), pas à la minute.
- Pour 17:00 pile : **Supabase `pg_cron`** (appel HTTP de la route avec `Authorization: Bearer <CRON_SECRET>` à 15:00 et 16:00 UTC le vendredi, la route filtre l'heure de Paris) ou le **plan Vercel Pro** (déclenchement à la minute). Le handler n'a pas à changer.
- Les deux entrées du vendredi portent un paramètre (`?creneau=`) qui ne sert qu'à les distinguer.
