import { NetworkManagementClient, NetworkManagementClientOptionalParams, NetworkSecurityGroup, SecurityRule } from "@azure/arm-network";
import { type SubscriptionId } from "./azureUtils.js";
import { handleGet, ManagementClientFactory } from "./azureSdkUtils.js";

interface SecurityRuleDescriptor extends Omit<SecurityRule, "etag" | "type" | "provisioningState"> {
  direction: "Inbound" | "Outbound",
  priority: number,
  access: "Allow" | "Deny",
  protocol: "Tcp" | "Udp" | "Icmp" | "Esp" | "*" | "Ah",
};

function isAccessType(access: SecurityRuleDescriptor["access"]) {
  return access === "Allow" || access === "Deny";
}

function ensureDefaultRuleOptionsSet(rule: SecurityRule) {
  if (!rule.protocol) {
    rule.protocol = "*";
  }

  if (!rule.sourceAddressPrefix && !rule.sourceAddressPrefixes && !rule.sourceApplicationSecurityGroups) {
    rule.sourceAddressPrefix = "*";
  }

  if (!rule.sourcePortRange && !rule.sourcePortRanges) {
    rule.sourcePortRange = "*";
  }

  if (!rule.destinationAddressPrefix && !rule.destinationAddressPrefixes && !rule.destinationApplicationSecurityGroups) {
    rule.destinationAddressPrefix = "*";
  }

  if (!rule.destinationPortRange && !rule.destinationPortRanges) {
    rule.destinationPortRange = "*";
  }
}

interface NsgUpsertOptions {
  rules?: SecurityRuleDescriptor[],
  deleteUnknownRules?: boolean,
  groupName?: string,
  location?: string,
}

interface NetworkToolsOptions {
  subscriptionId?: string | null,
  groupName?: string | null,
  location?: string | null,
}

export class NetworkTools {
  #options: NetworkToolsOptions;
  #managementClientFactory: ManagementClientFactory;

  constructor(managementClientFactory: ManagementClientFactory, options: NetworkToolsOptions) {
    this.#managementClientFactory = managementClientFactory;
    this.#options = options;
  }

  getClient(subscriptionId?: SubscriptionId, options?: NetworkManagementClientOptionalParams): NetworkManagementClient {
    return this.#managementClientFactory.get(
      NetworkManagementClient,
      (subscriptionId ?? this.#options.subscriptionId) as SubscriptionId,
      options);
  }

  async upsertNsg(name: string, options?: NsgUpsertOptions): Promise<NetworkSecurityGroup> {
    const groupName = options?.groupName ?? this.#options.groupName;
    if (groupName == null) {
      throw new Error("A group name is required to perform NSG operations.")
    }

    if (options && options.deleteUnknownRules && options.rules == null) {
      throw new Error("Rules must be explicitly described when deleting unknown rules is requested");
    }

    let desiredRules = options?.rules?.map(d => {
      const result = { ...d };
      ensureDefaultRuleOptionsSet(result);
      return result;
    }) ?? [];

    if (desiredRules.length > 0 && desiredRules.some(r => !isAccessType(r.access))) {
      throw new Error("All NSG rules must specify access explicitly.");
    }

    const client = this.getClient();

    let nsg = await handleGet(client.networkSecurityGroups.get(groupName, name));

    if (!nsg) {
      nsg = {
        name,
        securityRules: desiredRules,
      }

      if (options?.location) {
        nsg.location = options.location;
      } else if (this.#options.location) {
        nsg.location = this.#options.location;
      }

    } else {
      let existingRules = nsg.securityRules == null ? [] : [... nsg.securityRules];
      let upsertRules: SecurityRule[] = [];

      for (let desiredIndex = 0; desiredIndex < desiredRules.length; ) {
        const desired = desiredRules[desiredIndex];
        const existingIndex = existingRules.findIndex(e => e.name === desired.name && e.direction === desired.direction);
        const existing = existingIndex >= 0 ? existingRules[existingIndex] : null;
        if (existing == null) {
          desiredIndex++;
        } else {
          desiredRules.splice(desiredIndex, 1);
          existingRules.splice(existingIndex, 1);
          upsertRules.push({
            ...desired,
            etag: existing.etag,
            type: existing.type,
          });
        }
      }

      // TODO: implement a no-op when no modifications are required

      if (!(options?.deleteUnknownRules)) {
        upsertRules.push(...existingRules);
      }

      upsertRules.push(...desiredRules);

      nsg.securityRules = upsertRules;
    }

    nsg = await client.networkSecurityGroups.beginCreateOrUpdateAndWait(
      groupName,
      name,
      nsg
    );
    return nsg;
  }
}
