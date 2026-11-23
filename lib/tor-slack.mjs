export function torInboundResult({
  isBot = false,
  channelType,
  allowedUser = false,
  allowedChannel = false,
  consumedReason = false,
  approved = false,
  auth = null,
  botMentioned = false,
  edit = false,
  inThread = false,
  subscribed = false,
  guidance,
}) {
  if (isBot || channelType === "im") return null;
  if (!allowedUser || !allowedChannel || consumedReason || !approved || !auth) return null;
  if (botMentioned) return { auth };
  if (edit || (inThread && subscribed)) return { auth, status: "deferred", guidance };
  return null;
}

export function torAnswerResult({ allowedUser = false, allowedChannel = false, auth = null }) {
  if (!allowedUser || !allowedChannel) return null;
  return { auth };
}
