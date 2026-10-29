import Link from "next/link";
import { LegalPageLayout } from "@/components/legal/LegalPageLayout";
import { PAYS } from "@/lib/pays/pays";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-base text-navy">{title}</h2>
      {children}
    </section>
  );
}

const list = "flex list-disc flex-col gap-1 pl-5";

export default function ConfidentialitePage() {
  return (
    <LegalPageLayout title="Politique de confidentialité">
      <p>
        François, éditeur de GODAC (ci-après « nous », identité et contact dans les{" "}
        <Link href="/mentions-legales" className="text-teal-ink hover:underline">mentions légales</Link>), attache une attention particulière à la protection des
        données personnelles traitées dans le cadre de l&apos;application GODAC, conformément au Règlement Général
        sur la Protection des Données (RGPD) et à la loi Informatique et Libertés.
      </p>

      <Section title="Qui est responsable de vos données ?">
        <p>
          GODAC est utilisé par des entreprises de transport (les « entreprises clientes ») pour gérer leurs équipes,
          leur flotte et leur carburant. Pour les données de leurs salariés (chauffeurs, exploitants, comptables),
          l&apos;entreprise cliente est <strong>responsable de traitement</strong> et nous agissons comme{" "}
          <strong>sous-traitant</strong>, uniquement sur ses instructions. Pour les comptes administrateurs, la
          facturation et les demandes de contact, nous sommes responsable de traitement.
        </p>
      </Section>

      <Section title="Données collectées">
        <ul className={list}>
          <li>
            <strong>Identité et compte :</strong> nom, prénom, adresse e-mail, téléphone, rôle, service, code chauffeur,
            code PIN (stocké chiffré, jamais en clair), clés de connexion sans mot de passe (passkeys).
          </li>
          <li>
            <strong>Activité professionnelle :</strong> tournées (départs, retours, kilométrages), ravitaillements,
            planning, congés, pointages, demandes d&apos;entretien, documents des véhicules.
          </li>
          <li>
            <strong>Photos :</strong> compteurs, tickets de carburant, véhicules, cuves, documents et photos envoyées
            dans la messagerie.
          </li>
          <li>
            <strong>Position GPS au moment du pointage :</strong> lorsque vous pointez, pour vérifier que vous êtes au
            dépôt. Si votre entreprise utilise le <strong>pointage assisté</strong>, votre position est aussi lue environ
            une fois par minute, application ouverte et visible (4 heures au plus), pour détecter votre arrivée au dépôt
            ou votre sortie ; rien n&apos;est conservé de ces lectures, sauf l&apos;heure de votre dernière présence au
            dépôt (et la position de l&apos;arrivée ou de la sortie enregistrée automatiquement). La position
            enregistrée au pointage est conservée 2 mois, puis supprimée.
          </li>
          <li>
            <strong>Position pendant une tournée colis en cours :</strong> si l&apos;entreprise utilise le module Tournée
            colis, la position du chauffeur est partagée avec l&apos;encadrement pour suivre la livraison (fin de tournée
            estimée, réponse aux clients), <strong>uniquement pendant la tournée en cours</strong> et application ouverte.
            La dernière position est effacée à la clôture de la tournée. Pour analyser les trajets (km réellement
            parcourus, durée de conduite, arrêts prolongés), le trajet emprunté est aussi enregistré pendant la tournée en
            cours seulement (un point tous les 20 m environ, ou toutes les 30 s à l&apos;arrêt), signalé au chauffeur par
            l&apos;indication « Trajet enregistré », visible par le chauffeur pour ses tournées et par la direction et
            les managers de l&apos;entreprise, et conservé 1 an. Le chauffeur peut masquer sa position à tout moment
            (pause) : rien n&apos;est alors enregistré. En dehors de ces moments, GODAC ne suit jamais vos déplacements.
          </li>
          <li>
            <strong>Lieux enregistrés dans GO (« Aller à… ») :</strong> pour vous guider vers une destination de votre choix
            sans tournée, GO garde vos <strong>favoris</strong> (Domicile, Travail et jusqu&apos;à 20 lieux nommés par vous) et vos
            <strong> 10 destinations récentes</strong> (nom, adresse et coordonnées du lieu). <strong>Le trajet et votre position ne sont pas
            enregistrés</strong> pendant une navigation libre, et rien n&apos;est partagé avec l&apos;encadrement ni intégré aux tournées, rapports ou
            suivis en direct. Ces lieux ne sont visibles que de vous ; vous les renommez, supprimez ou effacez (« Tout effacer
            l&apos;historique ») à tout moment.
          </li>
          <li>
            <strong>Amendes :</strong> avis de contravention liés aux véhicules, pour permettre à l&apos;entreprise
            d&apos;identifier le conducteur dans les délais légaux.
          </li>
          <li>
            <strong>Tournées colis et contestations clients :</strong> adresses de livraison, nom et téléphone des destinataires (pour que le chauffeur puisse les appeler), photo du colis déposé (preuve de livraison),
            réclamations des clients de l&apos;entreprise et réponses des chauffeurs.
          </li>
          <li>
            <strong>Stock (si l&apos;entreprise utilise le module Stock) :</strong> colis, palettes et références suivis par leur code, avec leur emplacement,
            leur statut et l&apos;historique des mouvements (entrée, sortie, transfert, retour, casse, perte, ajustement, inventaire). <strong>Aucune donnée de
            destinataire n&apos;y figure</strong> : le seul lien avec les tournées est l&apos;identifiant de la tournée ou de l&apos;arrêt concerné. Le nom du salarié
            qui effectue un mouvement ou un inventaire est conservé pour la traçabilité. L&apos;entreprise peut y ajouter des informations logistiques facultatives
            (nature de l&apos;objet, température, fragile, urgent, consigne de manipulation, référence client, lot, date limite) et imprimer des étiquettes dont le QR
            code et le code-barres <strong>ne contiennent que le code</strong>. <strong>Aucune donnée de santé nominative</strong> (patient, donneur) ne doit être saisie dans
            les champs libres. GODAC fournit un suivi logistique : le respect des exigences réglementaires propres au secteur de l&apos;entreprise (chaîne du froid,
            traçabilité sanitaire, pharmacie, produits sanguins) reste à la charge de l&apos;entreprise.
          </li>
          <li>
            <strong>Fiches client de l&apos;annuaire de tournée :</strong> pour préremplir les prochaines tournées de l&apos;entreprise, GODAC retient, par
            adresse d&apos;établissement (commerce, entreprise, point relais) et uniquement au sein de l&apos;entreprise concernée, les <strong>coordonnées des
            destinataires professionnels</strong> (nom de l&apos;établissement, contact habituel, téléphone), les <strong>consignes d&apos;accès</strong> (code,
            stationnement, quai), les horaires d&apos;ouverture ou créneaux, la durée moyenne d&apos;arrêt, les heures où la livraison réussit, les motifs d&apos;échec
            fréquents et les contacts déjà faits (message, appel). Les particuliers ne sont pas ajoutés à cet annuaire. Le chauffeur et l&apos;encadrement peuvent
            corriger ou <strong>effacer</strong> une fiche à tout moment depuis l&apos;écran « Horaires » de l&apos;arrêt. GODAC retient aussi, par modèle de tournée
            ou par chauffeur, l&apos;<strong>ordre habituel des villages</strong> parcourus (noms de villages seulement) pour proposer le sens habituel de la tournée.
          </li>
          <li>
            <strong>Véhicules loués :</strong> si l&apos;entreprise l&apos;active, une demande d&apos;entretien validée par un responsable
            (immatriculation, modèle, kilométrage, urgence, description et photos, nom et coordonnées du responsable) est transmise au
            loueur ou au garage choisi par l&apos;entreprise, qui en devient destinataire. Il y accède par un lien personnel limité à cette
            seule demande (30 jours) et peut y répondre et déposer sa facture.
          </li>
          <li>
            <strong>Messagerie :</strong> messages, réactions, accusés de lecture des Infos équipe et pièces jointes échangés entre collègues dans GODAC, en discussion directe ou dans les groupes d&apos;équipe (un compte désactivé quitte aussitôt tous ses groupes).
          </li>
          <li>
            <strong>Données techniques :</strong> journaux de connexion, abonnement aux notifications de
            l&apos;appareil, préférences d&apos;affichage.
          </li>
          <li>
            <strong>Facturation (administrateurs) :</strong> coordonnées de l&apos;entreprise et historique
            d&apos;abonnement. Les données de carte bancaire sont traitées directement par Stripe et ne nous sont
            jamais transmises.
          </li>
        </ul>
      </Section>

      <Section title="Pourquoi nous les utilisons">
        <ul className={list}>
          <li>Faire fonctionner le service : carburant, flotte, tournées, planning, pointage, messagerie, alertes.</li>
          <li>Assurer la sécurité des comptes et prévenir les accès frauduleux.</li>
          <li>Envoyer les e-mails et notifications utiles (alertes, planning, messages).</li>
          <li>Facturer l&apos;abonnement et répondre aux demandes d&apos;assistance.</li>
        </ul>
        <p>
          Base légale : l&apos;exécution du contrat avec l&apos;entreprise cliente, l&apos;intérêt légitime de
          l&apos;entreprise à organiser son activité et ses obligations légales (temps de travail, comptabilité,
          désignation du conducteur). GODAC ne vend ni ne loue aucune donnée, et n&apos;affiche aucune publicité.
        </p>
        <p>
          Géolocalisation : votre position n&apos;est utilisée que pour le pointage au dépôt, le suivi d&apos;une tournée en
          cours et l&apos;analyse des trajets, pendant votre temps de travail. Elle ne doit jamais servir à vous suivre en
          dehors de vos horaires. Votre employeur doit vous en informer et, lorsqu&apos;il existe, consulter son comité
          social et économique.
        </p>
      </Section>

      <Section title="Lecture automatique par intelligence artificielle">
        <p>
          La lecture automatique des photos (ticket de carburant, compteur, amende, rapport de tournée, étiquette de colis, réclamation client) et
          l&apos;assistant sont des <strong>options désactivées par défaut</strong>, que seule l&apos;entreprise
          cliente peut activer. Lorsqu&apos;elles sont activées, les contenus concernés sont transmis à Anthropic
          (modèles Claude) pour être analysés, puis le résultat vous est proposé pour vérification. Selon ses
          conditions professionnelles, Anthropic n&apos;utilise pas ces données pour entraîner ses modèles.
          Lorsqu&apos;elles sont désactivées, aucune photo ni aucun fichier n&apos;est transmis à Anthropic.
        </p>
      </Section>

      <Section title="Hébergement et sous-traitants">
        <ul className={list}>
          <li>
            <strong>Supabase</strong> — base de données, fichiers et authentification ; serveurs situés à Paris
            (France).
          </li>
          <li>
            <strong>Vercel Inc.</strong> — hébergement de l&apos;application ; fonctions exécutées à Paris (France), le réseau de
            diffusion du fournisseur pouvant faire transiter les requêtes (adresse IP) par d&apos;autres pays.
          </li>
          <li>
            <strong>Anthropic</strong> — lecture automatique des documents et assistant, uniquement si l&apos;entreprise active ces options (États-Unis).
          </li>
          <li>
            <strong>Resend</strong> — envoi des e-mails transactionnels (États-Unis).
          </li>
          <li>
            <strong>Stripe</strong> — paiement de l&apos;abonnement.
          </li>
          <li>
            <strong>Cartes, adresses et itinéraires</strong> — Base Adresse Nationale et API Recherche d&apos;entreprises (France), Photon / Komoot (Allemagne),
            OpenStreetMap / Nominatim (Royaume-Uni), un service d&apos;itinéraires OSRM et, le cas échéant, Google Places
            (États-Unis) : ils reçoivent le texte d&apos;une adresse saisie ou des coordonnées de points d&apos;arrêt (sans nom),
            et les serveurs de cartes (OpenStreetMap, OpenFreeMap) reçoivent l&apos;adresse IP de votre appareil et la zone
            affichée.
          </li>
          <li>
            Les services de notification des navigateurs (Apple, Google, Mozilla) — acheminement des notifications,
            sans contenu nominatif au-delà du message affiché.
          </li>
        </ul>
        <p>
          Lorsque des données sont traitées hors de l&apos;Union européenne, ces transferts sont encadrés par le
          cadre de protection des données UE–États-Unis (Data Privacy Framework) ou par les clauses contractuelles
          types de la Commission européenne.
        </p>
      </Section>

      <Section title="Amélioration de l'assistant (FAQ commune)">
        <p>
          Pour que l&apos;assistant réponde mieux, les questions qui lui sont posées alimentent une foire aux questions
          commune à toutes les entreprises utilisatrices. Avant d&apos;être conservée, chaque question est
          anonymisée : nom de la personne et de l&apos;entreprise, immatriculations, numéros de téléphone, e-mails et
          numéros sont retirés, et la question est enregistrée <strong>sans aucun lien</strong> avec l&apos;entreprise ou
          la personne qui l&apos;a posée. Les questions similaires sont ensuite regroupées et généralisées, et
          chaque réponse est relue par l&apos;éditeur avant publication. Aucun modèle d&apos;intelligence artificielle
          n&apos;est entraîné avec ces données : les réponses validées sont simplement fournies à l&apos;assistant
          comme source.
        </p>
      </Section>

      <Section title="Essai GO Navigation : statistiques d'usage">
        <p>
          Pendant l&apos;essai GO Navigation, nous mesurons l&apos;usage de manière <strong>agrégée et anonyme</strong> (nombre de
          tournées et d&apos;arrêts, fonctions utilisées, lectures d&apos;étiquettes) pour améliorer le service.
        </p>
        <p>
          Le <strong>détail</strong> de l&apos;usage (tournées, étapes, horaires, chronologie des actions) n&apos;est consulté
          qu&apos;avec votre <strong>accord facultatif</strong>, donné à l&apos;inscription (case non cochée par défaut) ou depuis
          « Mon compte », et que vous pouvez retirer à tout moment : la consultation s&apos;arrête alors. Ne pas donner cet accord, ou
          le retirer, n&apos;a aucune incidence sur votre essai. Les dates et le texte de l&apos;accord sont conservés comme preuve, et
          chaque consultation du détail est tracée dans le journal d&apos;audit de votre organisation.
        </p>
        <p>
          Ces consultations ne portent ni sur les noms, adresses ou téléphones des clients finaux que vous livrez, ni sur vos
          positions GPS. Les données de l&apos;essai sont conservées selon les durées de la section suivante.
        </p>
      </Section>

      <Section title="Durée de conservation">
        <p>
          Les durées ci-dessous suivent les recommandations de la CNIL (référentiel « gestion du personnel »,
          fiche géolocalisation des véhicules) et les obligations légales françaises. Celles marquées d&apos;un
          astérisque sont appliquées automatiquement chaque nuit.
        </p>
        <ul className={list}>
          <li>Compte utilisateur : tant que le compte est actif ; l&apos;entreprise le désactive au départ du salarié, ce qui coupe aussitôt son accès.</li>
          <li>
            Données d&apos;activité (tournées, carburant, planning, congés), photos et messages : pendant la durée du
            contrat avec l&apos;entreprise cliente, puis supprimées* 3 mois après sa fin, après un préavis par e-mail aux
            administrateurs de l&apos;entreprise (au moins 30 jours avant) qui rappelle la possibilité d&apos;exporter les données.
            La suppression est suspendue pendant un litige déclaré. GODAC ne conserve alors que le strict nécessaire :
            données de facturation et identifiants de paiement (durée comptable légale), preuves d&apos;acceptation et de
            préavis, trace de la suppression.
          </li>
          <li>
            Heures de pointage* : 5 ans maximum, durée pendant laquelle l&apos;employeur peut avoir à justifier le temps
            de travail et la paie.
          </li>
          <li>
            Position GPS de pointage* : 2 mois, au titre de la preuve du temps de travail en cas de litige, puis les coordonnées sont
            supprimées ; seul le résultat du pointage est conservé (heures, source, statut).
          </li>
          <li>Dernière position pendant une tournée colis : effacée à la clôture de la tournée.</li>
          <li>
            Lieux enregistrés dans GO (« Aller à… »)* : destinations récentes supprimées 90 jours après leur dernier usage ; favoris conservés jusqu&apos;à
            leur suppression par vous, et effacés avec votre compte ou avec les données de l&apos;entreprise 3 mois après la fin du contrat.
          </li>
          <li>Trajet enregistré pendant une tournée colis en cours* : 1 an, puis effacé.</li>
          <li>Conversations avec l&apos;assistant* : 90 jours après le dernier message.</li>
          <li>Questions anonymisées en attente d&apos;analyse pour la FAQ* : 90 jours.</li>
          <li>
            Tournées colis* : téléphones, consignes et noms complets des destinataires effacés 30 jours après la tournée (le nom est
            réduit aux initiales) ; adresses, initiales et photos de livraison conservées 12 mois pour traiter les contestations, puis
            supprimées.
          </li>
          <li>
            Stock* (unités, quantités, inventaires et registre des mouvements) : conservé pendant le contrat. Le registre n&apos;est pas purgé
            automatiquement, car il peut servir de justificatif comptable ou de preuve en cas de litige : l&apos;entreprise le garde aussi longtemps que ses
            obligations le demandent (5 ans est la durée usuelle). Tout est effacé avec les données de l&apos;entreprise 3 mois après la fin du contrat.
          </li>
          <li>
            Fiches client de l&apos;annuaire de tournée* (téléphone, contact, consignes d&apos;accès, statistiques de passage) et sens habituel des tournées :
            12 mois sans mise à jour, puis supprimés (la fiche est conservée pour ses seuls horaires d&apos;ouverture si l&apos;entreprise en a renseigné) ;
            effacées à tout moment à la demande depuis l&apos;écran « Horaires », et avec toutes les données de l&apos;entreprise 3 mois après la fin du contrat.
          </li>
          <li>Amendes* : jusqu&apos;à leur traitement (réglée ou classée), puis 1 an maximum (délai de prescription des contraventions), avis et pièces jointes compris.</li>
          <li>Journal d&apos;audit des actions sensibles (exports, changements de droits, bulletins validés)* : 3 ans.</li>
          <li>Journal anti-abus du lien d&apos;un prestataire (adresses IP hachées)* : 30 jours.</li>
          <li>
            Journaux techniques de connexion et d&apos;erreur : conservés par les hébergeurs, pour une durée limitée fixée par chacun
            (de quelques jours à 1 an au plus).
          </li>
          <li>
            Bulletins de paie : le code du travail impose à l&apos;employeur de les tenir à la disposition du salarié pendant 50 ans, ou
            jusqu&apos;à ses 75 ans (art. D3243-8). GODAC les conserve tant que l&apos;entreprise utilise GODAC, puis comme les autres données
            d&apos;activité : il ne garantit donc pas seul cette durée. Chaque salarié peut à tout moment télécharger tous ses bulletins en une
            archive ZIP (Mon espace › Mes fiches de paie), et la direction l&apos;ensemble des bulletins de l&apos;entreprise, pour les archiver
            elle-même. Le salarié peut aussi s&apos;opposer à la remise électronique et demander ses bulletins sur papier.
          </li>
          <li>
            Registre unique du personnel (nationalité, titre de travail…) : saisi par la direction, visible d&apos;elle seule et du salarié
            concerné ; à conserver par l&apos;employeur 5 ans après le départ du salarié, en exportant le registre.
          </li>
          <li>Factures : 10 ans (obligation comptable).</li>
        </ul>
      </Section>

      <Section title="Entreprises établies hors de France">
        <p>
          Chaque entreprise indique son pays dans GODAC. Les données restent hébergées en France ; le droit du pays de
          l&apos;entreprise s&apos;applique en plus du RGPD, et l&apos;autorité compétente pour ses salariés est la suivante :
        </p>
        <ul className={list}>
          {PAYS.filter((p) => p.code !== "FR").map((p) => (
            <li key={p.code}>
              <strong>
                {p.drapeau} {p.nom}
              </strong>{" "}
              : {p.donnees.loi} —{" "}
              <a href={p.donnees.site} className="text-teal-ink hover:underline" target="_blank" rel="noreferrer">
                {p.donnees.autorite}
              </a>
              {p.donnees.transfert && <span className="block text-navy/70">{p.donnees.transfert}</span>}
            </li>
          ))}
        </ul>
      </Section>

      <Section title="Sécurité">
        <p>
          Accès chiffrés (HTTPS), cloisonnement strict entre entreprises et par rôle (un chauffeur ne voit que ses
          propres données), codes PIN stockés sous forme chiffrée, sauvegardes régulières, accès aux données
          limité aux seules personnes qui en ont besoin.
        </p>
      </Section>

      <Section title="Cookies et stockage local">
        <p>
          GODAC n&apos;utilise que des cookies strictement nécessaires à la connexion, et le stockage local de votre
          navigateur pour vos préférences (thème, taille du texte). Aucun cookie publicitaire ni outil de mesure
          d&apos;audience tiers : aucun consentement n&apos;est donc requis. L&apos;affichage d&apos;une carte contacte les serveurs
          de cartes (OpenStreetMap, OpenFreeMap), qui reçoivent votre adresse IP.
        </p>
      </Section>

      <Section title="Vos droits">
        <p>
          Vous disposez d&apos;un droit d&apos;accès, de rectification, d&apos;effacement, de limitation, de
          portabilité et d&apos;opposition. Si vous êtes salarié d&apos;une entreprise cliente, adressez-vous en
          priorité à votre employeur ; nous l&apos;aiderons à vous répondre. Vous pouvez aussi nous écrire à{" "}
          <a href="mailto:contact@godac.fr" className="text-teal-ink hover:underline">
            contact@godac.fr
          </a>
          . Nous répondons dans un délai d&apos;un mois.
        </p>
        <p>
          Si vous estimez que vos droits ne sont pas respectés, vous pouvez introduire une réclamation auprès de la
          CNIL (cnil.fr).
        </p>
      </Section>

      <p>
        Voir aussi les{" "}
        <Link href="/mentions-legales" className="text-teal-ink hover:underline">
          mentions légales
        </Link>
        . Dernière mise à jour : octobre 2026.
      </p>
    </LegalPageLayout>
  );
}
