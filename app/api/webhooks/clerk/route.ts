import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { Webhook } from "svix";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import type { UserRole } from "@/lib/types/domain";

/**
 * Keeps Supabase's organizations/users tables in sync with Clerk,
 * which remains the source of truth for identity and org membership.
 * GODAC's 5 domain roles are carried in the membership's
 * publicMetadata.role (set by our own invite flow, see
 * lib/email + the onboarding/admin UI) since Clerk's own org roles
 * only distinguish admin/basic_member.
 */
export async function POST(req: Request) {
  const webhookSecret = process.env.CLERK_WEBHOOK_SIGNING_SECRET;
  if (!webhookSecret) {
    console.error("CLERK_WEBHOOK_SIGNING_SECRET is not configured");
    return NextResponse.json({ error: "webhook not configured" }, { status: 500 });
  }

  const headerList = await headers();
  const svixId = headerList.get("svix-id");
  const svixTimestamp = headerList.get("svix-timestamp");
  const svixSignature = headerList.get("svix-signature");

  if (!svixId || !svixTimestamp || !svixSignature) {
    return NextResponse.json({ error: "missing svix headers" }, { status: 400 });
  }

  const payload = await req.text();
  const webhook = new Webhook(webhookSecret);

  let event: ClerkWebhookEvent;
  try {
    event = webhook.verify(payload, {
      "svix-id": svixId,
      "svix-timestamp": svixTimestamp,
      "svix-signature": svixSignature,
    }) as ClerkWebhookEvent;
  } catch (err) {
    console.error("Clerk webhook signature verification failed", err);
    return NextResponse.json({ error: "invalid signature" }, { status: 400 });
  }

  const supabase = createAdminSupabaseClient();

  switch (event.type) {
    case "organization.created":
    case "organization.updated": {
      const org = event.data;
      const { error } = await supabase.from("organizations").upsert(
        {
          clerk_org_id: org.id,
          name: org.name,
        },
        { onConflict: "clerk_org_id" },
      );
      if (error) console.error("organization upsert failed", error);
      break;
    }

    case "organizationMembership.created":
    case "organizationMembership.updated": {
      const membership = event.data;
      const { data: org } = await supabase
        .from("organizations")
        .select("id")
        .eq("clerk_org_id", membership.organization.id)
        .maybeSingle();

      if (!org) {
        console.error(
          "organizationMembership event for unknown org",
          membership.organization.id,
        );
        break;
      }

      // The org creator gets Clerk's built-in "org:admin" role with no
      // publicMetadata yet — default them to GODAC's "direction" role
      // so onboarding (CSV import, plan selection) isn't blocked by RLS.
      const defaultRole: UserRole = membership.role === "org:admin" ? "direction" : "chauffeur";
      const role = (membership.public_metadata?.role as UserRole | undefined) ?? defaultRole;

      const { data: upsertedUser, error } = await supabase
        .from("users")
        .upsert(
          {
            clerk_user_id: membership.public_user_data.user_id,
            organization_id: org.id,
            role,
            full_name:
              [membership.public_user_data.first_name, membership.public_user_data.last_name]
                .filter(Boolean)
                .join(" ") || membership.public_user_data.identifier,
            email: membership.public_user_data.identifier,
            active: true,
          },
          { onConflict: "clerk_user_id" },
        )
        .select("id")
        .single();
      if (error) console.error("user upsert failed", error);

      const serviceId = membership.public_metadata?.service_id as string | undefined;
      if (upsertedUser && serviceId) {
        const { error: serviceLinkError } = await supabase
          .from("user_services")
          .upsert({ user_id: upsertedUser.id, service_id: serviceId }, { onConflict: "user_id,service_id" });
        if (serviceLinkError) console.error("user_services upsert failed", serviceLinkError);
      }
      break;
    }

    case "organizationMembership.deleted": {
      const membership = event.data;
      const { error } = await supabase
        .from("users")
        .update({ active: false })
        .eq("clerk_user_id", membership.public_user_data.user_id);
      if (error) console.error("user deactivate failed", error);
      break;
    }

    case "user.updated": {
      const user = event.data;
      const primaryEmail = user.email_addresses.find(
        (addr: { id: string; email_address: string }) => addr.id === user.primary_email_address_id,
      )?.email_address;

      const { error } = await supabase
        .from("users")
        .update({
          full_name: [user.first_name, user.last_name].filter(Boolean).join(" "),
          ...(primaryEmail ? { email: primaryEmail } : {}),
        })
        .eq("clerk_user_id", user.id);
      if (error) console.error("user update failed", error);
      break;
    }

    default:
      // Ignore event types GODAC doesn't need (session.*, email.*, ...).
      break;
  }

  return NextResponse.json({ received: true });
}

// Minimal typed slice of the Clerk webhook payloads GODAC consumes.
// See https://clerk.com/docs/webhooks/overview for the full schema.
interface ClerkWebhookEvent {
  type: string;
  data: any;
}
