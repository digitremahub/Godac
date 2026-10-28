import Link from "next/link";
import { Article, LegalPageLayout, listeLegale } from "@/components/legal/LegalPageLayout";
import { EDITEUR, designationEditeur } from "@/lib/legal/editeur";

export const metadata = { title: "Accord de sous-traitance des données (RGPD) — GODAC" };

const lien = "text-teal-ink hover:underline";
const cellule = "border border-navy/10 px-2 py-1.5 align-top";

/** Traitements réalisés pour le compte du Client (annexe 1). */
const TRAITEMENTS: [string, string, string][] = [
  ["Comptes et rôles", "Salariés et dirigeants du Client", "Nom, prénom, e-mail, téléphone, rôle, service, code chauffeur, code PIN chiffré, clés de connexion"],
  ["Carburant, flotte et TICPE", "Chauffeurs", "Pleins, kilométrages, photos de tickets et de compteurs, véhicule utilisé, cartes grises des véhicules"],
  ["Planning, tournées, congés", "Chauffeurs et encadrement", "Affectations, horaires, tournées, absences et congés"],
  ["Pointage", "Salariés", "Heures de pointage, position GPS au moment du pointage ; si le pointage assisté est utilisé : lecture ponctuelle de la position (environ chaque minute, application ouverte et visible) pour détecter l’arrivée au dépôt ou la sortie, seule l’heure de dernière présence au dépôt étant mémorisée. Position de pointage conservée 2 mois (preuve du temps de travail en cas de litige), puis supprimée ; les heures sont conservées"],
  ["Messagerie, intranet, alertes", "Salariés", "Messages, pièces jointes, convocations, notifications"],
  ["Amendes", "Conducteurs", "Avis de contravention (données relatives à des infractions routières), véhicule, conducteur désigné"],
  ["Absences et arrêts de travail", "Salariés", "Dates, type d’arrêt, prolongation, photo du volet destiné à l’employeur (jamais le volet médical) ; congés"],
  ["Paie (si souscrit)", "Salariés", "Rémunération, contrat, heures, primes, absences, frais, acomptes, retenues et saisies sur salaire (saisie, ATD, pension), numéro de sécurité sociale, date de naissance, coordonnées bancaires éventuelles, taux de prélèvement à la source, bulletins et documents de sortie"],
  ["Registre unique du personnel (si souscrit)", "Salariés", "Identité, date et lieu de naissance, nationalité, titre de travail, qualification, dates d’entrée et de sortie"],
  ["Tournée colis (si souscrit)", "Destinataires des colis du Client, chauffeurs", "Nom, adresse, téléphone, photo du colis déposé (nom réduit aux initiales, téléphone et consignes effacés à 30 jours ; adresses et photos conservées 12 mois pour les contestations) ; dernière position du chauffeur pendant la tournée en cours (effacée à la clôture) et trajet emprunté pendant la tournée en cours, pour l'analyse des trajets (conservé 1 an)"],
  ["Annuaire client de tournée (si Tournée colis souscrite)", "Destinataires professionnels du Client (établissements, points relais), chauffeurs", "Nom de l’établissement, contact habituel et téléphone, consignes d’accès (code, stationnement), horaires d’ouverture et créneaux, durée moyenne d’arrêt, heures de livraison réussie, motifs d’échec, contacts déjà faits ; ordre habituel des villages d’une tournée. Réservé à l’organisation du Client, conservé 12 mois sans mise à jour puis supprimé, effaçable à tout moment par le Client, supprimé avec le compte à la fin du contrat"],
  ["Stock (si souscrit)", "Salariés du Client (auteurs des mouvements)", "Code des colis et palettes, références, quantités, emplacements, statuts, motifs ; historique non modifiable des mouvements avec le nom du salarié et la date ; inventaires. Aucune donnée de destinataire (seul l’identifiant de la tournée ou de l’arrêt est lié). Conservé pendant le contrat (registre non purgé automatiquement, durée de conservation à la charge du Client), supprimé avec le compte à la fin du contrat"],
  ["Contestations clients (si souscrit)", "Clients du Client, chauffeurs", "Réclamation, référence, adresse, réponse du chauffeur"],
  ["Assistant (si souscrit)", "Utilisateurs", "Questions posées et réponses"],
  [
    "Véhicules loués (si souscrit)",
    "Chauffeurs et encadrement du Client",
    "Demande d’entretien validée (véhicule, kilométrage, urgence, description, photos), nom et coordonnées du responsable, transmises sur instruction du Client à son loueur ou garage prestataire, destinataire choisi par le Client (lien limité à une demande, 30 jours) ; réponses et factures du prestataire",
  ],
];

