import type { ExecaError, /*ExecaScriptMethod*/ } from "execa";
import type { Location } from "@azure/arm-resources-subscriptions";
import type { ResourceGroup } from "@azure/arm-resources";
import {
  type Account,
  type ResourceSummary,
  type SubscriptionId,
  isSubscriptionId,
  type SubscriptionIdOrName,
  isSubscriptionIdOrName,
  type TenantId,
  isTenantId,
  isNamedLocationDescriptor,
} from "./azureTypes.js";
import { NameHash } from "./nameHash.js";
import { ExistingGroupLocationConflictError, GroupNotEmptyError } from "./errors.js";
import { execaAzCliInvokerFactory, type CliInvokers, type AzTemplateExpression } from "./invoker.js";
import { CallableClassBase } from "./utils.js";

export type {
  Account,
};

interface AzCliInvokable {
  <T>(templates: TemplateStringsArray, ...expressions: readonly AzTemplateExpression[]): Promise<T>;
  strict: <T>(templates: TemplateStringsArray, ...expressions: readonly AzTemplateExpression[]) => Promise<T>;
  lax: <T>(templates: TemplateStringsArray, ...expressions: readonly AzTemplateExpression[]) => Promise<T | null>;
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
  (name: string, location: string): Promise<AzGroupBound & AzCliInvokable>;
  (descriptor: {name: string, location: string}): Promise<AzGroupBound & AzCliInvokable>;
}

class AzGroupTools extends CallableClassBase implements AzGroupTools {
  #invokers: CliInvokers;
  #context: { location?: string };

  constructor(invokers: CliInvokers, context: { location?: string }) {
    super();
    this.#invokers = invokers;
    this.#context = context;
  }

  protected fnImpl(name: string, location: string): Promise<AzGroupBound & AzCliInvokable>;
  protected fnImpl(descriptor: { readonly name: string, readonly location: string}): Promise<AzGroupBound & AzCliInvokable>;
  protected async fnImpl(nameOrDescriptor: string | { readonly name: string, readonly location: string }, secondArg?: string): Promise<AzGroupBound & AzCliInvokable> {
    let descriptor: { name: string, location: string };

    if (nameOrDescriptor == null) {
      throw new Error("Name or descriptor is required");
    }

    if (typeof nameOrDescriptor === "string") {
      // overload: string, location: string
      descriptor = {
        name: nameOrDescriptor,
        location: secondArg ?? this.#getRequiredDefaultLocation()
      };
    } else if ("name" in nameOrDescriptor) {
      // overload: {name, location}

      if (typeof nameOrDescriptor.name !== "string") {
        throw new Error("Group name is required");
      }

      if (typeof nameOrDescriptor.location !== "string") {
        throw new Error("An explicit location is required");
      }

      descriptor = nameOrDescriptor;
    } else {
      throw new Error("Unexpected arguments");
    }

    if (descriptor.location == null) {
      // TODO: Can location be inherited if this.#azCli is AzLocationBound
      throw new Error("Location is required");
    }

    let group = await this.show(descriptor.name);
    if (group == null) {
      group = await this.create(descriptor.name, descriptor.location);
    } else if (group.location !== descriptor.location) {
      throw new ExistingGroupLocationConflictError(group, descriptor.location);
    }

    if (!isNamedLocationDescriptor(group)) {
      throw new Error("Resource group is not correctly formed");
    }

    return this.#cli(group);
  }

  async show(name: string): Promise<ResourceGroup | null> {
    return await this.#invokers.lax<ResourceGroup>`group show --name ${name}`;
  };

  async exists(name: string): Promise<boolean> {
    return !!(await this.#invokers.lax<boolean>`group exists --name ${name}`);
  }

  async create(name: string, location: string) {
    return await this.#invokers.strict<ResourceGroup>`group create --name ${name} -l ${location}`;
  }

  async delete(name: string) {
    const group = await this.show(name);
    if (group == null) {
      return false;
    }

    if (typeof group.name !== "string") {
      throw new Error(`Loaded resource group for ${name} is not valid`);
    } else if (group.name !== name) {
      throw new Error(`Loaded resource group for ${name} has a conflicting name: ${group.name}`);
    }

    const jmesQuery = "[].{id: id, name: name, type: type}"; // passes as an expression for correct escaping
    const resources = await this.#invokers.strict<ResourceSummary[]>`resource list --resource-group ${name} --query ${jmesQuery}`;
    if (resources.length !== 0) {
      throw new GroupNotEmptyError(name, resources);
    }

    await this.#invokers.strict<void>`group delete --yes --name ${name}`;
    return true;
  }

  #cli(descriptor: { readonly name: string, readonly location: string}): AzGroupBound & AzCliInvokable {
    const invoker = execaAzCliInvokerFactory({
      forceAzCommandPrefix: true,
      laxParsing: false,
      defaultLocation: descriptor.location,
      defaultResourceGroup: descriptor.name,
    });

    const { name: groupName, ...descriptorWithoutName } = descriptor;

    const mainFn = invoker.strict;
    const cliResult = Object.assign(mainFn, descriptorWithoutName);
    Object.defineProperty(cliResult, "name", {
      value: groupName,
      configurable: true,
      enumerable: true,
      writable: false,
    });
    return Object.assign(cliResult, {
      strict: invoker.strict,
      lax: invoker.lax
    });
  }

  #getRequiredDefaultLocation(): string {
    const location = this.#context.location;
    if (location == null) {
      throw new Error("No required default location has been set");
    }

    return location;
  }
}

class AzAccountTools {
  #invokers: CliInvokers;

  constructor(invokers: CliInvokers) {
    this.#invokers = invokers;
  }

  async show() {
    try {
      return await this.#invokers.lax<Account>`account show`;
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
      results = await this.#invokers.lax<Account[]>`account list ${flags}`;
    } else {
      results = await this.#invokers.lax<Account[]>`account list`;
    }

    return results ?? [];
  }

  async set(subscriptionIdOrName: SubscriptionIdOrName) {
    await this.#invokers.lax<Account>`account set -s ${subscriptionIdOrName}`;
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
        loginAccounts = await this.#invokers.strict<Account[]>`login --tenant ${tenantId}`;
      } else {
        loginAccounts = await this.#invokers.strict<Account[]>`login`;
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
      results = await this.#invokers.strict<Location[]>`account list-locations --query ${queryFilter}`;
    }
    else {
      results = await this.#invokers.strict<Location[]>`account list-locations`;
    }

    return results ?? [];
  }
}

const az = (function(): AzGlobal & AzCliInvokable {
  const invoker = execaAzCliInvokerFactory({
    forceAzCommandPrefix: true,
    laxParsing: false,
  });
  const mainFn = invoker.strict;
  const cliResult = Object.assign(mainFn, {
    account: new AzAccountTools(invoker),
    group: new AzGroupTools(invoker, { })
  });
  let result = Object.assign(cliResult, {
    strict: invoker.strict,
    lax: invoker.lax
  });
  return result;
})();

export {
  az,
  isSubscriptionId,
  isTenantId,
  NameHash,
  ExistingGroupLocationConflictError,
  GroupNotEmptyError,
}
