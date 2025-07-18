import type { AccessToken, TokenCredential, GetTokenOptions } from "@azure/core-auth";
import {
  type TenantId,
  isTenantId,
  type SubscriptionId,
  isSubscriptionId,
  type SubscriptionIdOrName,
  isSubscriptionIdOrName,
  isScope,
  type AzCliAccessToken,
} from "./azureUtils.js"
import type { AzCliInvoker } from "./azCliUtils.js";

export interface ArmpitCredentialOptions {
  tenantId?: TenantId,
  subscription?: SubscriptionIdOrName,
}

export interface ArmpitTokenContext {
  tenantId?: TenantId,
  subscriptionId?: SubscriptionId,
}

/**
 * Provides access tokens from the current Azure CLI invoker.
 * @remarks
 * This class is intended to be instantiated internally and exposed as a TokenCredential.
 * The implementation is similar to AzureCliCredential but using armpit invokers.
 */
export interface ArmpitCredential extends TokenCredential {
  getLastTokenContext(): ArmpitTokenContext | null;
}

export function buildCliCredential(invokers: AzCliInvoker, options?: ArmpitCredentialOptions): ArmpitCredential {
  const defaultTenantId = options?.tenantId;
  if (defaultTenantId && !isTenantId(defaultTenantId)) {
    throw new Error("Invalid tenant ID.");
  }

  const defaultSubscription = options?.subscription;
  if (defaultSubscription && !isSubscriptionIdOrName(defaultSubscription)) {
    throw new Error("Invalid subscription name or subscription ID.");
  }

  let lastTokenContext: ArmpitTokenContext | null = null;

  const getToken = async function(scopes: string | string[], options: GetTokenOptions = {}): Promise<AccessToken> {
    // This is loosely based on AzureCliCredential but uses the internals provided by this library

    if (typeof scopes === "string") {
      scopes = [scopes];
    }

    if (!scopes.every(isScope)) {
      throw new Error("Scopes are invalid");
    }

    const args: string[] = ["--scope", ...scopes];

    const tenantId = options?.tenantId ?? defaultTenantId;
    if (tenantId) {
      args.push("--tenant", tenantId);
    }
    else if (defaultSubscription) {
      args.push("--subscription", defaultSubscription);
    }

    const result = await invokers.strict<AzCliAccessToken>`account get-access-token ${args}`;

    let expiresOn = Number.parseInt(result.expires_on as any, 10) * 1000;
    if (isNaN(expiresOn)) {
      expiresOn = new Date(result.expiresOn).getTime();
    }

    if (isNaN(expiresOn)) {
      throw new Error("Failed to extract token expiration");
    }

    let tokenType = result.tokenType ?? "Bearer";
    if (tokenType !== "Bearer") {
      throw new Error(`Token type ${tokenType} is not supported`);
    }

    lastTokenContext = { };
    if (isSubscriptionId(result.subscription)) {
      lastTokenContext.subscriptionId = result.subscription;
    }

    if (isTenantId(result.tenant)) {
      lastTokenContext.tenantId = result.tenant;
    }

    return {
      token: result.accessToken,
      expiresOnTimestamp: expiresOn,
      tokenType,
    };
  }

  const getLastTokenContext = function() {
    return lastTokenContext;
  }

  // A plain object is returned so libraries that clone the credential object like tedious/mssql can be compatible.
  return {
    getToken,
    getLastTokenContext,
  };
}

/**
 * Provides a token credential associated with the context of the provider.
 */
export interface ArmpitCredentialProvider {
  /**
   * Get a token credential associated within the context it is retrieved from.
   *
   * @param options Override how tokens are generated.
   */
  getCredential(options?: ArmpitCredentialOptions): ArmpitCredential;
}

export class ArmpitCliCredentialFactory {
  #cache: {options: ArmpitCredentialOptions, credential: ArmpitCredential}[] = [];
  #defaultInvoker: AzCliInvoker | null;

  constructor(defaultInvoker?: AzCliInvoker) {
    this.#defaultInvoker = defaultInvoker ?? null;
  }

  getCredential(options?: ArmpitCredentialOptions, invokerOverride?: AzCliInvoker): ArmpitCredential {
    const invoker = invokerOverride ?? this.#defaultInvoker;
    if (invoker == null) {
      throw new Error("An invoker is required to build a credential");
    }

    let cacheKeyValue: string | null = options != null && (options.subscription != null || options.tenantId != null)
      ? JSON.stringify(options)
      : null;

    if (cacheKeyValue) {
      const matching = this.#cache.find(e => e.options && JSON.stringify(e.options) === cacheKeyValue);
      if (matching) {
        return matching.credential;
      }
    }

    let credential = buildCliCredential(invoker, options);

    if (cacheKeyValue && options) {
      this.#cache.push({options, credential});
    }

    return credential;
  }
}