/** Sous-traitants ultérieurs autorisés (annexe 3). */
const SOUS_TRAITANTS: [string, string, string][] = [
  ["Supabase Inc.", "Base de données, fichiers, authentification", "Serveurs à Paris (France) ; société de droit américain : accès d’administration ou de support éventuellement depuis un pays tiers, encadré par les clauses types"],
  ["Vercel Inc.", "Hébergement et exécution de l’application", "Exécution des fonctions à Paris (France) ; réseau de diffusion du fournisseur (pages, fichiers statiques, adresses IP et requêtes HTTP) pouvant transiter hors de France ; société américaine (DPF / clauses types)"],
  ["Anthropic PBC", "Lecture automatique et assistant — uniquement si le Client active ces modules", "États-Unis (DPF / clauses types) ; pas d’entraînement des modèles"],
  ["Resend Inc.", "Envoi des e-mails de notification", "États-Unis (DPF / clauses types)"],
  ["Services de notification (Apple, Google, Mozilla)", "Acheminement des notifications sur les téléphones", "Variable ; contenu limité au message affiché"],
  ["Base Adresse Nationale (État français)", "Recherche et géolocalisation d’adresses en France (texte de l’adresse saisie)", "France"],
  ["API « Recherche d’entreprises » (DINUM, État français)", "Recherche d’entreprises et de commerces par leur nom dans le répertoire SIRENE (texte saisi, code postal ou département déduit de la position du dépôt ; aucune donnée de personne physique n’est transmise)", "France"],
  ["Komoot GmbH (Photon)", "Recherche d’adresses et d’établissements (texte saisi, position approximative pour classer les résultats)", "Allemagne (Union européenne)"],
  ["OpenStreetMap Foundation (Nominatim)", "Géolocalisation d’adresses et d’établissements (texte saisi), notamment pour les Clients établis hors de France", "Royaume-Uni (décision d’adéquation)"],
  ["Service d’itinéraires OSRM (serveur public du projet OSRM)", "Calcul des itinéraires et des indications de navigation : coordonnées des arrêts et du point de départ, sans nom ni identifiant", "Localisation variable, à confirmer ; l’Éditeur peut le remplacer par un serveur d’itinéraires dédié"],
  ["OpenStreetMap Foundation, OpenFreeMap (fonds de carte)", "Affichage des cartes dans le navigateur de l’Utilisateur (adresse IP, zone affichée)", "Royaume-Uni / variable"],
  ["Google LLC (Places)", "Aide à la saisie d’adresses (texte saisi) — uniquement si ce service est activé par l’Éditeur", "États-Unis (DPF / clauses types)"],
];

