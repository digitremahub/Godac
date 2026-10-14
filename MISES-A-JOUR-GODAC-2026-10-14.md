# Mises à jour GODAC — 14 octobre 2026

## Modifications prévues dans cette branche

- Recherche dans la tournée par adresse, destinataire, téléphone ou code colis.
- Protection côté interface et API : une tournée clôturée (`done`) ne peut plus être supprimée.
- Confirmation de départ dans l'application chauffeur : le chauffeur doit confirmer les listes/villages avant de démarrer.
- Les boutons de départ dans l'interface d'exploitation redirigent vers l'application chauffeur afin de passer par cette confirmation.
- Lors de l'ajout manuel ou de l'import d'adresses, GODAC crée/réutilise une liste portant le nom de la commune lorsqu'elle est identifiable dans l'adresse.
- L'optimisation utilise une matrice de distances routières OSRM pour ordonner les arrêts et les listes-villages. Si le moteur routier est indisponible ou si la matrice est trop grande, GODAC revient à une estimation géographique et le résumé le signale.
- Les horaires professionnels peuvent être consultés gratuitement via OpenStreetMap / Overpass au moment de l'optimisation. Aucun horaire n'est enregistré automatiquement. Les horaires saisis par l'entreprise restent prioritaires.
- L'historique des tournées clôturées reste disponible à la direction.

## Services gratuits

- Aucun compte Google, aucune clé API payante et aucune variable Google ne sont requis.
- `ROUTING_URL` est facultative. Par défaut, l'application utilise `https://router.project-osrm.org`.
- La recherche d'horaires utilise le service public Overpass d'OpenStreetMap. Les horaires ne sont pas toujours renseignés et le service public peut être limité ou indisponible ; dans ce cas, GODAC continue avec les horaires déjà connus.

## Vérifications

Le contrôle TypeScript complet, les tests et le build n'ont pas pu être confirmés dans cet environnement, car l'installation des dépendances npm n'a pas abouti. Avant fusion/déploiement, lancer `npm ci`, `npm run typecheck`, `npm test` et `npm run build`, puis tester une tournée avec plusieurs villages, des horaires OSM disponibles/absents et une tournée clôturée.
