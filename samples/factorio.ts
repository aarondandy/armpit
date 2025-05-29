import { az } from "armpit";

const subscriptionId = "TODO";
const tenantId = "TODO";
await az.account.setOrLogin(subscriptionId, tenantId);

throw new Error("Coming soon!");
