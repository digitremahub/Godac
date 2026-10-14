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
        François, éditeur de GODAC (ci-après « nous »), attache une attention particulière à la protection des
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
            <strong>Position GPS au moment du pointage :</strong> uniquement lorsque vous pointez, pour vérifier que
            vous êtes au dépôt.
          </li>
          <li>
            <strong>Position pendant une tournée colis en cours :</strong> si l&apos;entreprise utilise le module Tournée
            colis, la position du chauffeur est partagée avec l&apos;encadrement pour suivre la livraison (fin de tournée
            estimée, réponse aux clients), <strong>uniquement pendant la tournée en cours</strong> et application ouverte.
            Seule la dernière position est conservée (aucun historique de trajet) ; elle est effacée à la clôture de la
            tournée, et le chauffeur peut la masquer à tout moment (pause). En dehors de ces moments, GODAC ne suit
            jamais vos déplacements.
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
            <strong>Vercel Inc.</strong> — hébergement de l&apos;application ; traitements exécutés à Paris (France).
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
            contrat avec l&apos;entreprise cliente, puis supprimées dans les 3 mois suivant sa fin, après export si
            l&apos;entreprise le demande.
          </li>
          <li>
            Heures de pointage : 5 ans maximum, durée pendant laquelle l&apos;employeur peut avoir à justifier le temps
            de travail et la paie.
          </li>
          <li>Position GPS de pointage* : 1 an, puis effacée (l&apos;heure du pointage est conservée).</li>
          <li>Dernière position pendant une tournée colis : effacée à la clôture de la tournée (aucun historique).</li>
          <li>Conversations avec l&apos;assistant* : 90 jours après le dernier message.</li>
          <li>Questions anonymisées en attente d&apos;analyse pour la FAQ* : 90 jours.</li>
          <li>
            Tournées colis* : téléphones, consignes et noms complets des destinataires effacés 30 jours après la tournée (le nom est
            réduit aux initiales) ; adresses, initiales et photos de livraison conservées 12 mois pour traiter les contestations, puis
            supprimées.
          </li>
          <li>Amendes : jusqu&apos;à leur traitement, puis 1 an maximum (délai de prescription des contraventions).</li>
          <li>Journaux de connexion : 1 an maximum.</li>
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
          d&apos;audience tiers : aucun consentement n&apos;est donc requis.
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
