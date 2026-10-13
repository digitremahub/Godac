-- Tournée colis : abonnement payé par l'entreprise, chauffeurs illimités
-- et application GODAC Livreur (App Store / Google Play) gratuite pour eux.
update modules
set description = 'Application GODAC Livreur gratuite pour vos chauffeurs, sans limite de nombre (App Store et Google Play) : scan des colis, ordre de passage optimisé, appel du client, photo de livraison.'
where key = 'route_optimizer';
