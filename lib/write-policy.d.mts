export function toWorkspaceRelative(filePath: string):
  | { ok: true; relative: string }
  | { ok: false; reason: string };

export function assessWrite(
  filePath: string,
  options?: { allowedDocs?: readonly string[]; allowSrc?: boolean },
):
  | { allowed: true; relative: string }
  | { allowed: false; reason: string };
