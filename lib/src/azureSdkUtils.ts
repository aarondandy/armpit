import type { TokenCredential } from "@azure/core-auth";
import { ServiceClient, ServiceClientOptions } from "@azure/core-client";
import { isRestError } from "@azure/core-rest-pipeline";
import { isSubscriptionId, SubscriptionId } from "./azureUtils.js";
import { ArmpitCliCredentialFactory } from "./armpitCredential.js";

export async function handleGet<T>(promise: Promise<T>) : Promise<T | null> {
  try {
    return await promise;
  } catch (error) {
    if (isRestError(error) && error.statusCode === 404) {
      return null;
    }

    throw error;
  }
}

type ServiceClientLike = Pick<ServiceClient, "sendRequest" | "sendOperationRequest">;

export interface SubscriptionBoundServiceClientConstructor<TClient extends ServiceClientLike> {
  new (
    credentials: TokenCredential,
    subscriptionId: string,
    options?: ServiceClientOptions,
  ): TClient;
}

export class ManagementClientFactory {
  #credentialFactory: ArmpitCliCredentialFactory;
  #cache: { constructor: SubscriptionBoundServiceClientConstructor<ServiceClientLike>, subscriptionId: SubscriptionId, options?: ServiceClientOptions, instance: ServiceClientLike }[] = [];

  constructor(credentialFactory: ArmpitCliCredentialFactory) {
    this.#credentialFactory = credentialFactory;
  }

  get<TClient extends ServiceClientLike>(constructor: SubscriptionBoundServiceClientConstructor<TClient>, subscriptionId: SubscriptionId, options?: ServiceClientOptions): TClient {
    if (subscriptionId == null) {
      throw new Error("Subscription ID is required.")
    } else if (!isSubscriptionId(subscriptionId)) {
      throw new Error("Subscription ID is not valid.");
    }

    const optionsKey = options == null ? null : JSON.stringify(options);
    const match = this.#cache.find(e =>
      e.constructor === constructor
      && e.subscriptionId === subscriptionId
      && (e.options == null ? optionsKey == null : JSON.stringify(e.options) === optionsKey ));
    if (match) {
      return match.instance as TClient;
    }

    const credential = this.#credentialFactory.getCredential({ subscription: subscriptionId });
    const instance = new constructor(credential, subscriptionId, options);

    this.#cache.push({ constructor, subscriptionId, options, instance });

    return instance;
  }
}
