-- Suite de 20260101000075 — dépose la colonne hourly_rate, superseded
-- par monthly_gross_salary/monthly_net_salary/contractual_monthly_hours.
-- Jamais utilisée en production (ajoutée puis retirée le même jour).
alter table users drop column hourly_rate;
