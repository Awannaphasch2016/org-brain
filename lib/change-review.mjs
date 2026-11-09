import { listRequirementIds, sha256 } from "./srs-validate.mjs";

const BLOCK = /^## (CR-\d{3})\s*$/gm;

function field(body, name) {
  const match = body.match(new RegExp(`^\\s*(?:[-*]\\s+)?${name}:\\s*(.+)$`, "im"));
  return match ? match[1].trim() : null;
}

export function validateChangeReview({
  review = "",
  originalSrs = "",
  revisedSrs = "",
  torText = "",
  expectedTorSha256 = "",
}) {
  const errors = [];
  const matches = [...review.matchAll(BLOCK)];
  if (matches.length === 0) errors.push("no CR-nnn items were found");
  let accepted = false;
  for (let index = 0; index < matches.length; index += 1) {
    const id = matches[index][1];
    const start = matches[index].index + matches[index][0].length;
    const end = matches[index + 1]?.index ?? review.length;
    const body = review.slice(start, end);
    const klass = (field(body, "Class") ?? "").toLowerCase();
    const disposition = (field(body, "Disposition") ?? "").toLowerCase();
    if (klass !== "elaboration" && klass !== "contradiction") {
      errors.push(`${id} class must be elaboration or contradiction`);
    }
    if (disposition !== "accept" && disposition !== "reject") {
      errors.push(`${id} disposition must be accept or reject`);
    }
    const asksForCustomers = /external customer/i.test(body);
    if (asksForCustomers && klass !== "contradiction") {
      errors.push(`${id} asks for external customer access and must be a contradiction`);
    }
    if (klass === "contradiction" && disposition === "accept") {
      errors.push(`${id} contradicts the frozen TOR and cannot be accepted`);
    }
    if (disposition === "accept") accepted = true;
  }
  if (sha256(torText) !== expectedTorSha256) {
    errors.push("TOR hash does not match the frozen baseline");
  }
  if (/shall\s+(?:support|provide|allow)\s+external customer/i.test(revisedSrs)) {
    errors.push("revised SRS reintroduces external customer access");
  }
  const originalIds = new Set(listRequirementIds(originalSrs));
  const revisedIds = new Set(listRequirementIds(revisedSrs));
  if (accepted) {
    for (const id of originalIds) {
      if (!revisedIds.has(id)) errors.push(`revised SRS dropped ${id}`);
    }
    if (!revisedSrs.trim()) errors.push("an accepted change needs a revised SRS");
  }
  const ok = errors.length === 0;
  return {
    ok,
    errors,
    warnings: [],
    report: ["# Change-review validation report", "", `Result: ${ok ? "pass" : "fail"}`, "", "## Errors", "", ...(errors.length ? errors.map((error) => `- ${error}`) : ["- none"]), ""].join("\n"),
  };
}
