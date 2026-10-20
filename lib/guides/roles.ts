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
        "Acceptez la localisation quand GODAC la demande : elle sert au moment du pointage et, pendant une tournée colis, à montrer votre dernière position à l'exploitation (vous pouvez la masquer pendant une pause, elle est effacée en fin de tournée). Les notifications vous préviennent d'un changement de planning, d'un message ou d'une alerte.",
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
        titre: "Démarrer et terminer une tournée",
        texte:
          "Au départ : « Démarrer une tournée », choisissez le véhicule et saisissez le kilométrage (photo du compteur si votre entreprise l'exige). Au retour : « Terminer une tournée » avec le kilométrage d'arrivée, la photo du compte-rendu et le nombre de stops de ramasse (inscrit à la main sur la feuille) : ils sont déduits des stops du scan, les colis REMIS comptent comme stops livrés. Si vous changez de véhicule (hors dépannage), photographiez l'habitacle, le tableau de bord et les 4 faces du véhicule récupéré : c'est obligatoire et cela prouve son état à la prise en main. Pour aider un collègue, utilisez « J'entre pour un collègue ».",
        lien: { href: "/moi/tournee/depart", label: "Démarrer une tournée" },
        module: "planning",
      },
      {
        titre: "Les villages de ma tournée",
        texte:
          "« Tournées & villages » donne, en liste, les villages des tournées de votre service (et de celles où vous êtes planifié), dans l'ordre de passage. Un village repris ce jour-là par une tournée de renfort y est signalé « en renfort ». Sur une tournée de renfort, vous y trouvez les villages à couvrir du jour. Votre tableau de bord affiche aussi le contact de votre chef d'équipe.",
        lien: { href: "/exploitation/tournees", label: "Tournées & villages" },
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
          "Page Carburant → nouveau ravitaillement : prenez le ticket en photo, GODAC lit les litres et le montant (à vérifier avant d'enregistrer), puis indiquez le kilométrage.",
        lien: { href: "/carburant/pleins", label: "Carburant" },
      },
      {
        titre: "Mon véhicule et ses papiers",
        texte: "« Mon véhicule » regroupe la carte grise, l'assurance et les contrôles du camion que vous conduisez.",
        lien: { href: "/moi/vehicule", label: "Mon véhicule" },
      },
      {
        titre: "Signaler un problème sur le véhicule",
        texte: "« Demandes d'entretien » : décrivez le problème, ajoutez une photo et choisissez l'urgence. Votre responsable est prévenu.",
        lien: { href: "/moi/signaler", label: "Demandes d'entretien" },
        module: "maintenance_requests",
      },
    ],
  },
  {
    titre: "Tournée colis et application GODAC Livreur",
    etapes: [
      {
        titre: "Charger les colis",
        texte:
          "« Tournée colis » → scannez chaque colis (QR, Datamatrix ou code-barres), ou photographiez l'étiquette. Les adresses et le téléphone du client s'ajoutent tout seuls. Vous pouvez aussi importer un itinéraire Google Maps.",
        lien: { href: "/exploitation/colis", label: "Tournée colis" },
        module: "route_optimizer",
      },
      {
        titre: "Démarrer la livraison",
        texte:
          "« Démarrer la livraison » calcule le meilleur ordre et ouvre l'application chauffeur : l'arrêt en cours en grand, avec Appeler, SMS « j'arrive », Waze ou Google Maps. L'onglet « Carte » montre tous les arrêts et votre position ; en haut de l'écran, les adresses et colis restants et l'heure de fin estimée.",
        lien: { href: "/livreur", label: "Application chauffeur" },
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
      { titre: "Lire les convocations et notes de service", texte: "L'intranet affiche les informations de l'entreprise ; confirmez la lecture des convocations.", lien: { href: "/communication/intranet", label: "Intranet" }, module: "intranet" },
      { titre: "Échanger avec l'équipe", texte: "Messenger remplace les groupes WhatsApp : le groupe de votre équipe, les Infos équipe épinglées, @prénom pour mentionner un collègue ; messages, photos et documents restent dans l'entreprise.", lien: { href: "/communication/messenger", label: "Messenger" }, module: "messenger" },
      { titre: "Consulter mes fiches de paie", texte: "Vos bulletins sont disponibles dans « Fiches de paie », à conserver sans limite de durée.", lien: { href: "/moi/fiches-de-paie", label: "Fiches de paie" }, module: "payslips" },
      { titre: "Répondre à une réclamation client", texte: "Si une contestation vous est attribuée, vous recevez une notification : expliquez ce qui s'est passé dans « Contestations clients ».", lien: { href: "/exploitation/contestations", label: "Contestations" }, module: "customer_disputes" },
    ],
  },
];

