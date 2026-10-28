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
          ligne. Le Client déclare agir à des fins entrant dans le champ de son activité professionnelle principale : aucun droit de
          rétractation ne s’applique.
        </p>
        <p>
          Les devis et bons de commande émis par l’Éditeur sont valables trente (30) jours. L’offre « Fondateur », lorsqu’elle
          est proposée, est réservée aux dix premiers clients et figure sur le bon de commande.
        </p>
        <p>
          <strong>Essai gratuit.</strong> L’Éditeur peut proposer un essai gratuit sur invitation (essai « GO Navigation » :
          trente (30) jours, limité à la Tournée colis et à la navigation chauffeur, avec des plafonds mensuels d’utilisation).
          L’essai n’est pas facturé, n’engage à aucune souscription et ne se transforme jamais en abonnement sans bon de
          commande ou souscription en ligne du Client. À son terme, l’accès est fermé sauf souscription ; les données de l’essai
          sont alors traitées comme celles d’un contrat arrivé à son terme (article 11). L’essai est fourni en l’état, sans
          engagement de niveau de service.
        </p>
      </Article>

      <Article n={4} titre="Description du service">
        <p>
          L’Éditeur met la Solution à disposition du Client en mode SaaS (logiciel en ligne), dont les données sont stockées sur des serveurs situés en France (région de Paris). Le
          périmètre fonctionnel dépend de la Formule et des Modules souscrits, décrits sur la{" "}
          <Link href="/modules" className={lien}>page Modules & tarifs</Link> à la date de la commande.
        </p>
        <p>
          L’application mobile GODAC Livreur est mise à la disposition des chauffeurs du Client lorsque le module « Tournée
          colis » est souscrit ; elle est gratuite pour le chauffeur et facturée au Client par palier d’utilisateurs (chauffeurs
          actifs), selon la grille publiée sur la page Modules & tarifs. Le palier est mis à jour automatiquement (chaque nuit) selon le
          nombre de chauffeurs actifs et validés, et s’applique à la prochaine échéance de facturation, sans prorata.
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
          facturés une seule fois, à la commande, ou en plusieurs mensualités sans frais lorsque la Formule ou le bon de
          commande le prévoit (formule Starter : douze mensualités). Ils restent acquis à l’Éditeur ; en cas de résiliation
          anticipée de l’offre standard pendant l’engagement initial, les mensualités restantes deviennent exigibles.
        </p>
        <p>
          L’Éditeur ouvre l’accès dans un délai indicatif de dix (10) jours ouvrés à compter de la réception des
          informations nécessaires. Le Client fournit des données exactes et à jour, et désigne un interlocuteur.
        </p>
      </Article>

      <Article n={6} titre="Durée, engagement et résiliation">
        <p>
          Le bon de commande indique l’une des deux offres suivantes. À défaut de mention, l’offre standard s’applique.
        </p>
        <ul className={listeLegale}>
          <li>
            <strong>Essai gratuit</strong> (article 3) : sans engagement ni reconduction. S’il est suivi d’une souscription,
            celle-ci prend la forme de l’une des deux offres ci-dessous, indiquée au bon de commande.
          </li>
          <li>
            <strong>Pilote sans engagement</strong> (case « Pilote sans engagement » du bon de commande) : abonnement mensuel,
            sans durée minimale, qui se renouvelle tacitement de mois en mois. Chaque partie peut y mettre fin à tout moment par
            écrit (e-mail à {EDITEUR.email} ou depuis l’espace Facturation) ; la résiliation prend effet à la fin du mois en
            cours, qui reste dû, sans autre frais ni indemnité. Les frais de mise en service éventuels sont ceux indiqués au bon
            de commande (article 5). Le passage à l’offre standard fait l’objet d’un nouveau bon de commande ; l’engagement de
            douze mois court alors à la date qu’il indique.
          </li>
          <li>
            <strong>Offre standard 12 mois</strong> (case « Offre standard 12 mois » du bon de commande) : engagement initial
            ferme de douze (12) mois à compter de l’ouverture de l’accès, sauf durée différente prévue au bon de commande. À son
            terme, l’abonnement se renouvelle tacitement par périodes d’un (1) mois. Chaque partie peut y mettre fin par écrit
            avec un préavis d’un (1) mois ; la résiliation prend effet à la fin du mois de préavis ou, si elle est postérieure,
            à la fin de l’engagement initial. Pendant l’engagement initial, l’abonnement est ferme et ne peut être résilié avant
            son terme que dans les cas prévus au contrat (manquement, article 17 ; force majeure, article 16 ; révision des
            prix, article 7 ; modification des CGV, article 20 ; nouveau sous-traitant ultérieur refusé, accord de
            sous-traitance).
          </li>
        </ul>
        <p>
          La facturation est la même dans les deux offres : mensuelle, terme à échoir (article 7). À la fin du contrat, les
          données sont traitées selon l’article 11.
        </p>
      </Article>

      <Article n={7} titre="Prix, facturation et paiement">
        <ul className={listeLegale}>
          <li>Les prix sont exprimés en euros hors taxes ; la TVA au taux en vigueur s’y ajoute.</li>
          <li>
            Client assujetti établi hors de France : la TVA française n’est pas facturée lorsque la prestation est imposable
            dans son pays selon les règles de territorialité de la TVA (autoliquidation par le Client) ; le Client indique son
            numéro de TVA sur le bon de commande.
          </li>
          <li>
            L’abonnement (Formule + Modules optionnels) est facturé mensuellement, terme à échoir, et payable à réception par
            prélèvement SEPA ou carte bancaire.
          </li>
          <li>
            Le Client peut ajouter des Modules à tout moment ; ils sont facturés à compter du mois de leur activation. Le
            retrait d’un Module prend effet à la fin de la période d’engagement en cours (offre pilote : à la fin du mois en cours).
          </li>
          <li>
            Les fonctions de lecture automatique et l’assistant (article 12) sont incluses dans chaque Formule dans la limite
            d’un volume mensuel par fonction, publié sur la page{" "}
            <Link href="/modules" className={lien}>Modules &amp; tarifs</Link>. Au-delà, et si le Client a autorisé le
            dépassement facturé (option activée par défaut, modifiable à tout moment par la direction dans son espace), chaque
            utilisation supplémentaire est facturée au prix unitaire publié sur cette même page, en fin de mois, sur la facture
            suivante de l’abonnement. Si le Client a désactivé cette option, la fonction concernée est suspendue jusqu’au mois
            suivant, la saisie manuelle restant possible. Le Client est alerté à 80 % et à 100 % du volume inclus et suit sa
            consommation dans son espace. Une limite journalière de sécurité peut s’appliquer pour prévenir tout usage anormal.
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
          facturation. Les Données du Client sont conservées pendant la suspension. Aucun escompte n’est accordé pour paiement anticipé.
        </p>
      </Article>

      <Article n={9} titre="Obligations de l’Éditeur">
        <ul className={listeLegale}>
          <li>Fournir la Solution conformément à sa description, avec diligence et selon les règles de l’art (obligation de moyens).</li>
          <li>
            Stocker les Données du Client sur des serveurs situés en France (région de Paris), auprès des prestataires
            listés dans l’accord de sous-traitance, et en assurer la sécurité et la sauvegarde dans les conditions de
            l’engagement de service.
          </li>
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
          <li>
            Informer individuellement ses salariés des traitements de données réalisés via la Solution (pointage, position au
            pointage, pointage assisté, suivi d’une tournée colis en cours, photos…), consulter son comité social et économique
            lorsqu’il existe, tenir son registre des traitements et, si nécessaire, réaliser une analyse d’impact. Le Client
            n’utilise pas ces données pour surveiller un salarié en dehors de son temps de travail.
          </li>
          <li>
            Vérifier les résultats produits par la Solution avant toute décision (article 13). Le Client demeure seul
            responsable, en qualité d’employeur et de transporteur, de ses bulletins de paie et déclarations sociales, du
            respect des temps de conduite et de repos, de la désignation des conducteurs, du traitement des réclamations de
            ses clients et de ses obligations fiscales.
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
          à l’Éditeur, dans les trente (30) jours suivant la fin du contrat, un export dans un format standard (CSV). Les
          Données du Client sont supprimées trois (3) mois après la fin du contrat, sauf obligation légale de conservation.
          Au moins trente (30) jours avant cette suppression, l’Éditeur adresse un préavis par e-mail aux administrateurs
          (rôle direction) de l’espace du Client, qui rappelle la date de suppression et la possibilité d’exporter les
          données ; il s’efforce de fournir l’export demandé avant cette date. La suppression est suspendue tant qu’un
          litige est déclaré entre les parties. L’Éditeur ne conserve ensuite que le strict nécessaire : données de
          facturation et identifiants de paiement, preuves d’acceptation du contrat et du préavis, trace de la suppression, pendant
          les durées légales applicables.
        </p>
        <p>
          GODAC n’est pas un service d’archivage légal : le Client exporte et archive lui-même, avant cette suppression, les
          documents qu’il doit conserver (notamment les bulletins de paie, dont la durée légale de conservation par
          l’employeur est de cinquante ans, ses factures et ses justificatifs fiscaux).
        </p>
      </Article>

      <Article n={12} titre="Fonctions d’intelligence artificielle">
        <p>
          Les modules de lecture automatique (photos de tickets, compteurs, étiquettes, amendes, réclamations) et
          l’assistant reposent sur un service d’intelligence artificielle. Ils sont désactivés par défaut et activés au choix
          du Client. Leurs résultats sont proposés à la vérification d’un Utilisateur et peuvent comporter des erreurs.
        </p>
      </Article>

      <Article n={13} titre="Outil d’organisation : paramètres légaux, calculs et déclarations">
        <p>
          GODAC est un outil d’organisation et de gain de temps. Il prépare, calcule et met en forme, à partir des données et
          des paramètres de l’entreprise, des éléments tels que les bulletins de paie, les heures, les congés et les heures
          supplémentaires, la TICPE (barème, éligibilité, récapitulatifs et documents de déclaration, notamment 3310-TIC /
          douane) et les consommations de carburant.
        </p>
        <ul className={listeLegale}>
          <li>
            L’Éditeur fournit des paramètres par défaut (barèmes, taux, seuils) qu’il s’efforce de tenir à jour. Ils sont
            donnés à titre indicatif et ne constituent ni un conseil juridique, fiscal, comptable ou social, ni une prestation
            d’expertise comptable.
          </li>
          <li>
            Le Client reste seul responsable de vérifier, avant tout usage, les paramètres légaux et conventionnels applicables
            à son entreprise (convention collective, régime, taux, éligibilité et barème TICPE…), les calculs et les
            résultats, ainsi que de l’exactitude de ses bulletins de paie, de ses déclarations sociales et fiscales et des
            remboursements qu’il demande.
          </li>
          <li>
            Le Client fait vérifier ces éléments par son expert-comptable ou son responsable paie avant toute déclaration ou
            remise de bulletin. Les écrans et documents concernés portent la mention « Document établi à titre indicatif par
            GODAC à partir des paramètres de l’entreprise. À faire vérifier par votre expert-comptable / responsable paie
            avant tout usage déclaratif. » ; la direction ou le comptable peut en accuser lecture dans la Solution
            (l’accusé est daté et tracé au journal d’audit).
          </li>
          <li>
            L’Éditeur s’efforce de corriger toute erreur de calcul ou de paramètre par défaut qui lui est signalée, dans les
            délais de l’engagement de service. Ces stipulations ne limitent pas sa responsabilité au-delà de l’article 15 et ne
            s’appliquent pas en cas de faute lourde ou dolosive.
          </li>
        </ul>
      </Article>

      <Article n={14} titre="Propriété intellectuelle">
        <p>
          La Solution, la marque GODAC, les logiciels, bases et contenus fournis par l’Éditeur restent sa propriété. L’Éditeur
          concède au Client, pour la durée du contrat et pour ses besoins internes, un droit d’utilisation personnel, non
          exclusif et non cessible de la Solution. Toute reproduction, décompilation ou mise à disposition de tiers est
          interdite. Le Client autorise l’Éditeur à héberger et traiter les Données du Client pour la seule fourniture de la Solution.
        </p>
      </Article>

      <Article n={15} titre="Limitation de responsabilité">
        <p>
          Chaque partie répond des dommages directs causés par ses manquements prouvés. L’Éditeur ne répond pas des dommages
          indirects (perte de chiffre d’affaires, de clientèle ou de données imputable au Client), ni des amendes, pénalités,
          majorations ou redressements résultant des données ou paramètres saisis ou validés par le Client, ou de
          l’absence des vérifications prévues à l’article 13. Sauf faute lourde ou dolosive, et sauf dommage corporel, la
          responsabilité totale de l’Éditeur au titre du contrat est limitée aux sommes hors taxes payées par le Client au
          titre des douze (12) mois précédant le fait générateur (ou, si le contrat a moins de douze mois, aux sommes dues
          pour la première année). Cette limite ne s’applique pas à l’obligation de paiement du Client.
        </p>
      </Article>

      <Article n={16} titre="Force majeure">
        <p>
          Aucune partie n’est responsable d’un manquement dû à un cas de force majeure au sens de l’article 1218 du Code
          civil (notamment panne générale des réseaux ou défaillance d’un hébergeur lorsqu’elle présente les caractères de la force majeure,
          catastrophe, décision administrative). Si
          l’empêchement dure plus de trente (30) jours, chaque partie peut résilier le contrat sans indemnité.
        </p>
      </Article>

      <Article n={17} titre="Résiliation pour manquement">
        <p>
          En cas de manquement grave d’une partie, non réparé trente (30) jours après une mise en demeure par lettre
          recommandée ou e-mail avec accusé de réception, l’autre partie peut résilier le contrat de plein droit, sans
          préjudice de dommages et intérêts.
        </p>
      </Article>

      <Article n={18} titre="Confidentialité">
        <p>
          Chaque partie garde confidentielles les informations de l’autre dont elle a connaissance dans le cadre du contrat,
          pendant sa durée et trois (3) ans après son terme.
        </p>
      </Article>

      <Article n={19} titre="Référence commerciale">
        <p>
          Sauf opposition écrite du Client, l’Éditeur peut citer son nom et son logo comme référence client, sans divulguer
          aucune donnée de son activité.
        </p>
      </Article>

      <Article n={20} titre="Modification des CGV">
        <p>
          L’Éditeur peut faire évoluer les présentes CGV ; la nouvelle version est notifiée au Client au moins trente (30)
          jours avant son entrée en vigueur. En cas de désaccord, le Client peut résilier sans frais avant cette date.
        </p>
      </Article>

      <Article n={21} titre="Droit applicable et litiges">
        <p>
          Le contrat est soumis au droit français. Les parties recherchent d’abord une solution amiable. À défaut, tout
          litige relève de la compétence exclusive de {juridiction()}, y compris en cas de référé ou de pluralité de
          défendeurs.
        </p>
      </Article>
    </LegalPageLayout>
  );
}
