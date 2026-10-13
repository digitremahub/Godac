# GODAC Livreur — publication sur l'App Store et Google Play

L'application des stores est une coque native (Capacitor) autour de
l'application chauffeur GODAC (`https://godac.app/livreur`) :

- **gratuite pour les chauffeurs**, sans limite de nombre — c'est
  l'entreprise qui paie le module « Tournée colis » ;
- toute mise à jour du site est aussitôt dans l'application, sans
  repasser par la validation d'Apple ou de Google ;
- en plus du site : scanner de codes natif Google (QR, Datamatrix,
  codes-barres 1D), écran toujours allumé pendant la tournée, icône et
  écran de démarrage GODAC, page « pas de connexion ».

Identifiant de l'application : `fr.godac.livreur` — nom : **GODAC Livreur**.

## 1. Les comptes à ouvrir (une seule fois)

| Store | Où | Coût |
| --- | --- | --- |
| Google Play | https://play.google.com/console | 25 $ une fois |
| App Store | https://developer.apple.com/programs/ | 99 $ / an |

Sans SIRET, Apple et Google ouvrent un compte « particulier » : votre nom
apparaîtra comme éditeur sur la fiche. Avec un SIRET (et un numéro D-U-N-S
pour Apple, gratuit), le compte peut être au nom de l'entreprise.

## 2. Android (Google Play) — depuis Windows, rien à installer

1. Créer la clé de signature (une fois, à conserver précieusement : sans
   elle, plus de mise à jour possible). Avec Java installé :
   ```
   keytool -genkeypair -v -keystore godac.keystore -alias godac -keyalg RSA -keysize 2048 -validity 10000
   ```
2. Dans GitHub → dépôt Godac → Settings → Secrets and variables → Actions,
   ajouter :
   - `ANDROID_KEYSTORE_BASE64` : le fichier `godac.keystore` encodé en base64
     (PowerShell : `[Convert]::ToBase64String([IO.File]::ReadAllBytes("godac.keystore"))`)
   - `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS` (`godac`), `ANDROID_KEY_PASSWORD`
3. GitHub → Actions → « Application GODAC Livreur » → Run workflow.
   Résultat (onglet de l'exécution, « Artifacts ») :
   - `godac-livreur-test.apk` : à installer directement sur un téléphone
     Android pour tester (même sans les secrets) ;
   - `godac-livreur-google-play.aab` : le fichier à envoyer dans la Play
     Console (Production ou Test interne).

## 3. iPhone (App Store) — compilé sur un Mac de GitHub

Une application iOS ne peut être compilée que sur un Mac : le workflow
utilise un Mac de GitHub, vous n'en avez pas besoin.

1. Sur https://appstoreconnect.apple.com : Apps → « + » → Nouvelle app,
   identifiant de bundle `fr.godac.livreur` (créé au préalable dans
   developer.apple.com → Identifiers).
2. App Store Connect → Utilisateurs et accès → Intégrations → Clés d'API
   App Store Connect → générer une clé (rôle **App Manager**). Noter
   l'**Issuer ID**, le **Key ID** et télécharger le fichier `.p8`.
3. Secrets GitHub :
   - `APPLE_TEAM_ID` (developer.apple.com → Membership)
   - `APP_STORE_CONNECT_KEY_ID`, `APP_STORE_CONNECT_ISSUER_ID`
   - `APP_STORE_CONNECT_KEY_BASE64` : le fichier `.p8` en base64
4. Run workflow : la version part directement sur **TestFlight**, d'où
   on l'envoie en validation.

## 4. Fiche des stores (textes prêts)

**Nom** : GODAC Livreur
**Sous-titre (Apple, 30 car.)** : Tournées colis optimisées
**Description courte (Google, 80 car.)** : Scannez vos colis, GODAC trace la meilleure tournée et vous guide arrêt par arrêt.

**Description** :
> GODAC Livreur est l'application des chauffeurs-livreurs des entreprises
> qui utilisent GODAC.
>
> • Scannez vos colis (QR, Datamatrix, codes-barres) ou photographiez
>   l'étiquette : les adresses s'ajoutent toutes seules à votre tournée.
> • GODAC calcule le meilleur ordre de passage, et le recalcule depuis votre
>   position si besoin.
> • Arrêt par arrêt : navigation Waze ou Google Maps, appel du client en un
>   geste, SMS « j'arrive ».
> • Livré, boîte aux lettres, voisin… : photo du colis déposé comme preuve
>   de livraison.
> • Import d'un itinéraire Google Maps ou d'une liste d'adresses.
>
> Application gratuite pour les chauffeurs. Un compte GODAC fourni par votre
> entreprise est nécessaire.

**Catégorie** : Productivité (Apple) / Cartes et navigation ou Entreprise (Google)
**Politique de confidentialité** : https://godac.app/confidentialite
**Site / assistance** : https://godac.app — contact@godac.fr

**Captures d'écran** : 3 à 5 captures du téléphone (arrêt en cours, liste
des adresses, scan, photo de livraison). Apple exige des captures 6,9"
(1320 × 2868) ; Google accepte toute capture de téléphone.

## 5. Validation : ce que demandent Apple et Google

- **Compte de démonstration** : l'application exige un compte entreprise,
  il faut donc fournir aux validateurs un identifiant chauffeur de test
  (par exemple un chauffeur de l'organisation de démonstration) avec une
  tournée colis chargée.
- **Apple, règle 4.2 (« simple site web »)** : à mettre en avant dans les
  notes de validation — scanner de codes natif, écran maintenu allumé,
  appel / SMS / navigation, appareil photo pour la preuve de livraison.
- **Google, « Sécurité des données »** : données collectées = nom et
  téléphone des destinataires, adresses, photos (preuve de livraison),
  position approximative et précise (uniquement sur demande, pour recalculer
  la tournée) ; chiffrées en transit ; pas de partage avec des tiers à des
  fins publicitaires ; suppression sur demande (contact@godac.fr).
- **Apple, « Confidentialité de l'app »** : mêmes catégories, « non liées
  au suivi ».

## 6. Développement

```
cd mobile
npm install
npx cap sync          # après chaque changement de capacitor.config.ts
npm run assets        # régénère icônes et écrans de démarrage depuis assets/
npx cap open android  # Android Studio
npx cap open ios      # Xcode (Mac uniquement)
```

`GODAC_URL=https://preprod.exemple npx cap sync` pointe l'application vers
un autre site (tests).
