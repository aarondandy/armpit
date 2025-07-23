import type { ExecaError } from "execa";
import type { Location } from "@azure/arm-resources-subscriptions";
import { mergeAbortSignals } from "./tsUtils.js";
import type { AzCliInvoker, AzCliTemplateFn } from "./azCliInvoker.js";
import {
  type Account,
  type SubscriptionIdOrName,
  isSubscriptionIdOrName,
  type SubscriptionId,
  isSubscriptionId,
  type TenantId,
  isTenantId,
  type SimpleAdUser,
} from "./azureUtils.js";
import {
  type ArmpitCredentialProvider,
  type ArmpitCredential,
  type ArmpitCredentialOptions,
  ArmpitCliCredentialFactory,
} from "./armpitCredential.js";

interface AccountToolsOptions {
  abortSignal?: AbortSignal;
}

type AccountToolsConstructorOptions = AccountToolsOptions;

interface AccountToolsDependencies {
  invoker: AzCliInvoker;
  credentialFactory: ArmpitCliCredentialFactory;
}

interface AccountListOptions extends AccountToolsOptions {
  all?: boolean;
  refresh?: boolean;
}

interface AccountSelectionCriteria {
  subscriptionId: SubscriptionId;
  tenantId?: TenantId;
}

/**
 * Tools to work with Azure CLI accounts.
 * @remarks
 * Accounts roughly approximate a subscription accessed by a user via the Azure CLI.
 */
export class AccountTools implements ArmpitCredentialProvider {
  /** Invoker associated with a global Azure CLI shell */
  #invoker: AzCliInvoker;
  #credentialFactory: ArmpitCliCredentialFactory;
  #options: AccountToolsOptions;

  constructor(dependencies: AccountToolsDependencies, options: AccountToolsConstructorOptions) {
    this.#invoker = dependencies.invoker;
    this.#credentialFactory = dependencies.credentialFactory ?? new ArmpitCliCredentialFactory(this.#invoker);
    this.#options = options;
  }

  /**
   * Shows the current active Azure CLI account.
   * @returns The current Azure CLI account, if available.
   * @remarks
   * This effectively invokes `az account show`.
   */
  async show(options?: AccountToolsOptions) {
    const invoker = this.#getLaxInvokerFn(options)<Account>;

    try {
      return await invoker`account show`;
    } catch (invocationError) {
      const stderr = (<ExecaError>invocationError)?.stderr;
      if (stderr && typeof stderr === "string" && /az login|az account set/i.test(stderr)) {
        return null;
      }

      throw invocationError;
    }
  }

  /**
   * Shows the current signed in user.
   * @returns The current user.
   * This effectively invokes `az ad signed-in-user show`.
   */
  async showSignedInUser(options?: AccountToolsOptions) {
    return await this.#getInvokerFn(options)<SimpleAdUser>`ad signed-in-user show`;
  }

  /**
   * Lists accounts known to the Azure CLI instance.
   * @param options Query options.
   * @returns The accounts known to the Azure CLI instance.
   * @remarks
   * This effectively invokes `az account list`.
   */
  async list(options?: AccountListOptions): Promise<Account[]> {
    const invoker = this.#getLaxInvokerFn(options)<Account[]>;

    let args: string[] | undefined;
    if (options) {
      args = [];
      if (options.all) {
        args.push("--all");
      }
      if (options.refresh) {
        args.push("--refresh");
      }
    }

    const results = args && args.length > 0 ? await invoker`account list ${args}` : await invoker`account list`;
    return results ?? [];
  }

  /**
   * Sets the active account to the given subscription ID or name.
   * @param subscriptionIdOrName The subscription ID or name to switch the account to.
   * @remarks
   * This effectively invokes `az account set`.
   */
  async set(subscriptionIdOrName: SubscriptionIdOrName, options?: AccountToolsOptions) {
    const invoker = this.#getLaxInvokerFn(options)<Account>;
    await invoker`account set --subscription ${subscriptionIdOrName}`;
  }

