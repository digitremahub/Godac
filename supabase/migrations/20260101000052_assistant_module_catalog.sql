-- GODAC V2 — Lot B: catalogue du module "assistant" (chatbot d'aide +
-- relais humain). Suit exactement le motif de
-- 20260101000015_module_catalog.sql : une ligne dans `modules`, son
-- prix par plan généré dans `module_plan_prices` — mais surtout AUCUNE
-- ligne insérée dans `organization_modules`, pour rester désactivé par
-- défaut partout (contrairement aux modules V1 historiques qui avaient
-- été rétro-activés pour les organisations existantes).
insert into modules (key, name, description, wave, is_transverse, base_price, included_from_plan, sort_order) values
  ('assistant', 'Assistant & relais humain', 'Chatbot d''aide contextuelle (consignes, guide d''utilisation) avec relais automatique vers un responsable si besoin.', 'v2', false, 19, 'business', 29);

insert into module_plan_prices (module_key, plan_id, monthly_price, included)
select
  m.key,
  p.id,
  case
    when m.included_from_plan is not null
      and p.sort_order >= (select sort_order from plans where id = m.included_from_plan)
      then 0
    else round(m.base_price * 1.4, 2)
  end,
  m.included_from_plan is not null
    and p.sort_order >= (select sort_order from plans where id = m.included_from_plan)
from modules m
cross join plans p
where m.key = 'assistant';
