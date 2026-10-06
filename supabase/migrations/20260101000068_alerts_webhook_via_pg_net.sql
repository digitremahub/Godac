-- GODAC V2 — le Dashboard Supabase (Database > Webhooks) échoue sur
-- ce projet avec "schema supabase_functions does not exist" (la
-- plateforme ne l'a pas auto-provisionné). Plutôt que dépendre de ce
-- provisioning, on recrée la même mécanique nous-mêmes avec pg_net
-- directement : un trigger sur insert dans public.alerts qui poste
-- vers /api/webhooks/supabase-alerts (voir ce fichier pour le format
-- de payload et le header attendus — x-webhook-secret, pas
-- Authorization, contrairement à Stripe qui signe son payload).
--
-- Le secret partagé lui-même n'est jamais écrit en clair ici : il vit
-- dans Supabase Vault (vault.create_secret, exécuté une fois en
-- dehors de toute migration versionnée) et cette fonction le relit à
-- chaque appel via vault.decrypted_secrets.
create extension if not exists pg_net;

create or replace function public.notify_alert_webhook()
returns trigger
language plpgsql
security definer
set search_path = public, net, vault
as $$
declare
  webhook_secret text;
begin
  select decrypted_secret into webhook_secret from vault.decrypted_secrets where name = 'alerts_webhook_secret';
  if webhook_secret is null then
    return NEW;
  end if;

  perform net.http_post(
    url := 'https://godac-v2.vercel.app/api/webhooks/supabase-alerts',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-webhook-secret', webhook_secret),
    body := jsonb_build_object('type', 'INSERT', 'table', 'alerts', 'record', to_jsonb(NEW))
  );
  return NEW;
end;
$$;

create trigger alerts_notify_webhook
  after insert on public.alerts
  for each row
  execute function public.notify_alert_webhook();

-- A trigger function never needs to be callable directly via
-- PostgREST RPC — revoke what create function grants by default.
revoke execute on function public.notify_alert_webhook() from public, anon, authenticated;
