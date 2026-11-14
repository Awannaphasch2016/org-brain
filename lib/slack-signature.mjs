import { createHmac, timingSafeEqual } from "node:crypto";

export const SLACK_SIGNATURE_MAX_SKEW_SECONDS = 300;

export function signSlackRequest({ signingSecret, timestamp, rawBody }) {
  return `v0=${createHmac("sha256", signingSecret).update(`v0:${timestamp}:${rawBody}`).digest("hex")}`;
}

export function verifySlackRequestSignature({
  signingSecret,
  timestamp,
  rawBody,
  signature,
  now = Date.now(),
  maxSkewSeconds = SLACK_SIGNATURE_MAX_SKEW_SECONDS,
}) {
  if (!signingSecret) return { ok: false, reason: "missing signing secret" };
  if (rawBody == null || rawBody === "") return { ok: false, reason: "missing signature body" };
  if (timestamp == null || signature == null || signature === "") {
    return { ok: false, reason: "missing signature headers" };
  }
  const numeric = Number(timestamp);
  if (!Number.isFinite(numeric)) return { ok: false, reason: "malformed timestamp" };
  const skew = Math.abs(Math.floor(now / 1000) - numeric);
  if (skew > maxSkewSeconds) return { ok: false, reason: "timestamp outside allowed skew" };
  const expected = signSlackRequest({
    signingSecret,
    timestamp: String(timestamp),
    rawBody: String(rawBody),
  });
  const actual = String(signature);
  const expectedBytes = Buffer.from(expected);
  const actualBytes = Buffer.from(actual);
  if (expectedBytes.length !== actualBytes.length || !timingSafeEqual(expectedBytes, actualBytes)) {
    return { ok: false, reason: "signature mismatch" };
  }
  return { ok: true };
}
