import { AzCliExecaInvoker } from "./azCliExecaInvoker.js";
import { ManagementClientFactory } from "./azureSdkUtils.js";
import { AccountTools } from "./accountTools.js";
import { ResourceGroupTools } from "./resourceGroupTools.js";
import { AzGlobalInterface } from "./interface.js";
import { ArmpitCliCredentialFactory } from "./armpitCredential.js";

const az = (function (): AzGlobalInterface {
  const abortController = new AbortController();
  process.on("SIGINT", () => abortController.abort("SIGINT received"));
  process.on("SIGTERM", () => abortController.abort("SIGTERM received"));

  const invoker = new AzCliExecaInvoker({
    abortSignal: abortController.signal,
  });
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

  // eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
  const mainFn = (...args: unknown[]) => (invoker as Function)(...args);
  const cliResult = Object.assign(mainFn, {
    account: accountTools,
    group: new ResourceGroupTools(sharedDependencies, { abortSignal: abortController.signal }),
  });
  return Object.assign(cliResult, {
    getCredential: accountTools.getCredential,
  });
})();

export { az };
