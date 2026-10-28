import "server-only";
import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getCurrentAppUser, type AppUser } from "@/lib/auth/session";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { getEnabledModuleKeys } from "@/lib/organization/modules";
import { memoriserModule } from "@/lib/organization/modules-verifies";
import { lireEtatOffre } from "@/lib/go-navigation/etat";
import { MESSAGE_ESSAI_TERMINE, MESSAGE_OFFRE_INDETERMINEE } from "@/lib/go-navigation/offre";
import { MESSAGE_COMPTE_SUSPENDU } from "@/lib/comptes-essai/regles";
import { compteSuspenduDeLUtilisateurCourant } from "@/lib/comptes-essai/garde";
import { TOUS_LES_ROLES, deciderAcces, ecran as ecranDe, libelleModule, libelleRoles, type CleModule, type Ecran } from "@/lib/acces/catalogue";
import type { UserRole } from "@/lib/types/domain";

export type CodeRefus = "NON_CONNECTE" | "ROLE_REFUSE" | "MODULE_INACTIF" | "LIMITE_FORMULE" | "QUOTA_ATTEINT" | "COMPTE_SUSPENDU";

/**
 * Corps JSON homogène des refus. `error` reste une chaîne (les écrans
 * existants affichent `json.error`) ; `code` et les champs annexes
 * permettent un affichage plus riche.
 */
export interface CorpsRefus {
  error: string;
  code: CodeRefus;
  module?: string;
  modules?: string[];
  rolesAutorises?: UserRole[];
  utilise?: number;
  inclus?: number;
}

const STATUT: Record<CodeRefus, number> = { NON_CONNECTE: 401, ROLE_REFUSE: 403, MODULE_INACTIF: 403, LIMITE_FORMULE: 402, QUOTA_ATTEINT: 429, COMPTE_SUSPENDU: 403 };

export function refus(code: CodeRefus, message: string, extra: Omit<CorpsRefus, "error" | "code"> = {}): NextResponse<CorpsRefus> {
  return NextResponse.json({ error: message, code, ...extra }, { status: STATUT[code] });
}

export interface OptionsGarde {
  /** Rôles autorisés ; "tous" = tout membre actif. Prioritaire sur l'écran. */
  roles?: readonly UserRole[] | "tous";
  /** Modules tous requis. Ajoutés à ceux de l'écran. */
  modules?: readonly CleModule[];
  /** Au moins un de ces modules. */
  modulesAuMoinsUn?: readonly CleModule[];
  /** Raccourci : reprend rôles et modules du catalogue. */
  ecran?: string;
}

export type ResultatGardeApi =
  | { ok: true; appUser: AppUser; supabase: SupabaseClient; modules: ReadonlySet<string> }
  | { ok: false; reponse: NextResponse<CorpsRefus> };

/** Règle effective (fusion écran + options), pure. */
export function regleEffective(opts: OptionsGarde): Ecran {
  const base = opts.ecran ? ecranDe(opts.ecran) : undefined;
  const roles = opts.roles === "tous" || (!opts.roles && !base) ? TOUS_LES_ROLES : (opts.roles ?? base!.roles);
  return {
    id: base?.id ?? "api",
    section: base?.section ?? "dashboard",
    libelle: base?.libelle ?? "Cette action",
    href: base?.href ?? "",
    icone: base?.icone ?? "grid",
    roles,
    modules: [...(base?.modules ?? []), ...(opts.modules ?? [])],
    modulesAuMoinsUn: opts.modulesAuMoinsUn ?? base?.modulesAuMoinsUn,
    conducteur: base?.conducteur,
  };
}

/** Décision pure → réponse de refus, ou null si l'accès est accordé. */
export function refusPour(regle: Ecran, role: UserRole, modules: ReadonlySet<string>, conduit: boolean = role === "chauffeur"): NextResponse<CorpsRefus> | null {
  const d = deciderAcces(regle, role, modules, conduit);
  if (d.ok) return null;
  if (d.motif === "role" && d.conducteur) {
    return refus("ROLE_REFUSE", "Action réservée aux personnes qui conduisent (chauffeurs, managers qui conduisent aussi).", { rolesAutorises: [...d.rolesAutorises] });
  }
  if (d.motif === "role") {
    return refus("ROLE_REFUSE", `Action réservée à : ${libelleRoles(d.rolesAutorises)}.`, { rolesAutorises: [...d.rolesAutorises] });
  }
  const noms = d.modules.map(libelleModule);
  return refus("MODULE_INACTIF", noms.length === 1 ? `Le module ${noms[0]} n'est pas activé.` : `Aucun des modules ${noms.join(", ")} n'est activé.`, {
    module: d.modules[0],
    modules: [...d.modules],
  });
}

/**
 * Garde d'API : connexion, rôle, modules. Les données restent filtrées
 * par la RLS du client renvoyé.
 *
 *   const g = await garderApi({ ecran: "carburant.ticpe" }); if (!g.ok) return g.reponse;
 */
export async function garderApi(opts: OptionsGarde = {}): Promise<ResultatGardeApi> {
  const appUser = await getCurrentAppUser();
  if (!appUser) {
    // Compte suspendu par GODAC (getCurrentAppUser rend null) : message dédié, pas « session expirée ».
    if (await compteSuspenduDeLUtilisateurCourant()) return { ok: false, reponse: refus("COMPTE_SUSPENDU", MESSAGE_COMPTE_SUSPENDU) };
    return { ok: false, reponse: refus("NON_CONNECTE", "Session expirée, reconnectez-vous.") };
  }
  const regle = regleEffective(opts);
  // Rôle d'abord : un refus de rôle ne coûte aucune requête.
  if (!regle.roles.includes(appUser.role) || (regle.conducteur && !appUser.conduit)) return { ok: false, reponse: refusPour(regle, appUser.role, new Set(), appUser.conduit)! };
  const supabase = await createServerSupabaseClient();
  const besoinModules = (regle.modules?.length ?? 0) > 0 || (regle.modulesAuMoinsUn?.length ?? 0) > 0;
  const modules: ReadonlySet<string> = besoinModules ? new Set(await getEnabledModuleKeys(supabase, appUser.organization_id)) : new Set();
  if (besoinModules) for (const m of new Set([...(regle.modules ?? []), ...(regle.modulesAuMoinsUn ?? [])])) memoriserModule(appUser.organization_id, m, modules.has(m));
  const r = refusPour(regle, appUser.role, modules, appUser.conduit);
  if (r) {
    // Module refusé parce que l'essai GO Navigation est terminé : message dédié.
    if (r.status === 403) {
      const offre = await lireEtatOffre(supabase, appUser.organization_id);
      if (offre.essaiTermine) return { ok: false, reponse: refus("MODULE_INACTIF", MESSAGE_ESSAI_TERMINE) };
      // Offre illisible (incident base) : refus passager, pas un module désactivé.
      if (offre.indetermine) return { ok: false, reponse: NextResponse.json({ error: MESSAGE_OFFRE_INDETERMINEE, code: "ERREUR" }, { status: 503 }) as unknown as NextResponse<CorpsRefus> };
    }
    return { ok: false, reponse: r };
  }
  return { ok: true, appUser, supabase, modules };
}