const AIDE: SectionGuide = {
  titre: "Besoin d'aide ?",
  etapes: [
    { titre: "Questions fréquentes", texte: "Les réponses aux questions les plus posées.", lien: { href: "/aide/faq", label: "Questions fréquentes" } },
    { titre: "Assistant", texte: "La bulle d'aide en bas de l'écran répond à vos questions sur GODAC et transmet à un responsable si besoin.", module: "assistant" },
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
          "« Planning » affiche la semaine à l'horizontale : affectez chaque chauffeur à une tournée et un véhicule, dupliquez une case, suivez les présences (coche du haut = matin, du bas = soir). Les chauffeurs sont prévenus des changements.",
        lien: { href: "/exploitation/planning", label: "Planning" },
        module: "planning",
      },
      {
        titre: "Tournées, villages et chefs d'équipe",
        texte:
          "Renseignez les villages de chaque tournée et le chef d'équipe (avec son contact) de chaque service. L'onglet « Carte » (réservé aux chefs d'équipe et à la direction) montre les incohérences. Une tournée de renfort emprunte des villages à plusieurs tournées du service : choisissez sa couverture par défaut, puis, si besoin, les villages d'un jour précis ; ils apparaissent « en renfort » sur leur tournée.",
        lien: { href: "/exploitation/tournees", label: "Tournées & villages" }, module: "planning" },
      { titre: "Animer le groupe de l'équipe", texte: "Chaque service a son groupe Messenger, tenu à jour tout seul. Chef d'équipe et managers y publient des Infos équipe épinglées (« vu par X/Y »), peuvent réserver l'écriture aux responsables et créer des groupes ponctuels (« Créer un groupe »). Liez le compte du chef d'équipe dans Organisation > Services.", lien: { href: "/communication/messenger", label: "Messenger" }, module: "messenger" },
      { titre: "Valider les congés", texte: "Acceptez ou refusez les demandes dans « Congés & Absences » ; le chauffeur est notifié.", lien: { href: "/equipe/conges", label: "Congés & Absences" }, module: "leave_management" },
      { titre: "Valider les nouveaux chauffeurs", texte: "Un chauffeur qui s'inscrit avec le lien de l'entreprise attend votre validation dans « Chauffeurs à valider ».", lien: { href: "/equipe/inscriptions", label: "Chauffeurs à valider" } },
      { titre: "Imprimer les badges QR", texte: "« Badges QR » génère les badges de connexion des chauffeurs et des véhicules.", lien: { href: "/flotte/badges", label: "Badges QR" } },
    ],
  },
  {
    titre: "Carburant, flotte et entretien",
    etapes: [
      { titre: "Contrôler les pleins", texte: "La page Carburant liste tous les pleins ; les surconsommations sont signalées dans les alertes.", lien: { href: "/carburant/pleins", label: "Carburant" } },
      { titre: "Vérifier les lectures automatiques", texte: "« Revue OCR » regroupe les tickets et compteurs lus par l'IA à vérifier.", lien: { href: "/carburant/revue-ocr", label: "Revue OCR" }, module: "ocr" },
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
          "« Suivi des tournées » : carte de tous les chauffeurs en livraison (dernière position), arrêts restants, adresses et colis restants et heure de fin estimée, avec un filtre par service. Actualisation toutes les 30 secondes.",
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
      { titre: "Alertes", texte: "Échéances de documents, surconsommation, anomalies de cuve : tout arrive dans « Alertes ».", lien: { href: "/communication/alertes", label: "Alertes" } },
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
    role: "manager_chauffeur",
    titre: "Guide du manager-chauffeur",
    intro: "Vous roulez et vous encadrez : vous avez à la fois les écrans du chauffeur (pointage, tournées, pleins, colis) et ceux du manager (planning, validations, flotte).",
    sections: [DEMARRER_CHAUFFEUR, ...QUOTIDIEN_CHAUFFEUR, ...ENCADREMENT, AIDE],
  },
  {
    role: "comptable",
    titre: "Guide du comptable",
    intro: "Vous retrouvez dans GODAC les données utiles à la comptabilité : carburant, cuves, flotte, fiches de paie et export TICPE.",
    sections: [
      {
        titre: "Vos écrans",
        etapes: [
          { titre: "Carburant", texte: "Tous les pleins avec litres, montants et véhicules ; filtres par période et export.", lien: { href: "/carburant/pleins", label: "Carburant" } },
          { titre: "Cuves et approvisionnements", texte: "Livraisons de carburant en cuve et prix moyen pondéré.", lien: { href: "/carburant/cuves", label: "Cuves" } },
          { titre: "Flotte", texte: "Liste des véhicules et de leurs documents.", lien: { href: "/flotte/vehicules", label: "Flotte" }, module: "fleet" },
          { titre: "Export TICPE", texte: "Préparez le dossier de remboursement partiel de la TICPE sur le gazole professionnel (France).", lien: { href: "/carburant/ticpe", label: "Export TICPE" }, module: "ticpe_export" },
          { titre: "Paie", texte: "Préparez et générez les bulletins du mois. Ils restent en attente jusqu'à la validation de la direction : le salarié ne les voit qu'une fois validés. Un bulletin refusé revient avec le motif, à corriger puis régénérer.", lien: { href: "/equipe/paie", label: "Paie & salaires" }, module: "payslips" },
          { titre: "Alertes et intranet", texte: "Suivez les alertes de l'entreprise et les informations publiées.", lien: { href: "/communication/alertes", label: "Alertes" } },
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
              "Utilisateurs : invitez par e-mail ou créez des chauffeurs à badge, attribuez le rôle (chauffeur, manager, manager-chauffeur, comptable, direction). Au départ d'un salarié, désactivez son compte : l'accès est coupé immédiatement.",
            lien: { href: "/equipe/utilisateurs", label: "Utilisateurs" },
          },
          { titre: "Abonnement et modules", texte: "Activez ou retirez des modules, consultez vos factures.", lien: { href: "/admin/abonnement", label: "Abonnement" } },
          { titre: "Lien d'inscription des chauffeurs", texte: "Partagez le lien d'inscription (page Organisation) : les chauffeurs s'inscrivent et vous les validez.", lien: { href: "/equipe/inscriptions", label: "Chauffeurs à valider" } },
        ],
      },
      {
        titre: "Paie et RH",
        etapes: [
          { titre: "Paie & salaires", texte: "Une seule page, quatre onglets : Bulletins du mois (heures des tournées, congés et frais préremplis ; vérifiez puis générez, France), Heures & salaires (heures et pointages par chauffeur), Fiches de paie (bulletins générés, à télécharger) et Réglages. Faites valider le paramétrage par votre expert-comptable.", lien: { href: "/equipe/paie", label: "Paie & salaires" }, module: "payslips" },
          { titre: "Salaires et heures", texte: "Sans le module Fiches de paie : synthèse des heures et sessions de pointage par chauffeur.", lien: { href: "/equipe/paie/heures", label: "Salaires" }, module: "planning" },
          { titre: "Planning des congés", texte: "Vue d'ensemble des absences de l'équipe.", lien: { href: "/equipe/conges/calendrier", label: "Planning congés" }, module: "leave_management" },
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

export function guideDe(role: string | null | undefined): GuideRole {
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