export default function DpaPage() {
  return (
    <LegalPageLayout title="Accord de sous-traitance des données (RGPD)" contractuel>
      <p>
        Le présent accord, conclu en application de l’article 28 du Règlement (UE) 2016/679 (« RGPD »), fait partie du
        contrat d’abonnement conclu entre le Client, <strong>responsable de traitement</strong>, et {designationEditeur()}{" "}
        (« l’Éditeur »), <strong>sous-traitant</strong>. Il s’applique aux données personnelles traitées par l’Éditeur pour
        le compte du Client via la solution GODAC.
      </p>

      <Article n={1} titre="Objet et durée">
        <p>
          L’Éditeur traite les données personnelles décrites en annexe 1, pour la seule fourniture de la solution GODAC, pendant
          la durée du contrat puis jusqu’à la restitution et à la suppression des données prévues à l’article 9.
        </p>
        <p>
          Nature des traitements : collecte, enregistrement, organisation, stockage, consultation, mise en forme (documents PDF
          et Excel), transmission aux sous-traitants ultérieurs de l’annexe 3 et effacement. Finalités, catégories de personnes
          et de données : annexe 1. Aucune donnée de santé n’est requise : le Client évite de saisir des éléments médicaux dans
          les champs libres.
        </p>
      </Article>

      <Article n={2} titre="Instructions du Client">
        <p>
          L’Éditeur ne traite les données que sur instruction documentée du Client : le contrat, le paramétrage de la solution
          et l’activation des modules par le Client valent instructions. Si une instruction lui paraît contraire au RGPD,
          l’Éditeur en informe immédiatement le Client. L’Éditeur n’utilise pas les données pour son propre compte et ne les traite pas au-delà de ces instructions, sauf obligation du droit de l’Union ou français (dont il informe alors le Client, sauf interdiction légale) ; il
          peut produire des statistiques anonymes d’usage et, pour l’assistant, une foire aux questions à partir de questions
          rendues anonymes, sans lien possible avec le Client ou ses salariés.
        </p>
      </Article>

      <Article n={3} titre="Confidentialité">
        <p>
          Les personnes autorisées à traiter les données chez l’Éditeur sont soumises à une obligation de confidentialité et
          n’y accèdent que dans la mesure nécessaire (support, maintenance, incident).
        </p>
      </Article>

      <Article n={4} titre="Sécurité">
        <p>
          L’Éditeur met en œuvre les mesures techniques et organisationnelles décrites en annexe 2, adaptées au risque, et les
          fait évoluer avec l’état de l’art.
        </p>
      </Article>

      <Article n={5} titre="Sous-traitants ultérieurs">
        <p>
          Le Client autorise l’Éditeur à recourir aux sous-traitants listés en annexe 3. L’Éditeur informe le Client par écrit
          de tout ajout ou remplacement au moins trente (30) jours à l’avance ; le Client peut s’y opposer pour un motif
          légitime et, à défaut d’accord, résilier le contrat sans frais. L’Éditeur impose à chaque sous-traitant ultérieur les
          mêmes obligations de protection des données et reste responsable de leur respect.
        </p>
      </Article>

      <Article n={6} titre="Transferts hors de l’Union européenne">
        <p>
          Les données sont hébergées en France. Les transferts éventuels vers un pays tiers (annexe 3) sont encadrés par une
          décision d’adéquation, notamment le cadre de protection des données UE–États-Unis (Data Privacy Framework), ou par
          les clauses contractuelles types de la Commission européenne. Le Client autorise ces transferts ; l’Éditeur lui
          communique sur demande les garanties mises en œuvre.
        </p>
      </Article>

      <Article n={7} titre="Droits des personnes">
        <p>
          La solution permet au Client de consulter, corriger, exporter et supprimer les données de ses salariés. Si une
          personne s’adresse directement à l’Éditeur, celui-ci transmet sa demande au Client sans délai et l’aide à y
          répondre dans le délai légal d’un mois.
        </p>
      </Article>

      <Article n={8} titre="Violation de données">
        <p>
          L’Éditeur notifie au Client toute violation de données personnelles le concernant dans un délai maximal de
          quarante-huit (48) heures après en avoir pris connaissance, avec les informations disponibles (nature, catégories
          et nombre approximatif de personnes et de données concernées, conséquences probables, mesures prises), afin de
          permettre au Client de notifier l’autorité de contrôle dans les 72 heures. Le Client reste responsable de cette
          notification et de l’information des personnes concernées lorsqu’elle est requise.
        </p>
      </Article>

      <Article n={9} titre="Fin du contrat">
        <p>
          À la fin du contrat, l’Éditeur met les données à disposition du Client pour export pendant trente (30) jours, puis
          les supprime, y compris des sauvegardes, dans un délai de trois (3) mois, sauf obligation légale de conservation.
          Au moins trente (30) jours avant la suppression, il adresse un préavis par e-mail aux administrateurs du Client,
          avec un rappel de l’export. La suppression est suspendue tant qu’un litige est déclaré entre les parties. L’Éditeur ne
          conserve ensuite, en qualité de responsable de traitement pour ses propres obligations, que le strict nécessaire
          (données de facturation et identifiants de paiement, preuves d’acceptation et de préavis, trace de la suppression).
          Il atteste de la suppression par écrit sur demande.
        </p>
      </Article>

      <Article n={10} titre="Assistance et audit">
        <p>
          L’Éditeur aide le Client, dans la mesure de ses moyens, à réaliser ses analyses d’impact et à respecter ses
          obligations de sécurité. Il met à sa disposition les informations nécessaires pour démontrer le respect du présent
          accord et permet un audit, une fois par an, à la charge du Client, avec un préavis de trente (30) jours, par un
          auditeur tenu au secret et sans accès aux données des autres clients.
        </p>
      </Article>

      <Article n={11} titre="Obligations du Client">
        <ul className={listeLegale}>
          <li>Disposer d’une base légale pour chaque traitement et informer ses salariés et, le cas échéant, ses propres clients (destinataires de colis).</li>
          <li>
            Tenir son registre des traitements, consulter son comité social et économique lorsqu’il existe (pointage,
            géolocalisation au pointage, pointage assisté, suivi de tournée) et réaliser une analyse d’impact lorsqu’elle est
            requise.
          </li>
          <li>
            Utiliser la géolocalisation pour la seule finalité déclarée, de façon proportionnée et uniquement pendant le temps de
            travail : aucun suivi d’un salarié en dehors de ses horaires.
          </li>
          <li>Ne saisir dans la solution que des données pertinentes et nécessaires.</li>
          <li>Choisir l’activation des modules d’intelligence artificielle en connaissance de cause.</li>
        </ul>
      </Article>

      <h2 className="mt-2 text-base text-navy">Annexe 1 — Description des traitements</h2>
      <p>
        Finalité : fournir au Client un logiciel de gestion de son activité de transport (carburant, flotte, planning,
        ressources humaines, tournées, relation client). Durées de conservation : voir la{" "}
        <Link href="/confidentialite" className={lien}>politique de confidentialité</Link>.
      </p>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-xs">
          <thead>
            <tr className="bg-navy/[0.05] text-left text-navy">
              <th className={cellule}>Traitement</th>
              <th className={cellule}>Personnes concernées</th>
              <th className={cellule}>Données</th>
            </tr>
          </thead>
          <tbody>
            {TRAITEMENTS.map(([t, p, d]) => (
              <tr key={t}>
                <td className={cellule}>{t}</td>
                <td className={cellule}>{p}</td>
                <td className={cellule}>{d}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2 className="mt-2 text-base text-navy">Annexe 2 — Mesures de sécurité</h2>
      <ul className={listeLegale}>
        <li>Hébergement des données en France, chiffrement des échanges (HTTPS/TLS) et des données au repos chez l’hébergeur.</li>
        <li>Cloisonnement strict entre clients par des règles d’accès appliquées par la base de données (Row Level Security).</li>
        <li>Droits par rôle : un chauffeur ne voit que ses propres données ; documents sensibles réservés à l’encadrement.</li>
        <li>Codes PIN stockés sous forme chiffrée ; connexion sans mot de passe possible (passkeys) ; coupure immédiate d’un compte désactivé.</li>
        <li>Fichiers sensibles (photos de livraison, réclamations) dans des espaces privés, lus uniquement par liens temporaires.</li>
        <li>Purge automatique des données à durée limitée (positions GPS, tournées colis, fiches client de l’annuaire, conversations de l’assistant, amendes clôturées, pointages anciens).</li>
        <li>Journal d’audit des actions sensibles (exports, changements de droits, bulletins validés), lisible par la direction du Client, conservé trois ans.</li>
        <li>Sauvegardes de la base de données ; accès d’administration limité à l’Éditeur et protégé.</li>
        <li>Contrôles automatiques du code (typage, tests, compilation) avant toute mise en production.</li>
      </ul>

      <h2 className="mt-2 text-base text-navy">Annexe 3 — Sous-traitants ultérieurs autorisés</h2>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-xs">
          <thead>
            <tr className="bg-navy/[0.05] text-left text-navy">
              <th className={cellule}>Sous-traitant</th>
              <th className={cellule}>Prestation</th>
              <th className={cellule}>Localisation / garanties</th>
            </tr>
          </thead>
          <tbody>
            {SOUS_TRAITANTS.map(([n, p, l]) => (
              <tr key={n}>
                <td className={cellule}>{n}</td>
                <td className={cellule}>{p}</td>
                <td className={cellule}>{l}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p>
        Stripe (paiement de l’abonnement) traite les données de facturation du Client ; l’Éditeur en est responsable de traitement
        (ce n’est pas un traitement réalisé pour le compte du Client) : il est hors du périmètre de cet accord. Contact pour toute question relative aux données : <a href={`mailto:${EDITEUR.email}`} className={lien}>{EDITEUR.email}</a>.
      </p>
    </LegalPageLayout>
  );
}
