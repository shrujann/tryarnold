import { describe, expect, it } from "vitest";
import { verifyLineSignature } from "../src/channels/line";

describe("verifyLineSignature", () => {
  it("validates correct HMAC signature", async () => {
    const secret = "test-channel-secret";
    const body = '{"events":[]}';

    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
      "raw",
      encoder.encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(body));
    const signature = btoa(String.fromCharCode(...new Uint8Array(sig)));

    const valid = await verifyLineSignature(body, signature, secret);
    expect(valid).toBe(true);
  });

  it("rejects invalid signature", async () => {
    const valid = await verifyLineSignature('{"events":[]}', "bad-sig", "secret");
    expect(valid).toBe(false);
  });
});
