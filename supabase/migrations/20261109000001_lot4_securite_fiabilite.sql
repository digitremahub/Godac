-- Lot 4 (audit sécurité / performance / fiabilité) : compteurs atomiques et
-- journal d'erreurs.
--
-- 1. rate_limits + consommer_limite : limiteur de débit (fenêtre glissante
--    approchée par deux fenêtres fixes pondérées), incrément atomique. Sert
--    aussi de « jeton à usage unique » (challenge passkey).
-- 2. pin_essais + reserver_essai_pin : essais de code PIN comptés AVANT la
--    vérification, de façon atomique (verrou de ligne). Un verrou par couple
--    compte + adresse IP (hachée), plus un verrou de compte à seuil élevé :
--    un tiers ne peut plus bloquer un chauffeur à distance en 5 essais.
-- 3. erreurs_client + enregistrer_erreur_client : journal borné des erreurs
--    d'affichage (app/error.tsx), sans donnée personnelle.
-- 4. usage_events : jetons lus/écrits et unités « réelles » des appels d'IA
--    (journalisation seule : les quotas et la facturation restent sur `units`).
--
-- ADDITIVE et rejouable ; NON appliquée à la création. Le code reste
-- fonctionnel sans elle (repli en mémoire, ancien compteur PIN).

-- ── 1. Limiteur de débit ───────────────────────────────────────────
create table if not exists public.rate_limits (
  cle text not null,
  fenetre bigint not null,
  compteur integer not null default 0,
  maj timestamptz not null default now(),
  primary key (cle, fenetre)
);
alter table public.rate_limits enable row level security;

