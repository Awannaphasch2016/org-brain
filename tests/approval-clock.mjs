// Test replacement for lib/approval-clock.mjs. Production code does not import this file.
export const testClock = {
  now: new Date("2026-11-25T07:00:00.000Z"),
  env: { SLACK_SIGNING_SECRET: "test-signing-secret" },
};

export function approvalNow() {
  const value = testClock.now;
  return value instanceof Date ? new Date(value.getTime()) : new Date(value);
}

export function approvalEnv() {
  return testClock.env;
}
