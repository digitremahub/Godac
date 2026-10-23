import type { UserRole } from "@/lib/types/domain";

/**
 * Guides d'utilisation par rôle : une seule source pour la page /aide/guide de
 * l'application (réservée aux entreprises clientes) et pour les pages
 * Notion. Une étape liée à un module n'est affichée que si l'entreprise a
 * activé ce module.
 */
export interface EtapeGuide {
  titre: string;
  texte: string;
  lien?: { href: string; label: string };
  module?: string;
}

export interface SectionGuide {
  titre: string;
  etapes: EtapeGuide[];
}

export interface GuideRole {
  role: UserRole;
  titre: string;
  intro: string;
  sections: SectionGuide[];
}

const DEMARRER_CHAUFFEUR: SectionGuide = {
  titre: "Bien démarrer",
  etapes: [
    {
      titre: "Se connecter",
      texte:
        "Scannez votre badge QR (remis par votre responsable) puis tapez votre code PIN. Vous pouvez aussi vous connecter avec le lien reçu par e-mail. Ne communiquez jamais votre code.",
    },
    {
      titre: "Installer GODAC sur le téléphone",
      texte:
        "Sur Android (Chrome) : menu ⋮ → « Installer l'application ». Sur iPhone (Safari) : bouton Partager → « Sur l'écran d'accueil ». GODAC s'ouvre ensuite comme une application, en plein écran.",
    },
    {
      titre: "Autoriser la localisation et les notifications",
      texte:
        "Acceptez la localisation quand GODAC la demande : elle sert au moment du pointage et, pendant une tournée colis, à montrer votre dernière position à l'exploitation et à enregistrer le trajet emprunté pour l'historique (indication « Trajet enregistré », conservé 1 an). Vous pouvez la masquer pendant une pause (rien n'est alors enregistré) ; la dernière position est effacée en fin de tournée. Les notifications vous préviennent d'un changement de planning, d'un message ou d'une alerte.",
    },
  ],
};

