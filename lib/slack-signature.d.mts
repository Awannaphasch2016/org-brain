export const SLACK_SIGNATURE_MAX_SKEW_SECONDS: number;
export function signSlackRequest(input: {
  signingSecret: string;
  timestamp: string | number;
  rawBody: string;
}): string;
export function verifySlackRequestSignature(input: {
  signingSecret: string | undefined;
  timestamp: string | number | undefined;
  rawBody: string | undefined;
  signature: string | undefined;
  now?: number;
  maxSkewSeconds?: number;
}): { ok: true } | { ok: false; reason: string };
