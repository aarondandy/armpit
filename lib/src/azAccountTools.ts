import type { ExecaError } from "execa";
import type { Location } from "@azure/arm-resources-subscriptions";
import type { AzCliInvokers } from "./azCliUtils.js";
import {
  type Account,
  type SubscriptionIdOrName,
  isSubscriptionIdOrName,
  type SubscriptionId,
  isSubscriptionId,
  type TenantId,
  isTenantId,
} from "./azUtils.js";
import { ArmpitCredential, ArmpitCredentialOptions, ArmpitCredentialProvider } from "./armpitCredential.js";

export class AzAccountTools implements ArmpitCredentialProvider {

  #invokers: AzCliInvokers;

  constructor(invokers: AzCliInvokers) {
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

  getCredential(options?: ArmpitCredentialOptions): ArmpitCredential {
    return new ArmpitCredential(this.#invokers, options);
  }
}
