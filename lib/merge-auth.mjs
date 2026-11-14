const DECISION_SEAL = Symbol("factory.decision.seal");
const MERGE_SEAL = Symbol("factory.merge.seal");

export function markVerifiedDecision(decision) {
  const wrapper = { decision };
  Object.defineProperty(wrapper, DECISION_SEAL, { value: true, enumerable: false });
  return wrapper;
}

export function readVerifiedDecision(wrapper) {
  if (!wrapper || wrapper[DECISION_SEAL] !== true || !wrapper.decision) return null;
  return wrapper.decision;
}

export function sealMergeAuthorization(details) {
  const authorization = {
    kind: details.kind,
    repo: details.repo,
    pr: details.pr,
    headSha: details.headSha,
  };
  Object.defineProperty(authorization, MERGE_SEAL, { value: true, enumerable: false });
  return authorization;
}

export function readMergeAuthorization(authorization) {
  if (!authorization || authorization[MERGE_SEAL] !== true) return null;
  if (authorization.kind !== "gate" && authorization.kind !== "recording") return null;
  if (typeof authorization.repo !== "string" || !/^[^/\s]+\/[^/\s]+$/.test(authorization.repo)) return null;
  if (!Number.isInteger(authorization.pr) || authorization.pr < 1) return null;
  if (typeof authorization.headSha !== "string" || !authorization.headSha) return null;
  return authorization;
}