  /**
   * Sets the active account to the given subscription or initiates a login if required.
   * @param subscriptionIdOrName The subscription ID or name to set the account to.
   * @param tenantId The tenant to log into when required.
   */
  async setOrLogin(
    subscriptionIdOrName: SubscriptionIdOrName,
    tenantId?: TenantId,
    options?: AccountToolsOptions,
  ): Promise<Account | null>;
  /**
   * Sets the active account to the given subscription or initiates a login if required.
   * @param criteria The selection criteria for the account.
   */
  async setOrLogin(criteria: AccountSelectionCriteria, options?: AccountToolsOptions): Promise<Account | null>;
  async setOrLogin(
    criteria: SubscriptionIdOrName | AccountSelectionCriteria,
    secondArg?: TenantId | AccountToolsOptions,
    thirdArg?: AccountToolsOptions,
  ): Promise<Account | null> {
    let subscription: SubscriptionId | SubscriptionIdOrName;
    let tenantId: string | undefined;
    let options: AccountToolsOptions | undefined;
    let filterAccountsToSubscription: (candidates: Account[]) => Account[];

    if (isSubscriptionIdOrName(criteria)) {
      // overload: subscription, tenantId?, options?
      if (thirdArg != null) {
        options = thirdArg;
      }

      subscription = criteria;
      if (secondArg != null) {
        if (isTenantId(secondArg)) {
          tenantId = secondArg;
        } else {
          throw new Error("Given tenant ID is not valid");
        }
      }

      filterAccountsToSubscription = accounts => {
        let results = accounts.filter(a => a.id === subscription);
        if (results.length === 0) {
          results = accounts.filter(a => a.name === subscription);
        }

        return results;
      };
    } else if (criteria.subscriptionId != null) {
      // overload: {subscriptionId, tenantId?}, options?
      if (secondArg != null) {
        options = secondArg as AccountToolsOptions;
      }

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

      filterAccountsToSubscription = accounts => accounts.filter(a => a.id === subscription);
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
    };

    let account = findAccount([await this.show(options)]);
    if (account) {
      return account;
    }

    // TODO: Consider refreshing and allowing a search of non-enabled accounts.
    //       That could come at a cost to performance though.
    account = findAccount(await this.list(options));
    if (account) {
      await this.set(subscription, options);
      return account;
    }

    console.debug("No current accounts match. Starting interactive login.");

    const accountResults = await this.login(tenantId, options);
    if (accountResults) {
      account = findAccount(accountResults);
    }

    if (!account || !account.isDefault) {
      await this.set(subscription, options);
      account = await this.show(options);
    }

    return account;
  }

  /**
   * Initiates an Azure CLI login.
   * @param tenantId The tenant to log into.
   * @returns An account if login is successful.
   */
  async login(tenantId?: string, options?: AccountToolsOptions): Promise<Account[] | null> {
    const invoker = this.#getInvokerFn(options)<Account[]>;

    try {
      return tenantId ? await invoker`login --tenant ${tenantId}` : await invoker`login`;
    } catch (invocationError) {
      const stderr = (<ExecaError>invocationError)?.stderr;
      if (stderr && typeof stderr === "string" && /User cancelled/i.test(stderr)) {
        return null;
      }

      throw invocationError;
    }
  }

  /**
   * Provides the current account or initiates a login if required.
   * @returns A logged in account when successful.
   */
  async ensureActiveAccount(options?: AccountToolsOptions) {
    let account = await this.show(options);

    if (account == null) {
      const accounts = await this.login(undefined, options);
      account = accounts?.find(a => a.isDefault) ?? null;

      if (account == null) {
        throw new Error("Failed to ensure active account");
      }
    }

    return account;
  }

  /**
   * Lits Azure locations.
   * @param names The location names to filter locations to.
   * @returns A lot of Azure locations.
   */
  async listLocations(names?: string[], options?: AccountToolsOptions) {
    const invoker = this.#getInvokerFn(options)<Location[]>;

    let results: Location[];
    if (names != null && names.length > 0) {
      const queryFilter = `[? contains([${names.map(n => `'${n}'`).join(",")}],name)]`;
      results = await invoker`account list-locations --query ${queryFilter}`;
    } else {
      results = await invoker`account list-locations`;
    }

    return results ?? [];
  }

  getCredential(options?: ArmpitCredentialOptions): ArmpitCredential {
    return this.#credentialFactory.getCredential(options);
  }

  #getInvokerFn(options?: AccountToolsOptions): AzCliTemplateFn<never> {
    const abortSignal = mergeAbortSignals(options?.abortSignal, this.#options.abortSignal);
    return abortSignal == null ? this.#invoker : this.#invoker({ abortSignal });
  }

  #getLaxInvokerFn(options?: AccountToolsOptions): AzCliTemplateFn<null> {
    const invokerOptions: {
      allowBlanks: true;
      abortSignal?: AbortSignal;
    } = {
      allowBlanks: true,
    };

    const abortSignal = mergeAbortSignals(options?.abortSignal, this.#options.abortSignal);
    if (abortSignal != null) {
      invokerOptions.abortSignal = abortSignal;
    }

    return this.#invoker(invokerOptions);
  }
}
