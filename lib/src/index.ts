import {
  type Account,
  type ResourceSummary,
  isSubscriptionId,
  isTenantId,
} from "./azUtils.js";
import { NameHash } from "./nameHash.js";
import { ExistingGroupLocationConflictError, GroupNotEmptyError } from "./errors.js";
import { execaAzCliInvokerFactory } from "./azCliUtils.js";
import { AzAccountTools } from "./azAccountTools.js";
import { AzGroupTools } from "./azGroupTools.js";
import { AzGlobalInterface } from "./interface.js";

export type {
  Account,
  ResourceSummary,
};

const az = (function(): AzGlobalInterface {
  const invoker = execaAzCliInvokerFactory({
    forceAzCommandPrefix: true,
    laxParsing: false,
  });
  const mainFn = invoker.strict;
  const accountTools = new AzAccountTools(invoker);
  const cliResult = Object.assign(mainFn, {
    account: accountTools,
    group: new AzGroupTools(invoker, { })
  });
  let result = Object.assign(cliResult, {
    strict: invoker.strict,
    lax: invoker.lax,
    getCredential: accountTools.getCredential,
  });
  return result;
})();

export default az;
export {
  az,
  isSubscriptionId,
  isTenantId,
  NameHash,
  ExistingGroupLocationConflictError,
  GroupNotEmptyError,
}
