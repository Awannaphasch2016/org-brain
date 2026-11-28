// Test replacement for lib/approval-pins.mjs. Production code does not import this file.
export const testPins = {
  appId: 1,
  botLogin: "iso-workflows[bot]",
  botUserId: 1,
  slackAppId: "A0TEST",
};

export function pins(overrides = {}) {
  return { ...testPins, ...overrides };
}
