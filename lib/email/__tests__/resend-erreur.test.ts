import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

const send = vi.fn();
vi.mock("resend", () => ({ Resend: class { emails = { send }; } }));

import { sendTransactionalEmail } from "@/lib/email/resend";

describe("sendTransactionalEmail", () => {
  beforeEach(() => {
    process.env.RESEND_API_KEY = "re_test";
    send.mockReset();
  });

  it("signale l'échec quand Resend renvoie une erreur sans lever d'exception", async () => {
    send.mockResolvedValue({ data: null, error: { name: "validation_error", message: "domain not verified" } });
    const r = await sendTransactionalEmail({ to: ["a@b.fr"], subject: "s", html: "<p>x</p>" });
    expect(r.sent).toBe(false);
    expect(r.reason).toContain("domain not verified");
  });

  it("signale l'envoi réussi", async () => {
    send.mockResolvedValue({ data: { id: "1" }, error: null });
    const r = await sendTransactionalEmail({ to: ["a@b.fr"], subject: "s", html: "<p>x</p>" });
    expect(r.sent).toBe(true);
  });

  it("signale l'échec quand le SDK lève une exception", async () => {
    send.mockRejectedValue(new Error("réseau"));
    const r = await sendTransactionalEmail({ to: ["a@b.fr"], subject: "s", html: "<p>x</p>" });
    expect(r.sent).toBe(false);
  });
});
