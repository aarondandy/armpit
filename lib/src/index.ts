import { $ as Execa$ } from "execa";
import type { TemplateExpression, ExecaError, /*ExecaScriptMethod*/ } from "execa";
import type { Location } from "@azure/arm-resources-subscriptions";
//import type { ResourceGroup } from "@azure/arm-resources";
import {
  type Account,
  type SubscriptionId,
  isSubscriptionId,
  type SubscriptionIdOrName,
  isSubscriptionIdOrName,
  type TenantId,
  isTenantId,
} from "./azureTypes.js";

export type { Account };

interface AzureCliOptions {
  env?: NodeJS.ProcessEnv,
  subscription?: string,
  defaultLocation?: string,
  defaultResourceGroup?: string,
  laxParsing?: boolean,
  forceAzCommandPrefix?: boolean,
}

type TagTemplateParameters = readonly [TemplateStringsArray, ...readonly TemplateExpression[]];
type AzCliInvokerFactory = <TOptions extends AzureCliOptions>(options: TOptions) => <TResult>(...args: TagTemplateParameters) => Promise<TOptions extends { laxParsing: true } ? (TResult | null) : TResult>;

interface AzCliInvokable {
  <T>(templates: TemplateStringsArray, ...expressions: readonly TemplateExpression[]): Promise<T>;
  strict: <T>(templates: TemplateStringsArray, ...expressions: readonly TemplateExpression[]) => Promise<T>;
  lax: <T>(templates: TemplateStringsArray, ...expressions: readonly TemplateExpression[]) => Promise<T | null>;
}

const ensureAzPrefix = function(templates: TemplateStringsArray) {
  if (templates.length > 0 && !/^\s*az\s/i.test(templates[0])) {
    const [firstCookedTemplate, ...remainingCookedTemplates] = templates;
    const [firstRawTemplate, ...remainingRawTemplates] = templates.raw;
    templates = Object.assign([`az ${firstCookedTemplate}`, ...remainingCookedTemplates], {
      raw: [`az ${firstRawTemplate}`, ...remainingRawTemplates]
    });
  }

  return templates;
}

const execaAzCliInvokerFactory: AzCliInvokerFactory = function<TOptions extends AzureCliOptions>(options: TOptions) {
  const env: NodeJS.ProcessEnv = {
    ...options.env,
    AZURE_CORE_OUTPUT: "json", // request json by default
    AZURE_CORE_ONLY_SHOW_ERRORS: "true", // the tools aren't always consistent so this is just simpler
    AZURE_CORE_NO_COLOR: "true", // hopefully this reduces some noise in stderr and stdout
    AZURE_CORE_LOGIN_EXPERIENCE_V2: "off", // these tools have their own way to select accounts
  };

  if (options.defaultResourceGroup != null) {
    env.AZURE_DEFAULTS_GROUP = options.defaultResourceGroup;
  }

  if (options.defaultLocation != null) {
    env.AZURE_DEFAULTS_LOCATION = options.defaultLocation;
  }

  const execaInvoker = Execa$({
    env,
  });

  return async (templates, ...expressions) => {
    if (options.forceAzCommandPrefix) {
      templates = ensureAzPrefix(templates);
    }

    let invocationResult;
    try {
      invocationResult = await execaInvoker(templates, ...expressions);
    } catch (invocationError) {
      if (options.laxParsing) {
        const stderr = (<ExecaError>invocationError)?.stderr;
        if (stderr && typeof stderr === "string" && /not\s*found/i.test(stderr)) {
          return null;
        }
      }

      throw invocationError;
    }

    const { stdout, stderr } = invocationResult;

    if (stderr != null && stderr !== "") {
      console.warn(stderr);
    }

    if (stdout == null || stdout === "") {
      if (options.laxParsing) {
        return null;
      } else {
        throw new Error("Resulting stream was empty");
      }
    } else if (typeof stdout === "string") {
      return JSON.parse(stdout);
    } else if (Array.isArray(stdout)) {
      return JSON.parse((<string[]>stdout).join(""));
    } else {
      throw new Error("Failed to parse invocation result");
    }
  };
}

class AzCliAccount {
  #azCli: AzCliInvokable;

  constructor(azCli: AzCliInvokable) {
    this.#azCli = azCli;
  }

  async show() {
    try {
      return await this.#azCli.lax<Account>`account show`;
    } catch (invocationError) {
      const stderr = (<ExecaError>invocationError)?.stderr;
      if (stderr && typeof stderr === "string" && (/az login|az account set/i).test(stderr)) {
        return null;
      }

      throw invocationError;
    }
  }

  async list(opt?: {all?: boolean, refresh?: boolean}) : Promise<Account[]> {
    let flags: string[] | undefined;
    if (opt) {
      flags = [];
      if (opt.all) {
        flags.push("--all");
      }
      if (opt.refresh) {
        flags.push("--refresh");
      }
    }

    let results: Account[] | null;
    if (flags && flags.length > 0) {
      results = await this.#azCli.lax<Account[]>`account list ${flags}`;
    } else {
      results = await this.#azCli.lax<Account[]>`account list`;
    }

    return results ?? [];
  }