const QUOTIDIEN_CHAUFFEUR: SectionGuide[] = [
  {
    titre: "Ma journée",
    etapes: [
      {
        titre: "Pointer l'arrivée et le départ",
        texte:
          "En arrivant au dépôt, ouvrez GODAC : si le pointage assisté est actif, votre entrée est pointée toute seule (vous pouvez l'annuler). Sinon, touchez « Badger l'entrée ». En fin de journée, GODAC vous propose de badger la sortie.",
        lien: { href: "/moi/pointage", label: "Mon pointage" },
        module: "time_clock",
      },
      {
        titre: "Voir mon planning",
        texte:
          "« Mon planning » affiche vos tournées jour par jour. Les deux coches vertes indiquent votre présence : celle du haut pour le matin, celle du bas pour le soir.",
        lien: { href: "/moi/planning", label: "Mon planning" },
        module: "planning",
      },
      {
        titre: "Départ et retour",
        texte:
          "La tournée, c'est votre affectation du planning (par exemple T106) ; le départ et le retour, c'est la prise et la fin de poste avec le véhicule. Au départ : « Départ » (Mon espace › Ma journée, ou bouton « Départ » en bas de l'écran), choisissez le véhicule et saisissez le kilométrage (photo du compteur si votre entreprise l'exige). Au retour : « Retour » avec le kilométrage d'arrivée, la photo du compte-rendu et le nombre d'arrêts de ramasse (inscrit à la main sur la feuille) : ils sont déduits des arrêts du scan, les colis REMIS comptent comme arrêts livrés. Le bouton « Valider » suffit, sans case à cocher. Si vous changez de véhicule (hors dépannage), photographiez l'habitacle, le tableau de bord et les 4 faces du véhicule récupéré : c'est obligatoire et cela prouve son état à la prise en main. Pour aider un collègue, utilisez « Pour un collègue ».",
        lien: { href: "/moi/tournee/depart", label: "Départ / Retour" },
        module: "planning",
      },
      {
        titre: "Les villages de ma tournée",
        texte:
          "« Modèles de tournées & villages » donne, en liste, les villages des tournées où vous êtes planifié (d'hier à la semaine prochaine), dans l'ordre de passage. Un village repris ce jour-là par une tournée de renfort y est signalé « en renfort ». Sur une tournée de renfort, vous y trouvez les villages à couvrir du jour. Votre tableau de bord affiche aussi le contact de votre chef d'équipe.",
        lien: { href: "/exploitation/tournees", label: "Modèles de tournées & villages" },
        module: "planning",
      },
    ],
  },
  {
    titre: "Carburant et véhicule",
    etapes: [
      {
        titre: "Déclarer un plein",
        texte:
          "Bouton « Plein » de la barre du bas, ou « + Nouveau plein » en haut de la page Pleins (sur ordinateur ou tablette) : prenez le ticket en photo, GODAC lit les litres et le montant (à vérifier avant d'enregistrer), puis indiquez le kilométrage.",
        lien: { href: "/carburant/pleins?new=1", label: "Nouveau plein" },
      },
      {
        titre: "Mon véhicule et ses papiers",
        texte: "« Mon véhicule » regroupe la carte grise, l'assurance et les contrôles du camion que vous conduisez.",
        lien: { href: "/moi/vehicule", label: "Mon véhicule" },
      },
      {
        titre: "Signaler un problème sur le véhicule",
        texte: "« Signaler un problème » : décrivez le problème, ajoutez une photo et choisissez l'urgence. Votre responsable est prévenu.",
        lien: { href: "/moi/signaler", label: "Signaler un problème" },
        module: "maintenance_requests",
      },
    ],
  },
  {
    titre: "Tournée colis : « Ma tournée colis »",
    etapes: [
      {
        titre: "Préparer : charger les colis",
        texte:
          "Ouvrez « Ma tournée colis » (bouton « Colis » en bas de l'écran, ou Mon espace › Ma journée). Scannez chaque colis (QR, Datamatrix ou code-barres), photographiez l'étiquette, importez le bordereau de tournée (DPD, GLS, Colissimo, Chronopost…) ou saisissez une adresse avec son créneau : l'adresse et le téléphone du client s'ajoutent tout seuls. Ramasses et points relais se choisissent à la saisie.",
        lien: { href: "/livreur", label: "Ma tournée colis" },
        module: "route_optimizer",
      },
      {
        titre: "Démarrer, puis livrer",
        texte:
          "« Vérifier la tournée et démarrer » contrôle les villages, calcule le meilleur ordre et passe à la livraison sur le même écran : l'arrêt en cours en grand, avec Appeler, SMS « j'arrive », Waze ou Google Maps. Un colis en plus ? « Ajouter ou modifier des colis », sans quitter la tournée. Quand tous les arrêts sont traités, « Clôturer la tournée colis » la verrouille ; vous pouvez ensuite en ouvrir une supplémentaire.",
        lien: { href: "/livreur", label: "Ma tournée colis" },
        module: "route_optimizer",
      },
      {
        titre: "GO Navigation (avant-première)",
        texte:
          "Une fois la tournée colis démarrée, « GO Navigation » (menu, ou onglet de « Ma tournée colis ») ouvre la carte plein écran avec le trajet vers l'arrêt en cours. Waze et Google Maps restent disponibles.",
        lien: { href: "/livreur/navigation", label: "GO Navigation" },
        module: "route_optimizer",
      },
      {
        titre: "Valider une livraison",
        texte:
          "Touchez « Livré » et indiquez où vous avez déposé le colis. La photo est obligatoire pour une boîte aux lettres ou un jardin, conseillée sinon : elle vous protège en cas de réclamation.",
        module: "route_optimizer",
      },
    ],
  },
  {
    titre: "Équipe et documents",
    etapes: [
      { titre: "Demander un congé", texte: "« Congés & Absences » → nouvelle demande. Vous êtes prévenu dès que votre responsable l'a validée.", lien: { href: "/moi/conges", label: "Mes congés" }, module: "leave_management" },
      { titre: "Déclarer un arrêt de travail", texte: "Mes demandes › Arrêts → « Déclarer un arrêt de travail » : photographiez seulement le volet destiné à l'employeur (jamais le volet 1, qui contient des informations médicales), vérifiez les dates, envoyez. À faire sous 48 h. Votre responsable et le planning sont prévenus ; vos heures et votre bulletin en tiennent compte.", lien: { href: "/moi/arrets", label: "Mes arrêts" } },
      { titre: "Lire les convocations et notes de service", texte: "L'intranet affiche les informations de l'entreprise ; confirmez la lecture des convocations.", lien: { href: "/communication/intranet", label: "Intranet" }, module: "intranet" },
      { titre: "Échanger avec l'équipe", texte: "Messenger remplace les groupes WhatsApp : le groupe de votre équipe, les Infos équipe épinglées, @prénom pour mentionner un collègue ; messages, photos et documents restent dans l'entreprise.", lien: { href: "/communication/messenger", label: "Messenger" }, module: "messenger" },
      { titre: "Consulter mes fiches de paie", texte: "Une notification vous prévient dès que la direction a validé votre bulletin ; il est alors disponible dans « Mes fiches de paie », à conserver sans limite de durée.", lien: { href: "/moi/fiches-de-paie", label: "Fiches de paie" }, module: "payslips" },
      { titre: "Répondre à une réclamation client", texte: "Si une contestation vous est attribuée, vous recevez une notification : expliquez ce qui s'est passé dans « Contestations clients ».", lien: { href: "/exploitation/contestations", label: "Contestations" }, module: "customer_disputes" },
    ],
  },
];

