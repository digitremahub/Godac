-- Réorganisation, Q1 révisée : type d'alerte « bulletins en attente de
-- validation direction ». Fichier séparé : une nouvelle valeur d'enum ne
-- peut pas être utilisée dans la transaction qui l'ajoute.
alter type public.alert_type add value if not exists 'payslip_validation';
