import "server-only";
import { createHmac } from "crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { journaliser } from "@/lib/audit/journal";
import { empreinteIp, ipDepuisEntetes } from "@/lib/http/limite-debit";

/**
 * Code PIN des chauffeurs, protégé contre la devinette :
 * - le mot de passe Supabase n'est jamais le PIN lui-même mais une
 *   empreinte HMAC (secret serveur PIN_PEPPER) : impossible de tester des
 *   PIN en appelant Supabase directement, tout passe par GODAC ;
 * - 5 essais depuis la même adresse IP → verrouillé 15 minutes pour cette
 *   adresse ; 20 essais toutes adresses confondues → compte verrouillé
 *   15 minutes, alerte à la direction. Un tiers qui connaît un badge ne peut
 *   donc plus bloquer le chauffeur à distance en 5 essais. L'essai est
 *   réservé AVANT la vérification, de façon atomique (fonction SQL
 *   reserver_essai_pin) : des essais en parallèle ne dépassent pas la limite.
 * Les anciens comptes (mot de passe = PIN) sont convertis à la première
 * connexion réussie.
 */
export const ESSAIS_MAX = 5;
export const VERROU_MINUTES = 15;
/** Essais permis depuis une même adresse IP avant son verrou. */
export const ESSAIS_MAX_IP = ESSAIS_MAX;
/** Essais permis sur un compte, toutes adresses confondues, avant le verrou du compte. */
export const ESSAIS_MAX_COMPTE = 20;

function secret(): string {
  const s = process.env.PIN_PEPPER || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!s) throw new Error("PIN_PEPPER is not configured");
  return s;
}

/**
 * Secret utilisé avant la création de PIN_PEPPER (repli sur la clé
 * service) : les PIN convertis à cette époque sont encore acceptés, puis
 * réécrits avec PIN_PEPPER à la première connexion réussie.
 */
function secretHerite(): string | null {
  if (!process.env.PIN_PEPPER) return null;
  const s = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return s && s !== process.env.PIN_PEPPER ? s : null;
}

function empreinte(cle: string, userId: string, pin: string): string {
  return createHmac("sha256", cle).update(`${userId}:${pin}`).digest("hex");
}

/** Mot de passe Supabase dérivé du PIN (jamais exposé au navigateur). */
export function motDePassePin(userId: string, pin: string): string {
  return empreinte(secret(), userId, pin);
}

/** Mots de passe acceptés à la connexion, hors celui en vigueur : ancienne clé, puis PIN en clair (comptes historiques). */
export function motsDePasseHerites(userId: string, pin: string): string[] {
  const herite = secretHerite();
  return [...(herite ? [empreinte(herite, userId, pin)] : []), pin];
}

/** État du verrou : minutes restantes si verrouillé. */
export function verrouActif(lockedUntil: string | null, now: Date = new Date()): number | null {
  if (!lockedUntil) return null;
  const reste = Date.parse(lockedUntil) - now.getTime();
  return reste > 0 ? Math.ceil(reste / 60000) : null;
}

function sondeAnonyme() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export type ResultatPin = { ok: true } | { ok: false; status: number; error: string };

type Reservation = { autorise: boolean; portee: "ip" | "compte"; restants: number; verrou_jusqua: string | null; vient_de_verrouiller: boolean };

/** Adresse IP de la requête en cours, hachée ; "inconnue" hors contexte de requête. */
async function ipHachee(): Promise<string> {
  try {
    const { headers } = await import("next/headers");
    return empreinteIp(ipDepuisEntetes(await headers()));
  } catch {
    return empreinteIp("inconnue");
  }
}

/**
 * Réserve un essai (atomique). `null` si la fonction SQL n'existe pas encore
 * (migration non appliquée) : l'appelant garde l'ancien compteur.
 */
async function reserverEssai(admin: SupabaseClient, userId: string): Promise<Reservation | null> {
  const { data, error } = await admin.rpc("reserver_essai_pin", {
    p_user_id: userId,
    p_cle_ip: await ipHachee(),
    p_max_ip: ESSAIS_MAX_IP,
    p_max_compte: ESSAIS_MAX_COMPTE,
    p_minutes: VERROU_MINUTES,
  });
  const ligne = (Array.isArray(data) ? data[0] : data) as Reservation | null;
  if (error || !ligne || typeof ligne.autorise !== "boolean") {
    if (error) console.warn("verifierPin: essais atomiques indisponibles, ancien compteur", error.code ?? error.message);
    return null;
  }
  return ligne;
}