const AIDE: SectionGuide = {
  titre: "Besoin d'aide ?",
  etapes: [
    { titre: "Questions fréquentes", texte: "Les réponses aux questions les plus posées.", lien: { href: "/aide/faq", label: "Questions fréquentes" } },
    { titre: "Assistant", texte: "La bulle d'aide en bas de l'écran répond à vos questions sur GODAC et transmet à un responsable si besoin.", module: "assistant" },
    {
      titre: "Qui décide de mes demandes ?",
      texte:
        "Personne ne décide de sa propre demande. Une demande (congé, arrêt, acompte, entretien, rendez-vous…) est traitée par le niveau juste au-dessus : le manager de votre service pour un chauffeur, l'exploitation ou la direction pour un manager, la direction pour l'exploitation, et une autre personne de la direction pour la direction (une direction seule dans l'entreprise peut valider la sienne, c'est alors inscrit au journal). Dans « Mon espace », une demande en cours indique « En attente de… » ; dans les écrans de gestion, une demande que vous ne pouvez pas décider s'affiche en lecture seule avec « À décider par… ».",
    },
    { titre: "Mon compte", texte: "Nom, téléphone, mode sombre et taille du texte se règlent dans « Mon compte ».", lien: { href: "/account", label: "Mon compte" } },
  ],
};

