-- Revue GPT : réinitialisation des accès chauffeurs.
-- Après une réinitialisation du PIN (individuelle ou globale), le badge
-- seul ne suffit plus à choisir un nouveau PIN : un code d'activation à
-- usage unique, remis par l'encadrement, est exigé par
-- /api/auth/driver-pin/[id]/set. Seul le haché HMAC est stocké.
-- Table réservée au service role (RLS activée, aucune policy).
-- Idempotent et additif.

create table if not exists public.driver_pin_activations (
  user_id uuid primary key references public.users(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  code_hash text not null,
  expires_at timestamptz not null,
  failed_count integer not null default 0,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now()
);

alter table public.driver_pin_activations enable row level security;
revoke all on public.driver_pin_activations from anon, authenticated;

-- Révocation des sessions d'un compte (réinitialisation des accès) :
-- supabase-js n'expose la déconnexion admin que par jeton (JWT), pas par
-- identifiant. Supprimer les sessions invalide leurs jetons de
-- rafraîchissement (cascade) ; le jeton d'accès en cours expire seul
-- (durée de vie du JWT). Exécutable par le service role uniquement.
create or replace function public.revoquer_sessions_utilisateur(p_user_id uuid)
returns integer
language plpgsql
security definer
set search_path to ''
as $function$
declare
  n integer;
begin
  delete from auth.sessions where user_id = p_user_id;
  get diagnostics n = row_count;
  return n;
end;
$function$;

revoke all on function public.revoquer_sessions_utilisateur(uuid) from public, anon, authenticated;
grant execute on function public.revoquer_sessions_utilisateur(uuid) to service_role;
