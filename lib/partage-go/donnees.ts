import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AppUser } from "@/lib/auth/session";
import { hacherJetonInvitation } from "@/lib/go-navigation/jeton";
import { estSchemaManquant } from "@/lib/rattachement/tolerance";
import {
  regrouperParApporteur,
  resumerStatuts,
  statutInvite,
  statutLien,
  type LigneParApporteur,
  type OrganisationInvitee,
  type ResumeApporteur,
  type StatutInvite,
  type StatutLien,
} from "@/lib/partage-go/apporteur";
import { jetonLienPersonnel } from "@/lib/partage-go/serveur";

/** Un invité vu par son apporteur : jamais plus que le nom de l'entreprise d'essai et son statut. */
export interface LigneInvitePartage {
  id: string;
  /** "lien" = inscrit via le lien personnel ; "invitation" = invitation à usage unique. */
  type: "lien" | "invitation";
  note: string | null;
  statut: StatutInvite;
  /** Nom de l'organisation d'essai, une fois le compte créé. */
  organisation: string | null;
  creeLe: string;
  /** Invitation à usage unique pas encore utilisée : peut être révoquée. */
  revocable: boolean;
}

export interface LienPersonnelVue {
  /** Chemin /go-navigation/<jeton> ; null si le secret a changé depuis (lien à régénérer). */
  chemin: string | null;
  statut: StatutLien;
  expiresAt: string;
  maxInscriptions: number;
  inscrits: number;
}

export interface MembreDroit {
  id: string;
  nom: string;
  role: string;
  autorise: boolean;
}

export interface VuePartageGo {
  migrationManquante: boolean;
  lien: LienPersonnelVue | null;
  invites: LigneInvitePartage[];
  /** Direction : synthèse par apporteur de toute l'organisation. */
  organisation: { parApporteur: LigneParApporteur[]; total: ResumeApporteur } | null;
  /** Direction : qui peut faire essayer GO. */
  droits: { tous: boolean; membres: MembreDroit[] } | null;
}

interface LigneInvitation {
  id: string;
  note: string | null;
  expires_at: string;
  used_at: string | null;
  revoked_at: string | null;
  created_at: string;
  organization_id: string | null;
  created_by_user_id: string | null;
  referral_link_id: string | null;
}

const VUE_VIDE: VuePartageGo = { migrationManquante: false, lien: null, invites: [], organisation: null, droits: null };

/**
 * Données de /partage-go, lues avec le client service mais TOUJOURS bornées
 * à la personne connectée (ses liens, ses invitations) ou, pour la direction,
 * à son organisation. Côté invités : nom de l'entreprise d'essai et statut
 * seulement (ni e-mail, ni téléphone, ni identité).
 */
