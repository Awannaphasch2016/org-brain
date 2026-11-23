import { connectSlackCredentials } from "@vercel/connect/eve";
import { defaultSlackAuth, slackChannel } from "eve/channels/slack";
import { specificationConfig } from "../../../../generated/config.js";
import { createSlackGate } from "../../../../lib/slack-gate.js";
import { dispatchSpecificationInbound, handleSpecificationInbound, loadOrchestratorProject, projectIdFromSlackText, projectIdFromThread } from "../../../../lib/orchestrator.mjs";
import { startPhaseAgent } from "../../../../lib/phase-hop.mjs";
import { createGateGithubClient } from "../lib/github-token.js";

export { postSrsGateCard } from "../../../../lib/srs-gate.mjs";

const THREAD_GUIDANCE =
  "You are continuing an existing specification thread. The message does not mention you. " +
  "Reply only when it continues the specification work. Otherwise call no_reply.";

function allowUser(userId: string | undefined) {
  const allow = specificationConfig.allowedUserIds;
  return allow.length > 0 && Boolean(userId && allow.includes(userId));
}

function allowChannel(channelId: string | undefined) {
  const allow = specificationConfig.allowedChannelIds;
  return allow.length > 0 && Boolean(channelId && allow.includes(channelId));
}

const gate = createSlackGate({
  agent: "specification",
  allowedUserIds: specificationConfig.allowedUserIds,
  allowedChannelIds: specificationConfig.allowedChannelIds,
  createClient: () => createGateGithubClient(),
});

export default slackChannel({
  credentials: process.env.SLACK_CONNECTOR
    ? connectSlackCredentials(process.env.SLACK_CONNECTOR)
    : undefined,
  onInteraction: (action, ctx) => gate.onInteraction(action, ctx),
  async onDirectMessage() {
    return null;
  },
  async onMessage(ctx, message) {
    if (!message.author || message.author.isBot) return null;
    if (message.raw.channel_type === "im") return null;
    if (!allowUser(message.author.userId) || !allowChannel(message.channelId)) return null;
    if (await gate.consumeReasonReply(ctx, message)) return null;
    if (specificationConfig.status !== "approved") return null;
    const auth = defaultSlackAuth(message, ctx);
    if (!auth) return null;
    let threadMessages: readonly { text?: string }[] = [];
    try {
      await ctx.thread.refresh();
      threadMessages = ctx.thread.recentMessages ?? [];
    } catch {
      threadMessages = [];
    }
    const projectId = projectIdFromThread(threadMessages) ?? projectIdFromSlackText(message.text);
    if (projectId) {
      try {
        const projectState = await loadOrchestratorProject(await createGateGithubClient(), projectId);
        if (projectState) {
          const routed = dispatchSpecificationInbound({ projectState, text: message.text });
          if (routed.agent && routed.agent !== "specification") {
            await handleSpecificationInbound({
              projectState,
              text: message.text,
              threadMessages,
              startAgent: startPhaseAgent,
            });
            return null;
          }
        }
      } catch (error) {
        console.error(`[specification-slack] phase hop ${error instanceof Error ? error.message : "failed"}`);
        return null;
      }
    }
    if (ctx.isBotMentioned()) return { auth };
    const inThread = message.threadTs !== message.ts;
    if (ctx.edit || (inThread && (await ctx.isSubscribed()))) {
      return { auth, status: "deferred" as const, guidance: THREAD_GUIDANCE };
    }
    return null;
  },
  onMessageEdited() {
    return null;
  },
  onAnswers(ctx, submission) {
    if (!allowUser(submission.user.id) || !allowChannel(ctx.slack.channelId)) return null;
    return { auth: ctx.defaultAuth };
  },
});
