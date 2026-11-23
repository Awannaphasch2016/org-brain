import { connectSlackCredentials } from "@vercel/connect/eve";
import { defaultSlackAuth, slackChannel } from "eve/channels/slack";
import { factoryConfig } from "../../../../generated/config.js";
import { createSlackGate } from "../../../../lib/slack-gate.js";
import { dispatchSpecificationInbound, loadOrchestratorProject, projectIdFromSlackText } from "../../../../lib/orchestrator.mjs";
import { torAnswerResult, torInboundResult } from "../../../../lib/tor-slack.mjs";
import { createGateGithubClient } from "../../../specification/agent/lib/github-token.js";

const THREAD_GUIDANCE =
  "You are continuing a TOR setup and interview thread. Reply only when the message continues setup or the TOR interview. Otherwise call no_reply.";

function allowUser(userId: string | undefined) {
  const allow = factoryConfig.allowedUserIds;
  return allow.length > 0 && Boolean(userId && allow.includes(userId));
}

function allowChannel(channelId: string | undefined) {
  const allow = factoryConfig.allowedChannelIds;
  return allow.length > 0 && Boolean(channelId && allow.includes(channelId));
}

const gate = createSlackGate({
  agent: "tor",
  allowedUserIds: factoryConfig.allowedUserIds,
  allowedChannelIds: factoryConfig.allowedChannelIds,
  createClient: () => createGateGithubClient(),
});

export default slackChannel({
  credentials: process.env.SLACK_CONNECTOR
    ? connectSlackCredentials(process.env.SLACK_CONNECTOR)
    : undefined,
  uploadPolicy: { maxBytes: 1_000_000, allowedMediaTypes: ["text/markdown", "text/plain"] },
  onInteraction: (action, ctx) => gate.onInteraction(action, ctx),
  async onDirectMessage() {
    return null;
  },
  async onMessage(ctx, message) {
    if (!message.author || message.author.isBot) return null;
    if (message.raw.channel_type === "im") return null;
    if (!allowUser(message.author.userId) || !allowChannel(message.channelId)) return null;
    if (await gate.consumeReasonReply(ctx, message)) return null;
    const projectId = projectIdFromSlackText(message.text);
    if (projectId) {
      try {
        const projectState = await loadOrchestratorProject(await createGateGithubClient(), projectId);
        const dispatched = projectState ? dispatchSpecificationInbound({ projectState, text: message.text }) : null;
        if (dispatched && dispatched.agent !== "tor") return null;
      } catch {
        // Fall through to the TOR handler when the project cannot be loaded.
      }
    }
    const inThread = message.threadTs !== message.ts;
    return torInboundResult({
      isBot: false,
      channelType: message.raw.channel_type,
      allowedUser: true,
      allowedChannel: true,
      consumedReason: false,
      approved: factoryConfig.status === "approved",
      auth: defaultSlackAuth(message, ctx),
      botMentioned: ctx.isBotMentioned(),
      edit: Boolean(ctx.edit),
      inThread,
      subscribed: inThread ? await ctx.isSubscribed() : false,
      guidance: THREAD_GUIDANCE,
    });
  },
  onMessageEdited() {
    return null;
  },
  onAnswers(ctx, submission) {
    return torAnswerResult({
      allowedUser: allowUser(submission.user.id),
      allowedChannel: allowChannel(ctx.slack.channelId),
      auth: ctx.defaultAuth,
    });
  },
});
