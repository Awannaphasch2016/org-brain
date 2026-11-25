// Test-only pin values. Production code does not import this module.
export const testPins = Object.freeze({
  appId: 1,
  botLogin: "iso-workflows[bot]",
  botUserId: 1,
  slackAppId: "A0TEST",
});

export function pins(overrides = {}) {
  return { ...testPins, ...overrides };
}
