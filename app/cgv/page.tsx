import Link from "next/link";
import { Article, LegalPageLayout, listeLegale } from "@/components/legal/LegalPageLayout";
import { EDITEUR, designationEditeur, juridiction } from "@/lib/legal/editeur";

export const metadata = { title: "Conditions générales de vente — GODAC" };

const lien = "text-teal-ink hover:underline";

/**
 * CGV d'abonnement SaaS entre professionnels. Modèle rédigé pour le
 * lancement commercial : à faire relire par un avocat avant la première
 * signature (voir Notion, kit commercial).
 */
export default function CgvPage() {
  return (
    <LegalPageLayout title="Conditions générales de vente" contractuel>
      <p>
        Les présentes conditions générales de vente (« CGV ») sont conclues entre {designationEditeur()} (« l’Éditeur ») et
        toute entreprise qui souscrit un abonnement à la solution GODAC (« le Client »). Elles s’appliquent exclusivement
        entre professionnels.
      </p>

      <Article n={1} titre="Documents contractuels">
        <p>Le contrat est formé des documents suivants, par ordre de priorité décroissant :</p>
        <ol className="flex list-decimal flex-col gap-1 pl-5">
          <li>le bon de commande signé ou la souscription en ligne (formule, modules, prix, durée, conditions particulières) ;</li>
          <li>les présentes CGV ;</li>
          <li>
            l’<Link href="/dpa" className={lien}>accord de sous-traitance des données personnelles</Link> ;
          </li>
          <li>
            l’<Link href="/sla" className={lien}>engagement de niveau de service</Link> ;
          </li>
          <li>
            les <Link href="/cgu" className={lien}>conditions générales d’utilisation</Link>, opposables aux utilisateurs.
          </li>
        </ol>
        <p>Les conditions générales d’achat du Client ne s’appliquent pas, sauf acceptation écrite de l’Éditeur.</p>
      </Article>

      <Article n={2} titre="Définitions">
        <ul className={listeLegale}>
          <li>
            <strong>Solution</strong> : le logiciel GODAC accessible en ligne (application web et application mobile GODAC
            Livreur), dans la formule et avec les modules souscrits.
          </li>
          <li>
            <strong>Formule</strong> : le plan (Starter, Pro, Business ou Essentiel sur demande), dimensionné selon le nombre
            de véhicules du Client.
          </li>
          <li>
            <strong>Module</strong> : fonctionnalité incluse dans la formule ou souscrite en option.
          </li>
          <li>
            <strong>Utilisateurs</strong> : les personnes autorisées par le Client (direction, encadrement, comptabilité,
            chauffeurs), sans limite de nombre.
          </li>
          <li>
            <strong>Données du Client</strong> : toutes les données saisies, importées ou produites par le Client et ses
            Utilisateurs dans la Solution.
          </li>
        </ul>
      </Article>

      <Article n={3} titre="Souscription">
        <p>
          Le contrat est conclu à la signature du bon de commande par le Client ou à la validation de la souscription en
          ligne. Le Client déclare agir à des fins professionnelles : aucun droit de rétractation ne s’applique.
        </p>
        <p>
          Les devis et bons de commande émis par l’Éditeur sont valables trente (30) jours. L’offre « Fondateur », lorsqu’elle
          est proposée, est réservée aux dix premiers clients et figure sur le bon de commande.
        </p>
      </Article>

      <Article n={4} titre="Description du service">
        <p>
          L’Éditeur met la Solution à disposition du Client en mode SaaS (logiciel en ligne), hébergée en France. Le
          périmètre fonctionnel dépend de la Formule et des Modules souscrits, décrits sur la{" "}
          <Link href="/modules" className={lien}>page Modules & tarifs</Link> à la date de la commande.
        </p>
        <p>
          L’application mobile GODAC Livreur est mise gratuitement à la disposition des chauffeurs du Client lorsque le
          module « Tournée colis » est souscrit, sans limite de nombre de chauffeurs.
        </p>
        <p>
          La Solution évolue : l’Éditeur peut ajouter, améliorer ou remplacer des fonctionnalités, sans réduire de manière
          substantielle les fonctionnalités souscrites en cours d’abonnement.
        </p>
      </Article>

      <Article n={5} titre="Mise en service">
        <p>
          Les frais de mise en service rémunèrent le paramétrage de l’espace du Client (organisation, services, dépôts,
          véhicules, utilisateurs), l’import des données fournies par le Client et la prise en main de l’équipe. Ils sont
          facturés une seule fois, à la commande, et restent acquis à l’Éditeur.
        </p>
        <p>
          L’Éditeur ouvre l’accès dans un délai indicatif de dix (10) jours ouvrés à compter de la réception des
          informations nécessaires. Le Client fournit des données exactes et à jour, et désigne un interlocuteur.
        </p>
      </Article>

      <Article n={6} titre="Durée">
        <p>
          L’abonnement est souscrit pour une période initiale de douze (12) mois à compter de l’ouverture de l’accès, sauf
          durée différente prévue au bon de commande. À son terme, il se renouvelle tacitement par périodes d’un (1) mois,
          résiliables à tout moment avec un préavis d’un (1) mois, par écrit (e-mail à {EDITEUR.email} ou depuis l’espace
          Facturation).
        </p>
      </Article>

      <Article n={7} titre="Prix, facturation et paiement">
        <ul className={listeLegale}>
          <li>Les prix sont exprimés en euros hors taxes ; la TVA au taux en vigueur s’y ajoute.</li>
          <li>
            L’abonnement (Formule + Modules optionnels) est facturé mensuellement, terme à échoir, et payable à réception par
            prélèvement SEPA ou carte bancaire.
          </li>
          <li>
            Le Client peut ajouter des Modules à tout moment ; ils sont facturés à compter du mois de leur activation. Le
            retrait d’un Module prend effet à la fin de la période d’engagement en cours.
          </li>
          <li>
            Si le nombre de véhicules du Client dépasse la tranche de sa Formule, l’Éditeur peut proposer la Formule
            supérieure, applicable au mois suivant l’accord du Client.
          </li>
          <li>
            Les prix peuvent être révisés une fois par an, au 1er janvier, avec un préavis écrit de deux (2) mois ; le Client
            peut alors résilier sans frais avant la date d’effet.
          </li>
        </ul>
      </Article>

      <Article n={8} titre="Retard de paiement">
        <p>
          Toute somme non payée à l’échéance porte de plein droit intérêt au taux égal à trois fois le taux d’intérêt
          légal, et donne lieu à une indemnité forfaitaire pour frais de recouvrement de quarante (40) euros (articles
          L. 441-10 et D. 441-5 du Code de commerce). Après une mise en demeure restée sans effet pendant quinze (15) jours,
          l’Éditeur peut suspendre l’accès à la Solution jusqu’au paiement, sans que cette suspension n’interrompe la
          facturation. Les Données du Client sont conservées pendant la suspension.
        </p>
      </Article>

      <Article n={9} titre="Obligations de l’Éditeur">
        <ul className={listeLegale}>
          <li>Fournir la Solution conformément à sa description, avec diligence et selon les règles de l’art (obligation de moyens).</li>
          <li>Héberger les Données du Client en France et en assurer la sécurité et la sauvegarde.</li>
          <li>
            Assurer le support et la maintenance dans les conditions de l’
            <Link href="/sla" className={lien}>engagement de niveau de service</Link>.
          </li>
          <li>Informer le Client de toute violation de données le concernant, dans les conditions de l’accord de sous-traitance.</li>
        </ul>
      </Article>

      <Article n={10} titre="Obligations et responsabilités du Client">
        <ul className={listeLegale}>
          <li>Gérer ses Utilisateurs, leurs droits et la confidentialité de leurs identifiants, et désactiver sans délai les comptes des personnes qui quittent l’entreprise.</li>
          <li>Utiliser la Solution conformément à sa destination, aux CGU et à la réglementation.</li>
          <li>Informer ses salariés des traitements de données réalisés via la Solution (pointage, géolocalisation au pointage, photos…).</li>
          <li>
            Vérifier les résultats produits par la Solution avant toute décision : la Solution est un outil d’aide. Le Client
            demeure seul responsable, en qualité d’employeur et de transporteur, de ses bulletins de paie et déclarations
            sociales, du respect des temps de conduite et de repos, de la désignation des conducteurs, du traitement des
            réclamations de ses clients et de ses obligations fiscales.
          </li>
        </ul>
      </Article>

      <Article n={11} titre="Données du Client et réversibilité">
        <p>
          Le Client reste seul propriétaire des Données du Client. Pour les données personnelles, l’Éditeur agit en qualité
          de sous-traitant selon l’<Link href="/dpa" className={lien}>accord de sous-traitance</Link>, qui fait partie du
          contrat.
        </p>
        <p>
          À la fin du contrat, quelle qu’en soit la cause, le Client peut exporter ses données depuis la Solution ou demander
          à l’Éditeur, dans les trente (30) jours, un export dans un format standard (CSV). Les Données du Client sont ensuite
          supprimées dans un délai de trois (3) mois, sauf obligation légale de conservation.
        </p>
      </Article>

      <Article n={12} titre="Fonctions d’intelligence artificielle">
        <p>
          Les modules de lecture automatique (photos de tickets, compteurs, étiquettes, amendes, réclamations) et
          l’assistant reposent sur un service d’intelligence artificielle. Ils sont désactivés par défaut et activés au choix
          du Client. Leurs résultats sont proposés à la vérification d’un Utilisateur et peuvent comporter des erreurs.
        </p>
      </Article>

      <Article n={13} titre="Propriété intellectuelle">
        <p>
          La Solution, la marque GODAC, les logiciels, bases et contenus fournis par l’Éditeur restent sa propriété. L’Éditeur
          concède au Client, pour la durée du contrat et pour ses besoins internes, un droit d’utilisation personnel, non
          exclusif et non cessible de la Solution. Toute reproduction, décompilation ou mise à disposition de tiers est
          interdite.
        </p>
      </Article>

      <Article n={14} titre="Limitation de responsabilité">
        <p>
          Chaque partie répond des dommages directs causés par ses manquements prouvés. L’Éditeur ne répond pas des dommages
          indirects (perte de chiffre d’affaires, de clientèle ou de données imputable au Client, amendes, pénalités ou
          redressements résultant des décisions du Client). Sauf faute lourde ou dolosive, la responsabilité totale de
          l’Éditeur est limitée aux sommes payées par le Client au titre des douze (12) mois précédant le fait générateur.
        </p>
      </Article>

      <Article n={15} titre="Force majeure">
        <p>
          Aucune partie n’est responsable d’un manquement dû à un cas de force majeure au sens de l’article 1218 du Code
          civil (notamment panne générale des réseaux ou de l’hébergeur, catastrophe, décision administrative). Si
          l’empêchement dure plus de trente (30) jours, chaque partie peut résilier le contrat sans indemnité.
        </p>
      </Article>

      <Article n={16} titre="Résiliation pour manquement">
        <p>
          En cas de manquement grave d’une partie, non réparé trente (30) jours après une mise en demeure par lettre
          recommandée ou e-mail avec accusé de réception, l’autre partie peut résilier le contrat de plein droit, sans
          préjudice de dommages et intérêts.
        </p>
      </Article>

      <Article n={17} titre="Confidentialité">
        <p>
          Chaque partie garde confidentielles les informations de l’autre dont elle a connaissance dans le cadre du contrat,
          pendant sa durée et trois (3) ans après son terme.
        </p>
      </Article>

      <Article n={18} titre="Référence commerciale">
        <p>
          Sauf opposition écrite du Client, l’Éditeur peut citer son nom et son logo comme référence client, sans divulguer
          aucune donnée de son activité.
        </p>
      </Article>

      <Article n={19} titre="Modification des CGV">
        <p>
          L’Éditeur peut faire évoluer les présentes CGV ; la nouvelle version est notifiée au Client au moins trente (30)
          jours avant son entrée en vigueur. En cas de désaccord, le Client peut résilier sans frais avant cette date.
        </p>
      </Article>

      <Article n={20} titre="Droit applicable et litiges">
        <p>
          Le contrat est soumis au droit français. Les parties recherchent d’abord une solution amiable. À défaut, tout
          litige relève de la compétence exclusive de {juridiction()}, y compris en cas de référé ou de pluralité de
          défendeurs.
        </p>
      </Article>
    </LegalPageLayout>
  );
}
