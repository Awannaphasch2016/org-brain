export function torInboundResult(input: {
  isBot?: boolean;
  channelType?: unknown;
  allowedUser?: boolean;
  allowedChannel?: boolean;
  consumedReason?: boolean;
  approved?: boolean;
  auth?: any;
  botMentioned?: boolean;
  edit?: boolean;
  inThread?: boolean;
  subscribed?: boolean;
  guidance?: string;
}): { auth: any; status?: "deferred"; guidance?: string } | null;
export function torAnswerResult(input: {
  allowedUser?: boolean;
  allowedChannel?: boolean;
  auth?: any;
}): { auth: any } | null;