async function prevenirVerrou(admin: SupabaseClient, user: { id: string; organization_id: string; full_name: string }, portee: "ip" | "compte") {
  // Verrou d'une seule adresse : simple trace ; verrou du compte : alerte à la direction.
  if (portee === "compte") {
    await admin.from("alerts").insert({
      organization_id: user.organization_id,
      type: "security",
      severity: "critical",
      message: `Code PIN de ${user.full_name} bloqué ${VERROU_MINUTES} min après ${ESSAIS_MAX_COMPTE} essais incorrects.`,
      related_table: "users",
      related_id: user.id,
      recipient_roles: ["direction"],
    });
  }
  await journaliser({
    organizationId: user.organization_id,
    userId: null,
    action: "pin_bloque",
    targetTable: "users",
    targetId: user.id,
    details: { minutes: VERROU_MINUTES, portee },
  });
}

/**
 * Vérifie le PIN d'un compte et, si `session` est fourni, ouvre la session
 * sur ce client (cookies). Gère compteur, verrou et conversion des anciens
 * mots de passe (PIN en clair ou ancienne clé : re-hachés avec PIN_PEPPER à
 * la première connexion réussie).
 */
export async function verifierPin(
  user: { id: string; email: string; organization_id: string; full_name: string },
  pin: string,
  session?: SupabaseClient,
): Promise<ResultatPin> {
  const admin = createAdminSupabaseClient();
  const reservation = await reserverEssai(admin, user.id);
  if (reservation && !reservation.autorise) {
    const minutes = verrouActif(reservation.verrou_jusqua) ?? VERROU_MINUTES;
    return { ok: false, status: 429, error: `Trop d'essais : code bloqué encore ${minutes} min.${reservation.portee === "compte" ? " Un responsable a été prévenu." : ""}` };
  }
  // Ancien compteur (migration non appliquée) : lecture puis écriture, non atomique.
  const etat = reservation ? null : (await admin.from("pin_login_attempts").select("failed_count, locked_until").eq("user_id", user.id).maybeSingle()).data;
  const minutesHerite = verrouActif(etat?.locked_until ?? null);
  if (minutesHerite !== null) {
    return { ok: false, status: 429, error: `Trop d'essais : code bloqué encore ${minutesHerite} min. Un responsable a été prévenu.` };
  }

  const client = session ?? sondeAnonyme();
  const securise = motDePassePin(user.id, pin);
  let ok = !(await client.auth.signInWithPassword({ email: user.email, password: securise })).error;
  if (!ok) {
    // Ancien compte (PIN chiffré avant PIN_PEPPER, ou mot de passe = PIN) :
    // converti au mot de passe en vigueur dès qu'il est confirmé.
    for (const ancienMotDePasse of motsDePasseHerites(user.id, pin)) {
      const sonde = sondeAnonyme();
      const ancien = await sonde.auth.signInWithPassword({ email: user.email, password: ancienMotDePasse });
      if (ancien.error) continue;
      await sonde.auth.signOut({ scope: "local" });
      await admin.auth.admin.updateUserById(user.id, { password: securise });
      ok = !(await client.auth.signInWithPassword({ email: user.email, password: securise })).error;
      break;
    }
  }
  if (!session && ok) await client.auth.signOut({ scope: "local" });

  if (ok) {
    if (reservation) await admin.from("pin_essais").delete().eq("user_id", user.id);
    else if (etat) await admin.from("pin_login_attempts").delete().eq("user_id", user.id);
    return { ok: true };
  }

  if (reservation) {
    if (reservation.vient_de_verrouiller) {
      await prevenirVerrou(admin, user, reservation.portee);
      return { ok: false, status: 429, error: `Trop d'essais : code bloqué ${VERROU_MINUTES} min.${reservation.portee === "compte" ? " Un responsable a été prévenu." : ""}` };
    }
    return { ok: false, status: 401, error: messageEssaisRestants(reservation.restants) };
  }

  const echecs = (etat?.failed_count ?? 0) + 1;
  const verrouille = echecs >= ESSAIS_MAX;
  await admin.from("pin_login_attempts").upsert({
    user_id: user.id,
    failed_count: verrouille ? 0 : echecs,
    locked_until: verrouille ? new Date(Date.now() + VERROU_MINUTES * 60000).toISOString() : null,
    last_failed_at: new Date().toISOString(),
  });
  if (verrouille) {
    await prevenirVerrou(admin, user, "compte");
    return { ok: false, status: 429, error: `Trop d'essais : code bloqué ${VERROU_MINUTES} min. Un responsable a été prévenu.` };
  }
  return { ok: false, status: 401, error: messageEssaisRestants(ESSAIS_MAX - echecs) };
}

export function messageEssaisRestants(restants: number): string {
  return `Code PIN incorrect (${restants} essai${restants > 1 ? "s" : ""} restant${restants > 1 ? "s" : ""}).`;
}
