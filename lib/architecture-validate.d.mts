export function validateArchitecture(input: { architecture?: string; srs?: string }): {
  ok: boolean;
  errors: string[];
  warnings: string[];
  report: string;
  srsSha256: string;
};