const ENCADREMENT: SectionGuide[] = [
  {
    titre: "Planning et équipes",
    etapes: [
      {
        titre: "Construire le planning",
        texte:
          "« Planning » s'ouvre sur le jour, avec la semaine et le mois : glissez un chauffeur sur une tournée (sur téléphone, touchez la tournée puis choisissez le chauffeur), y compris le samedi. « Toute la semaine » permet de choisir les jours à remplir. Publiez pour prévenir les chauffeurs.",
        lien: { href: "/exploitation/planning", label: "Planning" },
        module: "planning",
      },
      {
        titre: "Modèles de tournées, villages et chefs d'équipe",
        texte:
          "Renseignez les villages de chaque modèle de tournée et le chef d'équipe (avec son contact) de chaque service. L'onglet « Carte » (réservé aux chefs d'équipe et à la direction) montre les incohérences. Une tournée de renfort emprunte des villages à plusieurs tournées du service : choisissez sa couverture par défaut, puis, si besoin, les villages d'un jour précis ; ils apparaissent « en renfort » sur leur tournée.",
        lien: { href: "/exploitation/tournees", label: "Modèles de tournées & villages" }, module: "planning" },
      { titre: "Animer le groupe de l'équipe", texte: "Chaque service a son groupe Messenger, tenu à jour tout seul. Chef d'équipe et managers y publient des Infos équipe épinglées (« vu par X/Y »), peuvent réserver l'écriture aux responsables et créer des groupes ponctuels (« Créer un groupe »). Liez le compte du chef d'équipe dans Organisation > Services.", lien: { href: "/communication/messenger", label: "Messenger" }, module: "messenger" },
      { titre: "Valider les congés", texte: "Acceptez ou refusez les demandes dans « Congés & Absences » ; le chauffeur est notifié.", lien: { href: "/equipe/conges", label: "Congés & Absences" }, module: "leave_management" },
      { titre: "Arrêts de travail", texte: "Congés & absences › Arrêts de travail : vérifiez l'avis reçu, validez ou refusez (motif envoyé au salarié). Les tournées du salarié pendant l'arrêt sont listées : « Libérer » les laisse au planning sans chauffeur, à réattribuer. Vous pouvez aussi saisir l'arrêt d'un salarié.", lien: { href: "/equipe/conges/arrets", label: "Arrêts de travail" } },
      { titre: "Valider les nouveaux chauffeurs", texte: "Un chauffeur qui s'inscrit avec le lien de l'entreprise attend votre validation dans « Chauffeurs à valider ».", lien: { href: "/equipe/inscriptions", label: "Chauffeurs à valider" } },
      { titre: "Imprimer les badges QR", texte: "« Badges QR » génère les badges de connexion des chauffeurs et des véhicules.", lien: { href: "/flotte/badges", label: "Badges QR" } },
    ],
  },
  {
    titre: "Carburant, flotte et entretien",
    etapes: [
      { titre: "Traiter les écarts carburant", texte: "La tuile « Écarts carburant à traiter » de l'accueil ouvre la page Pleins filtrée sur « À traiter » : ouvrez « Détails » pour justifier, classer ou demander une explication au chauffeur.", lien: { href: "/carburant/pleins?a_traiter=1", label: "Écarts à traiter" } },
      { titre: "Vérifier les tickets", texte: "« Tickets à vérifier » regroupe les tickets et compteurs lus automatiquement, à confirmer avant enregistrement.", lien: { href: "/carburant/revue-ocr", label: "Tickets à vérifier" }, module: "ocr" },
      { titre: "Suivre les cuves", texte: "Niveaux, approvisionnements et index des cuves dans « Cuves & Approvisionnements ».", lien: { href: "/carburant/cuves", label: "Cuves" } },
      { titre: "Gérer la flotte", texte: "Fiche de chaque véhicule : documents, échéances (contrôle technique, assurance), kilométrage.", lien: { href: "/flotte/vehicules", label: "Flotte" }, module: "fleet" },
      { titre: "Traiter les demandes d'entretien", texte: "Prenez en charge les signalements des chauffeurs selon leur urgence.", lien: { href: "/flotte/entretien", label: "Demandes d'entretien" }, module: "maintenance_requests" },
    ],
  },
  {
    titre: "Suivi et relation client",
    etapes: [
      {
        titre: "Suivre les tournées en direct",
        texte:
          "« Suivi des tournées » : carte de tous les chauffeurs en livraison (dernière position), arrêts restants, adresses et colis restants et heure de fin estimée, avec un filtre par service. Actualisation toutes les 30 secondes. Le bouton « Saisir un départ ou un retour » en haut de la page enregistre le départ ou le retour d'un chauffeur à sa place (badge et code).",
        lien: { href: "/exploitation/suivi", label: "Suivi des tournées" },
        module: "route_optimizer",
      },
      { titre: "Rapports de tournée", texte: "Kilométrages, horaires et rapports de chaque tournée terminée.", lien: { href: "/exploitation/historique/rapports", label: "Rapports de tournée" }, module: "planning" },
      {
        titre: "Contestations clients",
        texte:
          "Déposez la réclamation (photo ou PDF) : GODAC la lit et propose le chauffeur concerné. Vous validez avant toute notification ; la photo de livraison s'affiche quand la livraison est retrouvée.",
        lien: { href: "/exploitation/contestations", label: "Contestations" },
        module: "customer_disputes",
      },
      { titre: "Notifications", texte: "Échéances de documents, surconsommation, anomalies de cuve : tout arrive dans « Notifications ». Les non lues s'affichent en premier ; « Marquer comme lu » vaut pour vous seul.", lien: { href: "/communication/alertes", label: "Notifications" } },
      { titre: "Demandes d'assistance", texte: "Les questions transmises par l'assistant à un humain arrivent ici.", lien: { href: "/communication/assistance", label: "Demandes d'assistance" }, module: "assistant" },
    ],
  },
];

