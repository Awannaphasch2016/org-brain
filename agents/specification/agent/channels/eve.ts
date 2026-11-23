import { localDev, vercelOidc } from "eve/channels/auth";
import { eveChannel } from "eve/channels/eve";
import { phaseTrustedForwarders } from "../../../../lib/phase-actor.mjs";

export default eveChannel({
  auth: [vercelOidc(), localDev()],
  trustedForwarders: phaseTrustedForwarders,
});
