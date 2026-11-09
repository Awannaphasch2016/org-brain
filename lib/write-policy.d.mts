export function toWorkspaceRelative(filePath: string):
  | { ok: true; relative: string }
  | { ok: false; reason: string };

export function assessWrite(filePath: string):
  | { allowed: true; relative: string }
  | { allowed: false; reason: string };
