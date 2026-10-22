-- Ergonomie, lot 2 : le salarié est prévenu quand son bulletin est
-- disponible, c'est-à-dire validé par la direction (décision client Q1 :
-- rien ne prend effet sans cette validation, et la RLS ne montre au
-- salarié que ses bulletins validés).
--
-- Réutilise les alertes personnelles (alerts.recipient_user_id, migration
-- 20260101000029) : cloche, centre de notifications, e-mail et push
-- (webhook supabase-alerts) ; le lien ouvre « Mes fiches de paie »
-- (lib/alerts/resolve-url.ts, type payslip_available).
--
-- Migration ADDITIVE et rejouable : valeur d'enum « if not exists »,
-- fonction « create or replace », trigger créé seulement s'il est absent.
-- Aucun drop, aucune suppression de données. NON appliquée à la création.

-- 1. Type d'alerte. Ajouté ici, utilisé seulement à l'exécution du
--    trigger (jamais dans cette transaction), comme le permet
--    PostgreSQL ≥ 12 (même schéma que 20261022000001).
alter type public.alert_type add value if not exists 'payslip_available';

-- 2. Notification au salarié quand son bulletin passe à « validé ».
--    Un bulletin régénéré repasse « en attente » (payslips_guard_validation) :
--    sa nouvelle validation prévient de nouveau le salarié, sauf si une
--    notification non lue du même bulletin est encore ouverte.
create or replace function public.payslips_notifier_disponible()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if new.validation_status = 'valide'
     and old.validation_status is distinct from 'valide'
     and new.user_id is not null
     and not exists (
       select 1 from public.alerts a
       where a.related_table = 'payslips'
         and a.related_id = new.id
         and a.type::text = 'payslip_available'
         and a.status = 'open'
         and not exists (select 1 from public.alert_reads r where r.alert_id = a.id)
     ) then
    insert into public.alerts (organization_id, type, severity, message, related_table, related_id, recipient_user_id)
    values (
      new.organization_id,
      'payslip_available',
      'info',
      'Votre bulletin de paie de ' || to_char(new.period_start, 'MM/YYYY') || ' est disponible.',
      'payslips',
      new.id,
      new.user_id
    );
  end if;
  return null;
end;
$function$;

revoke execute on function public.payslips_notifier_disponible() from public, anon, authenticated;

do $$
begin
  if not exists (
    select 1 from pg_trigger
    where tgname = 'payslips_notifier_disponible'
      and tgrelid = 'public.payslips'::regclass
  ) then
    create trigger payslips_notifier_disponible
      after update of validation_status on public.payslips
      for each row execute function public.payslips_notifier_disponible();
  end if;
end
$$;
