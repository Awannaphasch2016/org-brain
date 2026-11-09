export function parseIssues(markdown: string): Array<{
  id: string;
  title: string | null;
  source: string | null;
  depends: string[];
  acceptance: string | null;
  body: string;
}>;

export function validateFeatureIssues(input: { issuesMarkdown?: string; architecture?: string }): {
  ok: boolean;
  errors: string[];
  warnings: string[];
  order: string[];
  issues: ReturnType<typeof parseIssues>;
  report: string;
};

export function planGithubIssueWrites(input: {
  fixture: boolean;
  merged: boolean;
  issues: readonly { title: string | null }[];
}): { ok: true; requests: { method: string; path: string; title: string | null }[] } | { ok: false; error: string };
