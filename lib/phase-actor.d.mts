export function forwardedSlackPrincipal(actor: {
  userId: string;
  teamId?: string | null;
  channelId?: string | null;
  threadTs?: string | null;
}): { current: Record<string, any> };

export function actorFromDecision(
  decision: { decidedBy?: string; slack?: { channel?: string } } | null | undefined,
  context?: { channelId?: string | null; threadTs?: string | null },
): { userId: string; teamId: string; channelId: string | null; threadTs: string | null } | null;

export function phaseTrustedForwarders(
  forwarder: {
    authenticator?: string;
    principalType?: string;
    issuer?: string;
    attributes?: { project_id?: string; environment?: string };
  } | null | undefined,
  assertion: { principal?: { current?: Record<string, any>; initiator?: Record<string, any> } } | null | undefined,
  env?: Record<string, string | undefined>,
): boolean;

export function renderPhaseQuestion(input: {
  agent: string;
  sessionId: string;
  question: { interactionId: string; prompt?: string; options?: readonly { id: string; label?: string }[] };
}): { text: string; blocks: Record<string, any>[] };

export function phaseAnswerFromAction(action: { actionId?: string; value?: string } | null | undefined): {
  agent: string;
  sessionId: string;
  interactionId: string;
  optionId: string;
} | null;
