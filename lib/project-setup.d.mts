export const PROJECT_ID_MAX: number;
export const STARTER_SCALAR_PATHS: readonly string[];

export function assessProjectId(projectId: string): { ok: boolean; reason?: string };
export function assessTorUpload(input: {
  filename: string;
  mediaType: string;
  bytes: Uint8Array;
}): { ok: boolean; reason?: string; text?: string; sha256?: string };
export function resolveSlackAttachmentPath(inputPath: string):
  | { ok: true; path: string; filename: string; attachmentId: string }
  | { ok: false; reason: string };
export function mediaTypeForTorFilename(filename: string): "text/markdown" | "text/plain" | null;
export function loadSlackUpload(input: { attachmentPath: string; bytes: Uint8Array }):
  | { ok: true; text: string; sha256: string; path: string; filename: string; mediaType: string; slackFileId: string }
  | { ok: false; reason: string };
export function slackUserFromUploader(uploadedBy: string): string | null;
export function renderStarterProjectYaml(input: {
  id: string;
  title: string;
  uploader: string;
  uploadedAt: string;
  slackFileId: string;
  sourceSha256: string;
  mediaType: string;
}): string;
export function starterYamlAcceptsWrites(yaml: string): Record<string, any>;
export function projectIdAvailable(
  client: { owner: string; repo: string; request: Function },
  projectId: string,
): Promise<{ ok: boolean; reason?: string; base?: string }>;
export function createProjectSetup(client: any, input: Record<string, any>): Promise<any>;
export function closeSetupProject(client: any, input: { projectId: string; pullNumber: number }): Promise<any>;
export function openRejectedStatusPullRequest(client: any, input: Record<string, any>): Promise<any>;
