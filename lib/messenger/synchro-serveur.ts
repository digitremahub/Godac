import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  computeTeamGroupMembers,
  diffTeamGroupMembers,
  estCompteActif,
  type CandidateUser,
  type ExistingMember,
  type GroupMemberRole,
} from "@/lib/messenger/groupes";

interface ServiceRow {
  id: string;
  name: string;
  team_leader_user_id: string | null;
  team_leader_email: string | null;
}

interface GroupRow {
  id: string;
  service_id: string | null;
  kind: "team" | "custom";
  name: string;
}

/**
 * Tient à jour les groupes d'équipe d'une organisation (client service) :
 * un groupe « team » par service, membres = personnes actives du service
 * + chef d'équipe (computeTeamGroupMembers), responsables en admin. Dans
 * les groupes ponctuels d'un service, ceux qui ont quitté l'équipe sont
 * retirés (la direction active peut rester) et les responsables de
 * l'équipe passent admin.
 *
 * Appelée à l'ouverture du Messenger et après chaque changement de
 * service, de chef d'équipe ou de compte. Un compte désactivé perd de
 * toute façon l'accès tout de suite : les politiques exigent un compte
 * actif (public.current_user_is_active).
 */
export async function synchroniserGroupesEquipe(admin: SupabaseClient, organizationId: string): Promise<void> {
  const { data: services, error: servicesError } = await admin
    .from("services")
    .select("id, name, team_leader_user_id, team_leader_email")
    .eq("organization_id", organizationId);
  if (servicesError) throw new Error(`Services illisibles : ${servicesError.message}`);
  const serviceIds = ((services ?? []) as ServiceRow[]).map((s) => s.id);
  if (serviceIds.length === 0) return;

  const [usersRes, liensRes, groupesRes] = await Promise.all([
    admin.from("users").select("id, role, active, pending_approval, email, contact_email").eq("organization_id", organizationId),
    admin.from("user_services").select("user_id, service_id").in("service_id", serviceIds),
    admin.from("message_groups").select("id, service_id, kind, name").eq("organization_id", organizationId),
  ]);
  if (usersRes.error || liensRes.error || groupesRes.error) {
    throw new Error(`Synchro des groupes impossible : ${(usersRes.error ?? liensRes.error ?? groupesRes.error)!.message}`);
  }
  const users = (usersRes.data ?? []) as CandidateUser[];
  const actifs = new Set(users.filter(estCompteActif).map((u) => u.id));
  const directionActive = new Set(users.filter((u) => estCompteActif(u) && (u.role === "direction" || u.role === "exploitation")).map((u) => u.id));
  const parService = new Map<string, string[]>();
  for (const l of (liensRes.data ?? []) as { user_id: string; service_id: string }[]) {
    parService.set(l.service_id, [...(parService.get(l.service_id) ?? []), l.user_id]);
  }
  const groupes = (groupesRes.data ?? []) as GroupRow[];

  for (const service of (services ?? []) as ServiceRow[]) {
    const nom = service.name.slice(0, 80);
    let equipe = groupes.find((g) => g.kind === "team" && g.service_id === service.id);
    if (!equipe) {
      const { data, error } = await admin
        .from("message_groups")
        .insert({ organization_id: organizationId, service_id: service.id, kind: "team", name: nom })
        .select("id, service_id, kind, name")
        .single();
      if (error) {
        // Créé en parallèle par une autre requête (index unique) : on le relit.
        const { data: existant } = await admin.from("message_groups").select("id, service_id, kind, name").eq("service_id", service.id).eq("kind", "team").maybeSingle();
        if (!existant) throw new Error(`Groupe d'équipe impossible à créer : ${error.message}`);
        equipe = existant as GroupRow;
      } else {
        equipe = data as GroupRow;
      }
    } else if (equipe.name !== nom) {
      await admin.from("message_groups").update({ name: nom }).eq("id", equipe.id);
    }

    const voulus = computeTeamGroupMembers(service, parService.get(service.id) ?? [], users);
    const groupesDuService = [equipe, ...groupes.filter((g) => g.kind === "custom" && g.service_id === service.id)];
    const { data: membresRows, error: membresError } = await admin
      .from("message_group_members")
      .select("group_id, user_id, role, source")
      .in("group_id", groupesDuService.map((g) => g.id));
    if (membresError) throw new Error(`Membres illisibles : ${membresError.message}`);
    const membres = (membresRows ?? []) as (ExistingMember & { group_id: string })[];

    // Groupe d'équipe : ajouts, rôles, départs.
    const diff = diffTeamGroupMembers(membres.filter((m) => m.group_id === equipe!.id), voulus, actifs);
    const aEcrire = [...diff.toAdd, ...diff.toUpdate].map((m) => ({
      group_id: equipe!.id,
      organization_id: organizationId,
      user_id: m.user_id,
      role: m.role,
      source: "auto" as const,
    }));
    if (aEcrire.length > 0) {
      const { error } = await admin.from("message_group_members").upsert(aEcrire, { onConflict: "group_id,user_id" });
      if (error) throw new Error(`Membres non enregistrés : ${error.message}`);
    }
    if (diff.toRemove.length > 0) {
      await admin.from("message_group_members").delete().eq("group_id", equipe.id).in("user_id", diff.toRemove);
    }

    // Groupes ponctuels du service.
    for (const g of groupesDuService.slice(1)) {
      const ici = membres.filter((m) => m.group_id === g.id);
      const partis = ici.filter((m) => !voulus.has(m.user_id) && !directionActive.has(m.user_id)).map((m) => m.user_id);
      if (partis.length > 0) await admin.from("message_group_members").delete().eq("group_id", g.id).in("user_id", partis);
      const promus = ici.filter((m) => voulus.get(m.user_id) === ("admin" as GroupMemberRole) && m.role !== "admin").map((m) => m.user_id);
      if (promus.length > 0) await admin.from("message_group_members").update({ role: "admin" }).eq("group_id", g.id).in("user_id", promus);
    }
  }

  // Comptes désactivés : retirés de tous les groupes (y compris transversaux).
  const inactifs = users.filter((u) => !estCompteActif(u)).map((u) => u.id);
  if (inactifs.length > 0) {
    await admin.from("message_group_members").delete().eq("organization_id", organizationId).in("user_id", inactifs);
  }
}

/** Variante qui ne fait jamais échouer l'appelant (journalise seulement). */
export async function synchroniserGroupesEquipeSansErreur(admin: SupabaseClient, organizationId: string): Promise<void> {
  try {
    await synchroniserGroupesEquipe(admin, organizationId);
  } catch (e) {
    console.warn("messenger: synchro des groupes d'équipe", e instanceof Error ? e.message : e);
  }
}
