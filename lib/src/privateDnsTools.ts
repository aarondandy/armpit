import type {
  PrivateDnsManagementClientOptionalParams,
  PrivateZone,
} from "@azure/arm-privatedns";
import { PrivateDnsManagementClient } from "@azure/arm-privatedns";
import {
  type SubscriptionId,
} from "./azureUtils.js";
import { handleGet, ManagementClientFactory } from "./azureSdkUtils.js";
import { type AzCliInvoker } from "./azCliUtils.js";

interface CommonPrivateDnsOptions {
  groupName?: string | null,
  subscriptionId?: SubscriptionId | null,
}

interface PrivateZoneUpsertOptions extends CommonPrivateDnsOptions {
}

export class PrivateDnsTools {
  #invoker: AzCliInvoker;
  #managementClientFactory: ManagementClientFactory;
  #options: CommonPrivateDnsOptions;

  constructor(invoker: AzCliInvoker, managementClientFactory: ManagementClientFactory, options: CommonPrivateDnsOptions) {
    this.#invoker = invoker;
    this.#managementClientFactory = managementClientFactory;
    this.#options = options;
  }

  async zoneGet(name: string, options?: CommonPrivateDnsOptions): Promise<PrivateZone | null> {
    const { groupName, subscriptionId } = this.#getResourceContext(options);
    if (subscriptionId != null && groupName != null) {
      const client = this.getClient(subscriptionId);
      return await handleGet(client.privateZones.get(groupName, name));
    }

    if (groupName) {
      return this.#invoker.lax<PrivateZone>`network private-dns zone show --name ${name} --group-name ${groupName}`;
    } else {
      return this.#invoker.lax<PrivateZone>`network private-dns zone show --name ${name}`;
    }
  }

  async zoneUpsert(name: string, options?: PrivateZoneUpsertOptions): Promise<PrivateZone> {
    let { groupName, subscriptionId } = this.#getResourceContext(options);
    if (groupName == null) {
      throw new Error("A group name is required to perform DNS zone operations");
    }

    let zone = await this.zoneGet(name, options);
    if (zone == null) {
      const client = this.getClient(subscriptionId);
      zone = await client.privateZones.beginCreateOrUpdateAndWait(
        groupName,
        name,
        {
          location: "Global"
        }
      );
    }

    return zone;
  }

  getClient(subscriptionId?: SubscriptionId | null, options?: PrivateDnsManagementClientOptionalParams): PrivateDnsManagementClient {
    return this.#managementClientFactory.get(
      PrivateDnsManagementClient,
      (subscriptionId ?? this.#options.subscriptionId) as SubscriptionId,
      options);
  }

  #getResourceContext(options?: CommonPrivateDnsOptions | null) {
    return {
      groupName: options?.groupName ?? this.#options.groupName ?? null,
      subscriptionId: options?.subscriptionId ?? this.#options.subscriptionId ?? null,
    }
  }
}
