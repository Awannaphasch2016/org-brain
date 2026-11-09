const BLOCK = /^## (ISS-\d{3})\s*$/gm;

function field(body, name) {
  const match = body.match(new RegExp(`^\\s*(?:[-*]\\s+)?${name}:\\s*(.+)$`, "im"));
  return match ? match[1].trim() : null;
}

export function parseIssues(markdown) {
  const matches = [...markdown.matchAll(BLOCK)];
  return matches.map((match, index) => {
    const start = match.index + match[0].length;
    const end = matches[index + 1]?.index ?? markdown.length;
    const body = markdown.slice(start, end);
    const dependsRaw = field(body, "Depends") ?? "";
    const depends =
      dependsRaw.toLowerCase() === "none"
        ? []
        : (dependsRaw.match(/\bISS-\d{3}\b/g) ?? []);
    return {
      id: match[1],
      title: field(body, "Title"),
      source: field(body, "Source"),
      depends,
      acceptance: field(body, "Acceptance"),
      body,
    };
  });
}

export function validateFeatureIssues({ issuesMarkdown = "", architecture = "" }) {
  const errors = [];
  const issues = parseIssues(issuesMarkdown);
  if (issues.length === 0) errors.push("no ISS-nnn issues were found");
  const ids = new Set();
  const components = new Set([...architecture.matchAll(/\bC-\d{3}\b/g)].map((match) => match[0]));
  for (const issue of issues) {
    if (ids.has(issue.id)) errors.push(`duplicate issue id: ${issue.id}`);
    ids.add(issue.id);
    if (!issue.title) errors.push(`${issue.id} is missing a Title`);
    if (!issue.acceptance) errors.push(`${issue.id} is missing Acceptance`);
    const sources = issue.source?.match(/\bC-\d{3}\b/g) ?? [];
    if (sources.length === 0) errors.push(`${issue.id} is missing a component Source`);
    for (const source of sources) {
      if (!components.has(source)) errors.push(`${issue.id} cites unknown component ${source}`);
    }
    if (/shall\s+(?:support|provide|allow)\s+external customer/i.test(issue.body)) {
      errors.push(`${issue.id} reintroduces external customer access`);
    }
  }
  for (const issue of issues) {
    for (const dependency of issue.depends) {
      if (!ids.has(dependency)) errors.push(`${issue.id} depends on unknown ${dependency}`);
      if (dependency === issue.id) errors.push(`${issue.id} depends on itself`);
    }
  }
  const order = [];
  const pending = new Map(issues.map((issue) => [issue.id, new Set(issue.depends)]));
  while (pending.size > 0) {
    const ready = [...pending.entries()].filter(([, deps]) => [...deps].every((dep) => !pending.has(dep)));
    if (ready.length === 0) {
      errors.push(`dependency cycle among ${[...pending.keys()].join(", ")}`);
      break;
    }
    for (const [id] of ready) {
      order.push(id);
      pending.delete(id);
    }
  }
  const ok = errors.length === 0;
  return {
    ok,
    errors,
    warnings: [],
    order,
    issues,
    report: ["# Issue-plan validation report", "", `Result: ${ok ? "pass" : "fail"}`, "", "## Errors", "", ...(errors.length ? errors.map((error) => `- ${error}`) : ["- none"]), ""].join("\n"),
  };
}

export function planGithubIssueWrites({ fixture, merged, issues }) {
  if (fixture) return { ok: false, error: "Refusing to create GitHub issues from a fixture." };
  if (!merged) return { ok: false, error: "Refusing to create GitHub issues before the plan pull request is merged." };
  return {
    ok: true,
    requests: issues.map((issue) => ({
      method: "POST",
      path: "/issues",
      title: issue.title,
    })),
  };
}