  async set(subscriptionIdOrName: SubscriptionIdOrName) {
    await this.#azCli.lax<Account>`account set -s ${subscriptionIdOrName}`;
  }

  async setOrLogin(subscriptionIdOrName: SubscriptionIdOrName, tenantId?: TenantId): Promise<Account | null>;
  async setOrLogin(criteria: {subscriptionId: SubscriptionId, tenantId?: TenantId}): Promise<Account | null>;
  async setOrLogin(criteria: any, secondArg?: any): Promise<Account | null> {
    let subscription: SubscriptionId | SubscriptionIdOrName;
    let tenantId: string | undefined;
    let filterAccountsToSubscription: (candidates: Account[]) => Account[];

    if (isSubscriptionIdOrName(criteria)) {
      // overload: subscription, tenantId?
      subscription = criteria;
      if (secondArg != null) {
        if (isTenantId(secondArg)) {
          tenantId = secondArg;
        } else {
          throw new Error("Given tenant ID is not valid");
        }
      }

      filterAccountsToSubscription = (accounts) => {
        let results = accounts.filter(a => a.id === subscription);
        if (results.length === 0) {
          results = accounts.filter(a => a.name === subscription);
        }

        return results;
      }
    } else if ("subscriptionId" in criteria) {
      // overload: {subscriptionId, tenantId?}
      if (isSubscriptionId(criteria.subscriptionId)) {
        subscription = criteria.subscriptionId;
      } else {
        throw new Error("Subscription ID is not valid");
      }

      if ("tenantId" in criteria) {
        if (isTenantId(criteria.tenantId)) {
          tenantId = criteria.tenantId;
        } else {
          throw new Error("Given tenant ID is not valid");
        }
      }

      filterAccountsToSubscription = (accounts) => accounts.filter(a => a.id === subscription);
    } else {
      throw new Error("Arguments not supported");
    }

    const findAccount = (candidates: (Account | null)[]) => {
      let matches = filterAccountsToSubscription(candidates.filter(a => a != null));
      if (matches.length > 1 && tenantId) {
        matches = matches.filter(a => a.tenantId == tenantId);
      }

      if (matches.length === 0) {
        return null;
      }

      if (matches.length > 1) {
        throw new Error(`Multiple account matches found: ${matches.map(a => a.id)}`);
      }

      const match = matches[0];
      if (tenantId && match.tenantId != tenantId) {
        throw new Error(`Account ${match.id} does not match expected tenant ${tenantId}`);
      }

      return match;
    }

    let account = findAccount([await this.show()]);
    if (account) {
      return account;
    }

    // TODO: Consider refreshing and allowing a search of non-enabled accounts.
    //       That could come at a cost to performance though.
    let knownAccounts = await this.list();
    account = findAccount(knownAccounts);
    if (account) {
      await this.set(subscription);
      return account;
    }

    console.debug("No current accounts match. Starting interactive login.");

    knownAccounts = await this.login(tenantId) ?? [];
    account = findAccount(knownAccounts);

    if (!(account?.isDefault)) {
      await this.set(subscription);
      account = await this.show();
    }

    return account;
  }

  async login(tenantId?: string) : Promise<Account[] | null> {
    try {
      let loginAccounts : Account[] | null;
      if (tenantId) {
        loginAccounts = await this.#azCli<Account[]>`login --tenant ${tenantId}`;
      } else {
        loginAccounts = await this.#azCli<Account[]>`login`;
      }

      return loginAccounts;

    } catch (invocationError) {
      const stderr = (<ExecaError>invocationError)?.stderr;
      if (stderr && typeof stderr === "string" && (/User cancelled/i).test(stderr)) {
        return null;
      }

      throw invocationError;
    }
  }

  async listLocations(names?: string[]) {
    let results : Location[];
    if (names != null && names.length > 0) {
      const queryFilter = `[? contains([${names.map((n) => `'${n}'`).join(",")}],name)]`;
      results = await this.#azCli<Location[]>`account list-locations --query ${queryFilter}`;
    }
    else {
      results = await this.#azCli<Location[]>`account list-locations`;
    }

    return results ?? [];
  }
}

function buildAzCli() {
  const cliFnOptions = {
    forceAzCommandPrefix: true,
    laxParsing: false,
  };
  const strictFn = execaAzCliInvokerFactory(cliFnOptions);
  const laxFn = execaAzCliInvokerFactory({ ...cliFnOptions, laxParsing: true });
  const mainFn = strictFn; // TODO: there may be other overloads for this one

  const cliResult: AzCliInvokable = Object.assign(mainFn, {
    strict: strictFn,
    lax: laxFn
  });
  let result = Object.assign(cliResult, {
    account: new AzCliAccount(cliResult)
  });
  return result;
}

const az = buildAzCli();

export {
  az,
  isSubscriptionId,
  isTenantId
}

/*export const az = buildAzCli();
export const isSubscriptionId = isSubscriptionId;
export const isTenantId = isTenantId;*/

/*class AzCliGroup {
  #azCli: AzCli;

  constructor(azCli: AzCli) {
    this.#azCli = azCli;
  }

  list() {
    return this.#azCli<ResourceGroup[]>`group list`;
  }

  show(name: string) {
    return this.#azCli<ResourceGroup | null>`group show --name ${name}`;
  }
}*/