export async function chargerPartageGo(admin: SupabaseClient, appUser: AppUser, maintenant: Date = new Date()): Promise<VuePartageGo> {
  const direction = appUser.role === "direction";

  const lienReq = admin
    .from("go_apporteur_liens")
    .select("id, code_hash, expires_at, revoked_at, max_inscriptions")
    .eq("user_id", appUser.id)
    .is("revoked_at", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const colonnes = "id, note, expires_at, used_at, revoked_at, created_at, organization_id, created_by_user_id, referral_link_id";
  const invReq = direction
    ? admin.from("go_navigation_invitations").select(colonnes).eq("created_by_org_id", appUser.organization_id).order("created_at", { ascending: false }).limit(1000)
    : admin.from("go_navigation_invitations").select(colonnes).eq("created_by_user_id", appUser.id).order("created_at", { ascending: false }).limit(200);
  const [lienRes, invRes] = await Promise.all([lienReq, invReq]);

  if ((lienRes.error && estSchemaManquant(lienRes.error)) || (invRes.error && estSchemaManquant(invRes.error))) return { ...VUE_VIDE, migrationManquante: true };
  if (lienRes.error || invRes.error) {
    console.error("chargerPartageGo", lienRes.error?.message ?? invRes.error?.message);
    return VUE_VIDE;
  }

  const invitations = (invRes.data ?? []) as unknown as LigneInvitation[];
  const idsOrg = [...new Set(invitations.map((i) => i.organization_id).filter((x): x is string => Boolean(x)))];
  const orgs = new Map<string, OrganisationInvitee & { name: string }>();
  for (let i = 0; i < idsOrg.length; i += 200) {
    const { data } = await admin.from("organizations").select("id, name, offre, subscription_status, trial_ends_at").in("id", idsOrg.slice(i, i + 200));
    for (const o of (data ?? []) as unknown as (OrganisationInvitee & { id: string; name: string })[]) orgs.set(o.id, o);
  }
  const statutDe = (i: LigneInvitation): StatutInvite => statutInvite(i, i.organization_id ? orgs.get(i.organization_id) : null, maintenant);

  // Mes invités : seulement les miens, y compris pour la direction (vue personnelle).
  const miennes = invitations.filter((i) => i.created_by_user_id === appUser.id);
  const invites: LigneInvitePartage[] = miennes
    // Une tentative de lien abandonnée (révoquée sans compte) n'a rien à montrer.
    .filter((i) => !(i.referral_link_id && !i.organization_id))
    .map((i) => {
      const statut = statutDe(i);
      return {
        id: i.id,
        type: i.referral_link_id ? "lien" : "invitation",
        note: i.referral_link_id ? null : i.note,
        statut,
        organisation: i.organization_id ? (orgs.get(i.organization_id)?.name ?? null) : null,
        creeLe: i.created_at,
        revocable: !i.referral_link_id && statut === "envoyee",
      };
    });

  let lien: LienPersonnelVue | null = null;
  const l = lienRes.data as unknown as { id: string; code_hash: string; expires_at: string; revoked_at: string | null; max_inscriptions: number } | null;
  if (l) {
    const inscrits = invitations.filter((i) => i.referral_link_id === l.id && i.organization_id).length;
    let chemin: string | null = null;
    try {
      const jeton = jetonLienPersonnel(l.id);
      // Secret changé depuis la création : le hash ne correspond plus, lien à régénérer.
      if (hacherJetonInvitation(jeton) === l.code_hash) chemin = `/go-navigation/${jeton}`;
    } catch {
      chemin = null;
    }
    lien = { chemin, statut: statutLien(l, inscrits, maintenant), expiresAt: l.expires_at, maxInscriptions: l.max_inscriptions, inscrits };
  }

  if (!direction) return { migrationManquante: false, lien, invites, organisation: null, droits: null };

  // Direction : membres actifs de l'organisation (noms des apporteurs, droits).
  const [{ data: membres }, { data: org }] = await Promise.all([
    admin.from("users").select("id, full_name, role, peut_partager_go").eq("organization_id", appUser.organization_id).eq("active", true).order("full_name"),
    admin.from("organizations").select("partage_go_tous").eq("id", appUser.organization_id).maybeSingle(),
  ]);
  const listeMembres = (membres ?? []) as unknown as { id: string; full_name: string; role: string; peut_partager_go?: boolean | null }[];
  const nomDe = new Map(listeMembres.map((m) => [m.id, m.full_name]));

  const comptes = invitations
    .filter((i) => i.organization_id && i.created_by_user_id)
    .map((i) => ({ apporteurId: i.created_by_user_id!, apporteurNom: nomDe.get(i.created_by_user_id!) ?? "Ancien membre", statut: statutDe(i) }));
  const parApporteur = regrouperParApporteur(comptes);

  return {
    migrationManquante: false,
    lien,
    invites,
    organisation: { parApporteur, total: resumerStatuts(comptes.map((c) => c.statut)) },
    droits: {
      tous: Boolean((org as { partage_go_tous?: boolean } | null)?.partage_go_tous),
      membres: listeMembres.filter((m) => m.role !== "direction").map((m) => ({ id: m.id, nom: m.full_name, role: m.role, autorise: Boolean(m.peut_partager_go) })),
    },
  };
}
