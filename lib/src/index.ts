import {
  type Account,
  type ResourceSummary,
  isSubscriptionId,
  isTenantId,
} from "./azureUtils.js";
import { NameHash } from "./nameHash.js";
import { ExistingGroupLocationConflictError, GroupNotEmptyError } from "./errors.js";
import { execaAzCliInvokerFactory } from "./azCliUtils.js";
import { ManagementClientFactory } from "./azureSdkUtils.js";
import { AzAccountTools } from "./accountTools.js";
import { ResourceGroupTools } from "./resourceGroupTools.js";
import { AzGlobalInterface } from "./interface.js";
import { ArmpitCliCredentialFactory } from "./armpitCredential.js";

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
  const credentialFactory = new ArmpitCliCredentialFactory(invoker);
  const managementClientFactory = new ManagementClientFactory(credentialFactory);
  const accountTools = new AzAccountTools(invoker, credentialFactory);
  const cliResult = Object.assign(mainFn, {
    account: accountTools,
    group: new ResourceGroupTools(invoker, credentialFactory, managementClientFactory, { })
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
