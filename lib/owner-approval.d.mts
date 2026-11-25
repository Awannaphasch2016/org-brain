export const APPROVER_SLACK_ID: string;
export const BOT_USER_ID: string;
export const ISO_WORKFLOWS_BOT_ID: string;
export const APPROVAL_CHANNEL_ID: string;
export const THREAD_SURFACE_CHANNELS: readonly string[];
export const RECORDS_BRANCH: string;
export const REQUESTS_BRANCH: string;
export const REPO: string;
export const RUN_DECLARATION_LABELS: readonly string[];

export function approvalChannelConfigured(): boolean;
export function sha256Hex(bytes: string | Uint8Array): string;
export function jcs(value: unknown): string;
export function H(value: unknown): string;
export function packetHash(packet: unknown): string;
export function canonicalRunDeclaration(text: string): string;
export function runDeclarationSha256(text: string): string;
export function formatIct(input: Date | number | string): string;
export function approvalRouteMode(env?: NodeJS.ProcessEnv): { ok: true } | { ok: false; reason: string };
export function authenticatedAppBotLogin(identity: { kind?: string; botLogin?: string } | null | undefined): string | null;
export function assertAppIdentity(identity: { kind?: string; botLogin?: string } | null | undefined): { ok: true } | { ok: false; reason: string };
export function actionHash(action: {
  requestId: string;
  key: string;
  kind: string;
  title: string;
  statement: string;
  target: unknown;
}): string;
export function validateRequest(value: unknown): {
  schema: string;
  requestId: string;
  actions: Array<{
    key: string;
    kind: string;
    title: string;
    statement: string;
    target: Record<string, unknown>;
    actionHash: string;
  }>;
};
export function renderDecisionLine(record: { decision: string; decidedAt: string; requestId: string; key: string; actionHash: string }): string;
export function renderApprovalCard(action: {
  requestId: string;
  key: string;
  kind: string;
  title: string;
  statement: string;
  actionHash: string;
  target: { options?: readonly string[] };
}): { text: string; blocks: readonly Record<string, unknown>[] };
export function renderDecidedCard(record: {
  decision: string;
  decidedAt: string;
  requestId: string;
  key: string;
  actionHash: string;
}): { text: string; blocks: readonly Record<string, unknown>[] };
export function parseApprovalRequestMention(text: string): string | null;
export function authorFromSlackMessage(message: { user?: string; bot_id?: string } | null | undefined): string | null;
export function decidedBlockId(hash: string): string;
export function verifyApproval(input: {
  client?: ApprovalClient;
  action?: {
    requestId: string;
    key: string;
    kind: string;
    title: string;
    statement: string;
    target: unknown;
  };
  record?: {
    requestId?: string;
    key?: string;
    actionHash?: string;
    decision?: string;
    decidedBy?: string;
    clickedCardTs?: string;
    decidedAt?: string;
  };
  card?: { blocks?: readonly { type?: string; block_id?: string }[] };
}): { ok: false; reason: string } | Promise<{ ok: true; actionHash: string; clickedCardTs: string | null; decidedAt: string | null } | { ok: false; reason: string }>;
export function claimExecution(
  client: {
    owner: string;
    repo: string;
    identity: { kind: string; botLogin: string; label?: string } | null;
    request(method: string, apiPath: string, init?: { body?: unknown; allowNotFound?: boolean }): Promise<any>;
  },
  input: { requestId: string; key: string; executorId: string },
): Promise<Record<string, unknown>>;

type ApprovalClient = {
  owner: string;
  repo: string;
  identity: { kind: string; botLogin: string; label?: string } | null;
  request(method: string, apiPath: string, init?: { body?: unknown; allowNotFound?: boolean }): Promise<any>;
};

type ApprovalSlack = {
  request(method: string, body: unknown): Promise<unknown>;
};

export function handleApprovalClick(input: {
  type?: string;
  actionId?: string;
  value?: string;
  userId?: string;
  channelId?: string;
  messageTs?: string;
  threadTs?: string;
  client: ApprovalClient;
  slack?: ApprovalSlack;
}): Promise<Record<string, unknown>>;

export function deliverApprovalRequest(input: {
  requestId: string;
  channelId: string;
  threadChannel: string;
  threadTs: string;
  client: ApprovalClient;
  slack?: ApprovalSlack;
}): Promise<Record<string, unknown>>;

export function fileApprovalRequest(input: {
  requestId: string;
  threadChannel: string;
  threadTs: string;
  client: ApprovalClient;
  slack?: ApprovalSlack;
}): Promise<Record<string, unknown>>;

export function createApprovalHandlers(input?: {
  createClient: () => Promise<ApprovalClient>;
}): {
  onInteraction(
    action: { actionId: string; value?: string; messageTs?: string; user?: { id?: string } },
    ctx: { slack: ApprovalSlack & { channelId: string; threadTs?: string }; edit?: unknown },
  ): Promise<void>;
  onMessage(
    message: { text?: string; channelId?: string; threadTs?: string; ts?: string },
    ctx: { slack: ApprovalSlack; edit?: unknown },
  ): Promise<boolean>;
};
