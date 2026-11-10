export const DEPLOY_DISABLED: string;
export function verifyAcceptance(input: { evidence?: string; torUnchanged: boolean }): {
  ok: boolean;
  errors: string[];
  report: string;
};
export function planRelease(input: { fixture: boolean; verificationOk: boolean }): {
  ok: boolean;
  deploy: boolean;
  requests: never[];
  error?: string;
  reason?: string;
};
export function deployApplication(input: { approved: boolean }): {
  deployed: false;
  requests: never[];
  reason: string;
};
export function assertNoDeployRequest(url: string): void;