create or replace function public.consommer_limite(p_cle text, p_max integer, p_fenetre_s integer)
returns table (autorise boolean, retry_apres_s integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now double precision := extract(epoch from clock_timestamp());
  v_fenetre bigint := floor(v_now / p_fenetre_s);
  v_ecoule double precision := v_now - v_fenetre * p_fenetre_s;
  v_courant integer;
  v_precedent integer;
  v_estime double precision;
begin
  insert into public.rate_limits as r (cle, fenetre, compteur) values (p_cle, v_fenetre, 1)
  on conflict (cle, fenetre) do update set compteur = r.compteur + 1, maj = now()
  returning r.compteur into v_courant;

  select r.compteur into v_precedent from public.rate_limits r where r.cle = p_cle and r.fenetre = v_fenetre - 1;
  v_estime := v_courant + coalesce(v_precedent, 0) * (1 - v_ecoule / p_fenetre_s);

  -- Ménage occasionnel : les fenêtres de plus d'un jour ne servent plus.
  if random() < 0.02 then
    delete from public.rate_limits where maj < now() - interval '1 day';
  end if;

  if v_estime <= p_max then
    return query select true, 0;
  else
    return query select false, greatest(1, ceil(p_fenetre_s - v_ecoule)::integer);
  end if;
end;
$$;

-- ── 2. Essais de code PIN ──────────────────────────────────────────
create table if not exists public.pin_essais (
  user_id uuid not null references public.users (id) on delete cascade,
  -- Empreinte de l'adresse IP, ou '*' pour le compteur du compte entier.
  cle text not null,
  essais integer not null default 0,
  verrou_jusqua timestamptz,
  dernier_essai timestamptz not null default now(),
  primary key (user_id, cle)
);
alter table public.pin_essais enable row level security;

-- Réserve un essai sur une clé : incrément sous verrou de ligne, donc des
-- essais en parallèle ne dépassent jamais le maximum. Le dernier essai
-- permis pose le verrou tout de suite.
create or replace function public._pin_reserver(
  p_user_id uuid, p_cle text, p_max integer, p_minutes integer,
  out r_autorise boolean, out r_essais integer, out r_verrou timestamptz, out r_dernier boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_essais integer;
  v_verrou timestamptz;
  v_dernier_essai timestamptz;
begin
  insert into public.pin_essais (user_id, cle) values (p_user_id, p_cle) on conflict do nothing;
  select e.essais, e.verrou_jusqua, e.dernier_essai into v_essais, v_verrou, v_dernier_essai
    from public.pin_essais e where e.user_id = p_user_id and e.cle = p_cle for update;

  r_dernier := false;
  if v_verrou is not null and v_verrou > now() then
    r_autorise := false; r_essais := v_essais; r_verrou := v_verrou;
    return;
  end if;
  -- Verrou expiré ou compteur ancien (plus de 24 h sans essai) : on repart de zéro.
  if v_verrou is not null or v_dernier_essai < now() - interval '1 day' then v_essais := 0; end if;

  v_essais := v_essais + 1;
  r_autorise := true;
  r_dernier := v_essais >= p_max;
  r_essais := v_essais;
  r_verrou := case when r_dernier then now() + make_interval(mins => p_minutes) else null end;
  update public.pin_essais
     set essais = case when r_dernier then 0 else v_essais end,
         verrou_jusqua = r_verrou,
         dernier_essai = now()
   where user_id = p_user_id and cle = p_cle;
end;
$$;

create or replace function public.reserver_essai_pin(
  p_user_id uuid, p_cle_ip text, p_max_ip integer, p_max_compte integer, p_minutes integer
)
returns table (autorise boolean, portee text, restants integer, verrou_jusqua timestamptz, vient_de_verrouiller boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  a record;
  b record;
begin
  select * into a from public._pin_reserver(p_user_id, p_cle_ip, p_max_ip, p_minutes);
  if not a.r_autorise then
    return query select false, 'ip'::text, 0, a.r_verrou, false;
    return;
  end if;
  select * into b from public._pin_reserver(p_user_id, '*', p_max_compte, p_minutes);
  if not b.r_autorise then
    return query select false, 'compte'::text, 0, b.r_verrou, false;
    return;
  end if;
  return query select true, case when b.r_dernier then 'compte' else 'ip' end::text,
    greatest(p_max_ip - a.r_essais, 0), coalesce(b.r_verrou, a.r_verrou), (a.r_dernier or b.r_dernier);
end;
$$;

-- ── 3. Journal des erreurs d'affichage ─────────────────────────────
create table if not exists public.erreurs_client (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  origine text not null,
  message text not null,
  digest text,
  chemin text
);
alter table public.erreurs_client enable row level security;

create or replace function public.enregistrer_erreur_client(p_origine text, p_message text, p_digest text, p_chemin text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.erreurs_client (origine, message, digest, chemin)
  values (left(p_origine, 40), left(p_message, 300), left(p_digest, 80), left(p_chemin, 200));
  -- Stockage borné : on ne garde que les 2000 dernières lignes.
  if random() < 0.05 then
    delete from public.erreurs_client
     where id not in (select id from public.erreurs_client order by id desc limit 2000);
  end if;
end;
$$;

-- Appelables uniquement avec la clé service (côté serveur).
revoke all on function public.consommer_limite(text, integer, integer) from public, anon, authenticated;
revoke all on function public._pin_reserver(uuid, text, integer, integer) from public, anon, authenticated;
revoke all on function public.reserver_essai_pin(uuid, text, integer, integer, integer) from public, anon, authenticated;
revoke all on function public.enregistrer_erreur_client(text, text, text, text) from public, anon, authenticated;
grant execute on function public.consommer_limite(text, integer, integer) to service_role;
grant execute on function public.reserver_essai_pin(uuid, text, integer, integer, integer) to service_role;
grant execute on function public.enregistrer_erreur_client(text, text, text, text) to service_role;

-- ── 4. Consommation réelle des appels d'IA ─────────────────────────
alter table public.usage_events add column if not exists tokens_entree integer;
alter table public.usage_events add column if not exists tokens_sortie integer;
-- Équivalent en unités de la consommation réelle (information interne : ni
-- les quotas ni la facturation ne s'appuient dessus).
alter table public.usage_events add column if not exists unites_reelles numeric(8, 2);
