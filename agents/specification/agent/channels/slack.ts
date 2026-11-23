import { connectSlackCredentials } from "@vercel/connect/eve";
import { defaultSlackAuth, slackChannel } from "eve/channels/slack";
import { specificationConfig } from "../../../../generated/config.js";
import { createSlackGate } from "../../../../lib/slack-gate.js";
import { rememberPhaseSession } from "../../../../lib/gate-chain.mjs";
import { deliverAnsweredPhase, deliverPhaseOutput, dispatchSpecificationInbound, handleSpecificationInbound, loadOrchestratorProject, phaseSessionFromThread, projectIdFromSlackText, projectIdFromThread } from "../../../../lib/orchestrator.mjs";
import { phaseAnswerFromAction } from "../../../../lib/phase-actor.mjs";
import { continuePhaseSession, readPhaseReply, startPhaseAgent } from "../../../../lib/phase-hop.mjs";
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
  onInteraction: async (action, ctx) => {
    const answer = phaseAnswerFromAction(action);
    if (answer) {
      if (!allowUser(action.user.id) || !allowChannel(ctx.slack.channelId)) return;
      // Eve schedules onInteraction with waitUntil and returns Slack's ack first.
      return deliverAnsweredPhase({
        answer,
        threadTs: ctx.slack.threadTs,
        actor: {
          userId: action.user.id,
          teamId: ctx.slack.teamId,
          channelId: ctx.slack.channelId,
          threadTs: ctx.slack.threadTs,
        },
        post: async (payload) => {
          const body: Record<string, unknown> = {
            channel: ctx.slack.channelId,
            thread_ts: payload.threadTs ?? ctx.slack.threadTs,
            text: payload.text,
          };
          if (payload.blocks && payload.blocks.length > 0) body.blocks = payload.blocks;
          await ctx.slack.request("chat.postMessage", body);
        },
      }).then(() => undefined);
    }
    return gate.onInteraction(action, ctx);
  },
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
          const bound = phaseSessionFromThread(threadMessages);
          if ((routed.agent && routed.agent !== "specification") || bound?.sessionId || (bound?.agent && bound.agent !== "specification")) {
            const actor = {
              userId: message.author.userId,
              teamId: ctx.slack.teamId,
              channelId: ctx.slack.channelId,
              threadTs: ctx.slack.threadTs,
            };
            const outcome = await handleSpecificationInbound({
              projectState,
              text: message.text,
              threadMessages,
              actor,
              startAgent: startPhaseAgent,
              continueAgent: continuePhaseSession,
              readReply: readPhaseReply,
              recordSession: async (record: { pr?: number }) => rememberPhaseSession(await createGateGithubClient(), Number(record.pr), record),
            });
            if (outcome.resumed || outcome.agent !== "specification") {
              await deliverPhaseOutput({
                binding: outcome.binding,
                reply: outcome.reply,
                question: outcome.question,
                agent: outcome.invoked?.agent,
                sessionId: outcome.invoked?.sessionId,
                threadTs: ctx.slack.threadTs,
                post: async (payload) => {
                  const body: Record<string, unknown> = {
                    channel: ctx.slack.channelId,
                    thread_ts: payload.threadTs ?? ctx.slack.threadTs,
                    text: payload.text,
                  };
                  if (payload.blocks && payload.blocks.length > 0) body.blocks = payload.blocks;
                  await ctx.slack.request("chat.postMessage", body);
                },
              });
              return null;
            }
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
