import { readFile } from "node:fs/promises";
import { GithubClient } from "../lib/github.mjs";
import { verifyApproval } from "../lib/owner-approval.mjs";

const [requestId, key, actionPath] = process.argv.slice(2);
if (!requestId || !key || !actionPath) {
  console.error("usage: node scripts/verify-approval.mjs <requestId> <key> <action.json>");
  process.exit(2);
}

const token = process.env.GITHUB_TOKEN;
const slackToken = process.env.SLACK_BOT_TOKEN;
if (!token || !slackToken) {
  console.log(JSON.stringify({ ok: false, reason: "card was not fetched" }));
  process.exit(1);
}

const action = JSON.parse(await readFile(actionPath, "utf8"));
const channel = process.env.SLACK_CHANNEL;
const ts = process.env.SLACK_MESSAGE_TS;
const threadTs = process.env.SLACK_THREAD_TS || ts;
if (!channel || !ts) {
  console.log(JSON.stringify({ ok: false, reason: "card was not fetched" }));
  process.exit(1);
}

const slackResponse = await fetch("https://slack.com/api/conversations.replies", {
  method: "POST",
  headers: { authorization: `Bearer ${slackToken}`, "content-type": "application/json; charset=utf-8" },
  body: JSON.stringify({ channel, ts: threadTs, oldest: ts, latest: ts, inclusive: true, limit: 2 }),
});
const slackPayload = await slackResponse.json();
const card = slackPayload?.messages?.find((message) => message.ts === ts);
if (!card) {
  console.log(JSON.stringify({ ok: false, reason: "card was not fetched" }));
  process.exit(1);
}

const client = new GithubClient({
  token,
  owner: "Awannaphasch2016",
  repo: "org-brain",
  identity: { kind: "personal-token", botLogin: null },
});
const result = await verifyApproval({
  client,
  action: { ...action, requestId: action.requestId ?? requestId, key: action.key ?? key },
  card,
});
console.log(JSON.stringify(result));
process.exit(result.ok ? 0 : 1);
