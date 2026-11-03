import { createHmac, timingSafeEqual } from "node:crypto";

export function verifyIngestSignature(body: Uint8Array, timestamp: string | null, signature: string | null, secret: string, now = Date.now()): boolean {
  if (secret.length < 32 || !timestamp || !/^\d{10,11}$/.test(timestamp) || !signature || !/^[a-f0-9]{64}$/i.test(signature)) return false;
  const seconds = Number(timestamp);
  if (!Number.isSafeInteger(seconds) || Math.abs(now - seconds * 1000) > 300_000) return false;
  const expected = createHmac("sha256", secret).update(`${timestamp}.`).update(body).digest();
  const received = Buffer.from(signature, "hex");
  return received.length === expected.length && timingSafeEqual(received, expected);
}
