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
import { AccountTools } from "./accountTools.js";
import { ResourceGroupTools } from "./resourceGroupTools.js";
import { AzGlobalInterface } from "./interface.js";
import { ArmpitCliCredentialFactory } from "./armpitCredential.js";

export type {
  Account,
  ResourceSummary,
};

const az = (function(): AzGlobalInterface {
  const abortController = new AbortController();
  process.on("SIGINT", () => abortController.abort("SIGINT received"));
  process.on("SIGTERM", () => abortController.abort("SIGTERM received"));

  const invoker = execaAzCliInvokerFactory({
    forceAzCommandPrefix: true,
    abortSignal: abortController.signal,
  });
  const mainFn = invoker.strict;
  const credentialFactory = new ArmpitCliCredentialFactory(invoker);
  const managementClientFactory = new ManagementClientFactory(credentialFactory);
  const sharedDependencies = {
    invoker,
    credentialFactory,
    managementClientFactory,
  };
  const accountTools = new AccountTools(sharedDependencies, {
    abortSignal: abortController.signal,
  });
  const cliResult = Object.assign(mainFn, {
    account: accountTools,
    group: new ResourceGroupTools(sharedDependencies, {
      abortSignal: abortController.signal
    })
  });
  return Object.assign(cliResult, {
    strict: invoker.strict,
    lax: invoker.lax,
    getCredential: accountTools.getCredential,
  });
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
