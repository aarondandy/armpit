import type { AccessToken, TokenCredential, GetTokenOptions } from "@azure/core-auth";
import {
  type TenantId,
  isTenantId,
  type SubscriptionIdOrName,
  isSubscriptionIdOrName,
  isScope,
  type AzCliAccessToken,
} from "./azUtils.js"
import type { AzCliInvokers } from "./azCliUtils.js";

export interface ArmpitCredentialOptions {
  tenantId?: TenantId,
  subscription?: SubscriptionIdOrName,
}

/**
 * Provides access tokens from the current Azure CLI invoker.
 * @remarks
 * This class is intended to be instantiated internally and exposed as a TokenCredential.
 * The implementation is similar to AzureCliCredential but using armpit invokers.
 */
export interface ArmpitCredential extends TokenCredential { }

export function buildCredential(invokers: AzCliInvokers, options?: ArmpitCredentialOptions): ArmpitCredential {
  const overrideTenantId = options?.tenantId;
  if (overrideTenantId && !isTenantId(overrideTenantId)) {
    throw new Error("Invalid tenant ID.");
  }

  const overrideSubscription = options?.subscription;
  if (overrideSubscription && !isSubscriptionIdOrName(overrideSubscription)) {
    throw new Error("Invalid subscription name or subscription ID.");
  }

  const getToken = async function(scopes: string | string[], options: GetTokenOptions = {}): Promise<AccessToken> {
    // This is loosely based on AzureCliCredential but uses the internals provided by this library

    if (typeof scopes === "string") {
      scopes = [scopes];
    }

    if (!scopes.every(isScope)) {
      throw new Error("Scopes are invalid");
    }

    const args: string[] = ["--scope", ...scopes];

    if (overrideTenantId) {
      args.push("--tenant", overrideTenantId);
    }

    if (overrideSubscription) {
      args.push("--subscription", overrideSubscription);
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

    return {
      token: result.accessToken,
      expiresOnTimestamp: expiresOn,
      tokenType,
    };
  }

  // A normal object is returned so libraries like tedious/mssql can be compatible.
  return {
    getToken
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
