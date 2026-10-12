import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ createServerSupabaseClient: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminSupabaseClient: vi.fn() }));

const { issueOnBehalfToken, verifyOnBehalfToken } = await import("../on-behalf");

describe("on-behalf token", () => {
  beforeEach(() => {
    process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("round-trips helper, colleague and organization", () => {
    const claims = verifyOnBehalfToken(issueOnBehalfToken("helper-1", "colleague-2", "org-3"));
    expect(claims).toMatchObject({ helper: "helper-1", colleague: "colleague-2", org: "org-3" });
  });

  it("rejects a token whose payload was edited", () => {
    const [payload, sig] = issueOnBehalfToken("helper-1", "colleague-2", "org-3").split(".");
    const forged = Buffer.from(
      JSON.stringify({ ...JSON.parse(Buffer.from(payload!, "base64url").toString()), colleague: "someone-else" }),
    ).toString("base64url");
    expect(verifyOnBehalfToken(`${forged}.${sig}`)).toBeNull();
  });

  it("rejects a token signed with another key", () => {
    const token = issueOnBehalfToken("helper-1", "colleague-2", "org-3");
    process.env.SUPABASE_SERVICE_ROLE_KEY = "another-key";
    expect(verifyOnBehalfToken(token)).toBeNull();
  });

  it("expires after 10 minutes", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-12T08:00:00Z"));
    const token = issueOnBehalfToken("helper-1", "colleague-2", "org-3");
    vi.setSystemTime(new Date("2026-10-12T08:09:00Z"));
    expect(verifyOnBehalfToken(token)).not.toBeNull();
    vi.setSystemTime(new Date("2026-10-12T08:11:00Z"));
    expect(verifyOnBehalfToken(token)).toBeNull();
  });

  it("rejects garbage", () => {
    expect(verifyOnBehalfToken("not-a-token")).toBeNull();
    expect(verifyOnBehalfToken("")).toBeNull();
  });
});