export const GUIDES: GuideRole[] = [
  {
    role: "chauffeur",
    titre: "Guide du chauffeur",
    intro: "GODAC regroupe sur votre téléphone votre planning, vos tournées, vos pleins, vos papiers et vos échanges avec l'équipe. Voici l'essentiel pour bien l'utiliser.",
    sections: [DEMARRER_CHAUFFEUR, ...QUOTIDIEN_CHAUFFEUR, AIDE],
  },
  {
    role: "manager",
    titre: "Guide du manager",
    intro: "Vous organisez l'activité de votre service : planning, chauffeurs, carburant, véhicules et réclamations. Ce guide reprend vos tâches courantes.",
    sections: [...ENCADREMENT, AIDE],
  },
  {
    role: "exploitation",
    titre: "Guide de l'exploitation",
    intro:
      "Vous faites le lien entre la direction et les managers : vous voyez tout ce que voit un manager, sur toute l'entreprise et pas seulement un service, et vous gérez les comptes des chauffeurs et des managers. La paie, l'abonnement, les réglages de l'entreprise et le journal d'audit restent à la direction.",
    sections: [
      {
        titre: "Toute l'entreprise",
        etapes: [
          { titre: "Planning et tournées de tous les services", texte: "Affectez, suivez en direct et consultez l'historique et les tracés GPS des tournées de tous les services, villages et Tournée colis compris.", lien: { href: "/exploitation/planning", label: "Planning" }, module: "planning" },
          { titre: "Carburant, cuves et écarts", texte: "Traitez les écarts de carburant et suivez les cuves de toute l'entreprise. La TICPE (montants, contrôles et documents) est consultable et téléchargeable.", lien: { href: "/carburant/pleins", label: "Carburant" } },
          { titre: "Flotte, entretien, loueurs et amendes", texte: "Tous les véhicules, les demandes d'entretien, les loueurs, les amendes et les contestations ; vous validez comme responsable, comme un manager ou la direction.", lien: { href: "/flotte/vehicules", label: "Flotte" }, module: "fleet" },
          { titre: "Congés", texte: "Vous validez les congés de toute l'entreprise.", lien: { href: "/equipe/conges", label: "Congés" }, module: "leave_management" },
          { titre: "Reporting", texte: "Indicateurs d'exploitation consolidés : carburant, consommation, activité (sans la paie).", lien: { href: "/dashboard/reporting", label: "Reporting BI" }, module: "bi_reporting" },
        ],
      },
      {
        titre: "Comptes chauffeur et manager",
        etapes: [
          {
            titre: "Créer, désactiver, rattacher",
            texte:
              "Utilisateurs : créez des chauffeurs (e-mail ou badge) et des managers, désactivez un compte, choisissez ses services, cochez « Conduit aussi » et réinitialisez un code PIN. Les comptes direction, comptable et exploitation ne se gèrent que par la direction.",
            lien: { href: "/equipe/utilisateurs", label: "Utilisateurs" },
          },
        ],
      },
      ...ENCADREMENT,
      AIDE,
    ],
  },
  {
    role: "comptable",
    titre: "Guide du comptable",
    intro: "Vous retrouvez dans GODAC les données utiles à la comptabilité : carburant, cuves, flotte, fiches de paie et TICPE (montants calculés à chaque plein et documents prêts pour la déclaration).",
    sections: [
      {
        titre: "Vos écrans",
        etapes: [
          { titre: "Carburant", texte: "Tous les pleins avec litres, montants et véhicules ; filtres par période et export.", lien: { href: "/carburant/pleins", label: "Carburant" } },
          { titre: "Cuves et approvisionnements", texte: "Livraisons de carburant en cuve et prix moyen pondéré.", lien: { href: "/carburant/cuves", label: "Cuves" } },
          { titre: "Flotte", texte: "Liste des véhicules et de leurs documents.", lien: { href: "/flotte/vehicules", label: "Flotte" }, module: "fleet" },
          { titre: "TICPE", texte: "Suivez le montant récupérable et la prochaine échéance, levez les contrôles (justificatifs, doublons, plafond), puis téléchargez le récapitulatif pour l'annexe 3310-TIC, l'état annuel par véhicule et le dossier de contrôle. La déclaration reste faite par l'entreprise ou son expert-comptable.", lien: { href: "/carburant/ticpe", label: "TICPE" }, module: "ticpe_export" },
          { titre: "Paie", texte: "Préparez et générez les bulletins du mois. Ils restent en attente jusqu'à la validation de la direction : le salarié ne les voit qu'une fois validés. Un bulletin refusé revient avec le motif, à corriger puis régénérer.", lien: { href: "/equipe/paie", label: "Paie & salaires" }, module: "payslips" },
          { titre: "Arrêts et heures", texte: "Les arrêts déclarés (non refusés) arrivent seuls dans le bulletin du mois : saisissez-y les IJSS du relevé CPAM. Les heures sont préremplies (pointage, sinon planning prévu ou retour de tournée) avec un contrôle jour par jour à vérifier.", lien: { href: "/equipe/conges/arrets", label: "Arrêts de travail" } },
          { titre: "Notifications et intranet", texte: "Suivez les notifications de l'entreprise et les informations publiées.", lien: { href: "/communication/alertes", label: "Notifications" } },
        ],
      },
      AIDE,
    ],
  },
  {
    role: "direction",
    titre: "Guide de la direction",
    intro: "Vous pilotez l'entreprise dans GODAC : réglages, utilisateurs, abonnement, paie et indicateurs, en plus de tous les écrans de l'encadrement.",
    sections: [
      {
        titre: "Mettre en place GODAC",
        etapes: [
          {
            titre: "Régler l'organisation",
            texte:
              "Organisation : pays de l'entreprise (règles légales appliquées), logo et couleur, adresse du dépôt, identité légale, services et leurs dépôts, cuves, pointage assisté par géolocalisation (actif par défaut, à annoncer aux salariés).",
            lien: { href: "/admin/organisation", label: "Organisation" },
          },
          {
            titre: "Inviter les utilisateurs et choisir leur rôle",
            texte:
              "Utilisateurs : invitez par e-mail ou créez des chauffeurs à badge, attribuez le rôle (chauffeur, manager, exploitation, comptable, direction) ; cochez « Conduit aussi » pour un manager ou une personne de l'exploitation qui roule, ou passez un chauffeur manager depuis sa fiche. Au départ d'un salarié, désactivez son compte : l'accès est coupé immédiatement.",
            lien: { href: "/equipe/utilisateurs", label: "Utilisateurs" },
          },
          { titre: "Abonnement et modules", texte: "Activez ou retirez des modules, consultez vos factures.", lien: { href: "/admin/abonnement", label: "Abonnement" } },
          { titre: "Lien d'inscription des chauffeurs", texte: "Partagez le lien d'inscription (page Organisation) : les chauffeurs s'inscrivent et vous les validez.", lien: { href: "/equipe/inscriptions", label: "Chauffeurs à valider" } },
        ],
      },
      {
        titre: "Paie et RH",
        etapes: [
          { titre: "Valider les bulletins du mois", texte: "Le comptable prépare et génère les bulletins ; rien ne prend effet sans votre validation. La tuile « Bulletins à valider » de l'accueil (et la notification) ouvre Paie & salaires : vérifiez, puis « Valider » (ou tout valider), ou refusez avec un motif. Chaque salarié est prévenu dès que son bulletin est validé.", lien: { href: "/equipe/paie", label: "Bulletins à valider" }, module: "payslips" },
          { titre: "Paie & salaires", texte: "Une seule page et ses onglets : Bulletins du mois (heures des tournées, congés et frais préremplis ; vérifiez, générez et validez, France), Fiches de paie (bulletins générés et leur statut, à télécharger), Acomptes (demandes des salariés, à accepter ou refuser), Journal, Export comptable et Réglages. Faites valider le paramétrage par votre expert-comptable.", lien: { href: "/equipe/paie", label: "Paie & salaires" }, module: "payslips" },
          { titre: "Heures & salaires", texte: "Sans le module Fiches de paie : synthèse des heures et sessions de pointage par chauffeur.", lien: { href: "/equipe/paie/heures", label: "Salaires" }, module: "planning" },
          { titre: "Planning des congés", texte: "Vue d'ensemble des absences de l'équipe.", lien: { href: "/equipe/conges/calendrier", label: "Planning congés" }, module: "leave_management" },
          { titre: "Arrêts de travail", texte: "Arrêts déclarés par les salariés : à vérifier, puis repris automatiquement dans les bulletins et les heures. Réglez la source des heures du bulletin dans Paie › Réglages.", lien: { href: "/equipe/conges/arrets", label: "Arrêts de travail" } },
          { titre: "Amendes", texte: "Enregistrez les avis de contravention et désignez le conducteur dans les délais.", lien: { href: "/flotte/amendes", label: "Amendes" }, module: "fines" },
        ],
      },
      ...ENCADREMENT,
      {
        titre: "Pilotage",
        etapes: [{ titre: "Reporting BI", texte: "Indicateurs consolidés : coûts carburant, consommation, activité.", lien: { href: "/dashboard/reporting", label: "Reporting BI" }, module: "bi_reporting" }],
      },
      AIDE,
    ],
  },
];

