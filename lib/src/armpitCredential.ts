import type { AccessToken, TokenCredential, GetTokenOptions } from "@azure/identity";
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

export class ArmpitCredential implements TokenCredential {
  #invokers: AzCliInvokers;
  #overrideTenantId?: TenantId;
  #overrideSubscription?: SubscriptionIdOrName;

  constructor(invokers: AzCliInvokers, options?: ArmpitCredentialOptions) {
    this.#invokers = invokers;
    this.#overrideTenantId = options?.tenantId;
    if (this.#overrideTenantId && !isTenantId(this.#overrideTenantId)) {
      throw new Error("Invalid tenant ID.");
    }

    this.#overrideSubscription = options?.subscription;
    if (this.#overrideSubscription && !isSubscriptionIdOrName(this.#overrideSubscription)) {
      throw new Error("Invalid subscription name or subscription ID.");
    }
  }

  async getToken(scopes: string | string[], options: GetTokenOptions = {}): Promise<AccessToken> {
    // This is loosely based on AzureCliCredential but uses the internals provided by this library

    if (typeof scopes === "string") {
      scopes = [scopes];
    }

    if (!scopes.every(isScope)) {
      throw new Error("Scopes are invalid");
    }

    const args: string[] = ["--scope", ...scopes];

    if (this.#overrideTenantId) {
      args.push("--tenant", this.#overrideTenantId);
    }

    if (this.#overrideSubscription) {
      args.push("--subscription", this.#overrideSubscription);
    }

    const result = await this.#invokers.strict<AzCliAccessToken>`account get-access-token ${args}`;

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
}

export interface ArmpitCredentialProvider {
  getCredential(options?: ArmpitCredentialOptions): ArmpitCredential;
}
