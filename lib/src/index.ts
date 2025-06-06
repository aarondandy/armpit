import type { TemplateExpression, ExecaError, /*ExecaScriptMethod*/ } from "execa";
import type { Location } from "@azure/arm-resources-subscriptions";
// import type { ResourceGroup } from "@azure/arm-resources";
import {
  type Account,
  type SubscriptionId,
  isSubscriptionId,
  type SubscriptionIdOrName,
  isSubscriptionIdOrName,
  type TenantId,
  isTenantId,
} from "./azureTypes.js";
import { execaAzCliInvokerFactory } from "./invoker.js";

export type { Account };

interface AzCliInvokable {
  <T>(templates: TemplateStringsArray, ...expressions: readonly TemplateExpression[]): Promise<T>;
  strict: <T>(templates: TemplateStringsArray, ...expressions: readonly TemplateExpression[]) => Promise<T>;
  lax: <T>(templates: TemplateStringsArray, ...expressions: readonly TemplateExpression[]) => Promise<T | null>;
  // TODO: Expose env vars so somebody can use Execa or zx directly.
}

interface AzGlobal {
  readonly group: AzGroupTools;
  readonly account: AzAccountTools;
}

interface AzLocationBound {
  readonly location: string;
}

interface AzGroupBound extends AzLocationBound {
  readonly name: string;
}

interface AzGroupTools {
  (name: string, location: string): Promise<AzGroupBound>;
  (descriptor: {name: string, location: string}): Promise<AzGroupBound>;
}

abstract class AzGroupToolsCallable {
  constructor() {
    const closure = function(...args: any[]) {
      return (closure as any as AzGroupToolsCallable).fnImpl(...args);
    }
    return Object.setPrototypeOf(closure, new.target.prototype);
  }

  protected abstract fnImpl(...args: any[]): any;
}

class AzGroupTools extends AzGroupToolsCallable implements AzGroupTools {
  #azCli: AzCliInvokable;

  constructor(azCli: AzCliInvokable) {
    super();
    this.#azCli = azCli;
  }

  protected fnImpl(name: string, location: string): Promise<AzGroupBound>;
  protected fnImpl(descriptor: {name: string, location: string}): Promise<AzGroupBound>;
  protected fnImpl(descriptor: string | { name: string, location?: string }, secondArg?: string): Promise<AzGroupBound> {
    let name: string | unknown;
    let location: string | unknown;

    if (descriptor == null) {
      throw new Error("Name or descriptor is required");
    }

    if (typeof descriptor === "string") {
      // overload: string, location: string
      name = descriptor;
      location = secondArg;
    } else if ("name" in descriptor) {
      // overload: {name, location}
      if (typeof descriptor.name === "string") {
        name = descriptor.name;
      }

      if (typeof descriptor.location === "string") {
        location = descriptor.location;
      } else {
        throw new Error("Location is required");
      }
    }

    if (name == null) {
      throw new Error("Group name is required");
    }

    if (location == null) {
      // TODO: Can location be inherited if this.#azCli is AzLocationBound
      throw new Error("Location is required");
    }

    throw new Error(`TODO ${name} ${location} ${this.#azCli.name}`);
  }
}

class AzAccountTools {
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

  const invoker = execaAzCliInvokerFactory(cliFnOptions);
  const mainFn = invoker.strict;
  const cliResult: AzCliInvokable = Object.assign(mainFn, {
    strict: invoker.strict,
    lax: invoker.lax
  });
  let result = Object.assign(cliResult, <AzGlobal>{
    account: new AzAccountTools(cliResult),
    group: new AzGroupTools(cliResult)
  });
  return result;
}

const az = buildAzCli();

export {
  az,
  isSubscriptionId,
  isTenantId
}