/** Manager (ou exploitation) qui conduit aussi (users.can_drive) : écrans du chauffeur et de l'encadrement. */
export const GUIDE_MANAGER_CONDUCTEUR: GuideRole = {
  role: "manager",
  titre: "Guide du manager qui conduit",
  intro: "Vous roulez et vous encadrez : vous avez à la fois les écrans du chauffeur (Mon espace : tournées, planning, véhicule ; pleins, colis) et ceux du manager (planning, validations, flotte).",
  sections: [DEMARRER_CHAUFFEUR, ...QUOTIDIEN_CHAUFFEUR, ...ENCADREMENT, AIDE],
};

/** Exploitation qui conduit aussi : son guide, précédé des écrans du chauffeur. */
function guideExploitationConducteur(): GuideRole {
  const base = GUIDES.find((g) => g.role === "exploitation")!;
  return { ...base, titre: "Guide de l'exploitation qui conduit", sections: [DEMARRER_CHAUFFEUR, ...QUOTIDIEN_CHAUFFEUR, ...base.sections] };
}

/**
 * Compte d'essai GO Navigation (offre go_navigation) : un guide dédié en
 * 5 étapes, limité à ce que l'essai ouvre (Tournée colis, GO Navigation,
 * historique, Mon compte), au lieu du guide complet du manager qui conduit.
 */
export const GUIDE_GO_NAVIGATION: GuideRole = {
  role: "manager",
  titre: "Guide GO Navigation",
  intro:
    "GO Navigation est présentée en avant-première : chargez vos colis, laissez GODAC calculer l'ordre de passage, puis laissez-vous guider d'arrêt en arrêt. Voici les 5 étapes d'une tournée.",
  sections: [
    {
      titre: "Votre tournée en 5 étapes",
      etapes: [
        {
          titre: "Créer la tournée",
          texte: "Ouvrez « Tournée colis » puis « + Nouvelle tournée colis ». Une tournée colis par jour suffit ; vous la retrouvez à chaque connexion.",
          lien: { href: "/exploitation/colis", label: "Tournée colis" },
        },
        {
          titre: "Ajouter les colis",
          texte:
            "Scannez chaque colis (QR, Datamatrix ou code-barres) ou photographiez l'étiquette : l'adresse et le téléphone du client s'ajoutent tout seuls. Vérifiez une adresse mal lue avant de continuer.",
          lien: { href: "/exploitation/colis", label: "Tournée colis" },
        },
        {
          titre: "Optimiser l'ordre de passage",
          texte: "Touchez « Optimiser » : GODAC calcule le meilleur ordre des arrêts et l'heure de fin estimée. Vous pouvez encore déplacer un arrêt à la main.",
          lien: { href: "/exploitation/colis", label: "Tournée colis" },
        },
        {
          titre: "Démarrer GO Navigation",
          texte:
            "« Ouvrir GO Navigation » (ou le bouton « GO Navigation » en bas de l'écran sur téléphone) : carte plein écran, trajet vers l'arrêt en cours et toute la tournée dans une feuille glissable. Waze et Google Maps restent disponibles sur chaque arrêt.",
          lien: { href: "/livreur/navigation", label: "GO Navigation" },
        },
        {
          titre: "Livrer et terminer",
          texte:
            "À chaque arrêt, touchez « Livré » et indiquez où vous avez déposé le colis (photo obligatoire pour une boîte aux lettres ou un jardin). Les tournées terminées restent consultables dans « Tournées colis passées ».",
          lien: { href: "/exploitation/historique/colis", label: "Tournées colis passées" },
        },
      ],
    },
    {
      titre: "Besoin d'aide ?",
      etapes: [
        { titre: "Questions fréquentes", texte: "Les réponses aux questions les plus posées.", lien: { href: "/aide/faq", label: "Questions fréquentes" } },
        { titre: "Mon compte", texte: "Nom, téléphone, mode sombre et taille du texte se règlent dans « Mon compte ».", lien: { href: "/account", label: "Mon compte" } },
      ],
    },
  ],
};

export function guideDe(role: string | null | undefined, conduit = false, { goNavigation = false }: { goNavigation?: boolean } = {}): GuideRole {
  if (goNavigation) return GUIDE_GO_NAVIGATION;
  if (role === "manager" && conduit) return GUIDE_MANAGER_CONDUCTEUR;
  if (role === "exploitation" && conduit) return guideExploitationConducteur();
  return GUIDES.find((g) => g.role === role) ?? GUIDES[0]!;
}

/** Guide filtré : sans les étapes des modules que l'entreprise n'a pas. */
export function guideFiltre(guide: GuideRole, modulesActifs: string[]): GuideRole {
  const actifs = new Set(modulesActifs);
  return {
    ...guide,
    sections: guide.sections
      .map((s) => ({ ...s, etapes: s.etapes.filter((e) => !e.module || actifs.has(e.module)) }))
      .filter((s) => s.etapes.length > 0),
  };
}
