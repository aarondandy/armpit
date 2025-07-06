import type {
  NetworkManagementClientOptionalParams,
  NetworkSecurityGroup,
  SecurityRule,
  VirtualNetwork,
  Subnet,
} from "@azure/arm-network";
import { NetworkManagementClient } from "@azure/arm-network";
import { type SubscriptionId, extractSubscriptionId } from "./azureUtils.js";
import { handleGet, ManagementClientFactory } from "./azureSdkUtils.js";
import { type AzCliInvoker } from "./azCliUtils.js";

interface CommonNetworkOptions {
  groupName?: string | null,
  location?: string | null,
  subscriptionId?: SubscriptionId | null,
}

interface SubnetDescriptor extends Pick<Subnet, "name" | "addressPrefix" | "networkSecurityGroup" | "delegations"> {
}

function subnetAddressPrefixIsEqual(subnet: Pick<Subnet, "addressPrefix" | "addressPrefixes">, addressPrefix?: string | null) {
  if (subnet.addressPrefix != null) {
    return subnet.addressPrefix === addressPrefix;
  }

  if (subnet.addressPrefixes) {
    if (subnet.addressPrefixes.length === 1) {
      return subnet.addressPrefixes[0] === addressPrefix;
    }

    if (subnet.addressPrefixes.length > 1) {
      return false;
    }
  }

  return addressPrefix == null;
}

interface VnetUpsertOptions extends CommonNetworkOptions {
  addressPrefix?: string,
  subnets?: SubnetDescriptor[],
  deleteUnknownSubnets?: boolean,
}

interface SecurityRuleDescriptor extends Omit<SecurityRule, "etag" | "type" | "provisioningState"> {
  direction: "Inbound" | "Outbound",
  priority: number,
  access: "Allow" | "Deny",
  protocol: "Tcp" | "Udp" | "Icmp" | "Esp" | "*" | "Ah",
};

function isNsgAccessType(access: SecurityRuleDescriptor["access"]) {
  return access === "Allow" || access === "Deny";
}

function ensureDefaultNsgRuleOptionsSet(rule: SecurityRule) {
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

interface NsgUpsertOptions extends CommonNetworkOptions {
  rules?: SecurityRuleDescriptor[],
  deleteUnknownRules?: boolean,
}

export class NetworkTools {
  #invoker: AzCliInvoker;
  #managementClientFactory: ManagementClientFactory;
  #options: CommonNetworkOptions;

  constructor(invoker: AzCliInvoker, managementClientFactory: ManagementClientFactory, options: CommonNetworkOptions) {
    this.#invoker = invoker;
    this.#managementClientFactory = managementClientFactory;
    this.#options = options;
  }

  async vnetGet(name: string, options?: CommonNetworkOptions): Promise<VirtualNetwork | null> {
    const { groupName, subscriptionId } = this.#getResourceContext(options);
    if (subscriptionId != null && groupName != null) {
      const client = this.getClient(subscriptionId);
      return await handleGet(client.virtualNetworks.get(groupName, name));
    }

    return this.#invoker.lax<NetworkSecurityGroup>`network nsg show --name ${name}`;
  }

  async vnetUpsert(name: string, options?: VnetUpsertOptions): Promise<VirtualNetwork> {
    let { groupName, subscriptionId, location } = this.#getResourceContext(options);
    if (groupName == null) {
      throw new Error("A group name is required to perform network operations.")
    }

    let desiredSubnets = options?.subnets?.map(s => {
      let result = {
        ...s,
      }; // a shallow clone should be safe enough

      if (result.networkSecurityGroup) {
        result.networkSecurityGroup = { id: result.networkSecurityGroup.id };
      }

      return result;
    });

    let upsertRequired = false;
    let vnet = await this.vnetGet(name, options);
    if (vnet) {
      subscriptionId ??= extractSubscriptionId(vnet.id);

      if (location != null && vnet.location != null && location !== vnet.location) {
        throw new Error(`Specified location ${location} conflicts with existing ${vnet.location}.`);
      }

      if (options?.addressPrefix) {
        vnet.addressSpace ??= { };
        vnet.addressSpace.addressPrefixes ??= [];

        if (vnet.addressSpace.addressPrefixes.length > 2) {
          throw new Error("Multiple address space prefixes are not supported");
        }

        if (vnet.addressSpace.addressPrefixes.length !== 1 || vnet.addressSpace.addressPrefixes[0] !== options.addressPrefix) {
          upsertRequired = true;
          vnet.addressSpace.addressPrefixes = [options.addressPrefix];
        }
      }

      if (desiredSubnets != null) {
        let existingSubnets = vnet.subnets == null ? [] : [... vnet.subnets];
        let upsertSubnets: Subnet[] = [];

        for (let desiredIndex = 0; desiredIndex < desiredSubnets.length; ) {
          const desired = desiredSubnets[desiredIndex];
          let existingIndex = existingSubnets.findIndex(e => e.name === desired.name);
          if (existingIndex < 0 && desired.addressPrefix != null) {
            existingIndex = existingSubnets.findIndex(e => subnetAddressPrefixIsEqual(e, desired.addressPrefix));
          }

          const existing = existingIndex >= 0 ? existingSubnets[existingIndex] : null;
          if (existing == null) {
            desiredIndex++;
          } else {
            desiredSubnets.splice(desiredIndex, 1);
            existingSubnets.splice(existingIndex, 1);
            upsertSubnets.push({
              ...existing,
              ...desired,
              etag: existing.etag,
              type: existing.type,
            });
          }
        }

        if (options?.deleteUnknownSubnets !== true && existingSubnets.length > 0) {
          // preserve unmatched existing
          upsertSubnets.push(...existingSubnets);
        }

        if (desiredSubnets.length > 0) {
          // unmatched new rules
          upsertSubnets.push(...desiredSubnets);
        }

        // TODO: implement a no-op when no modifications are required between nsg.subnets and upsertSubnets
        upsertRequired = true;
        vnet.subnets = upsertSubnets;
      }

    } else {
      upsertRequired = true;
      vnet = {
        name,
      };

      if (location) {
        vnet.location = location;
      }

      if (options?.addressPrefix) {
        vnet.addressSpace = {
          addressPrefixes: [options.addressPrefix]
        }
      }

      if (options?.subnets) {
        vnet.subnets = options.subnets;
      }

    }

    if (upsertRequired) {
      const client = this.getClient(subscriptionId);
      vnet = await client.virtualNetworks.beginCreateOrUpdateAndWait(
        groupName,
        name,
        vnet
      );
    }

    return vnet;
  }

  async nsgGet(name: string, options?: CommonNetworkOptions): Promise<NetworkSecurityGroup | null> {
    const { groupName, subscriptionId } = this.#getResourceContext(options);
    if (subscriptionId != null && groupName != null) {
      const client = this.getClient(subscriptionId);
      return await handleGet(client.networkSecurityGroups.get(groupName, name));
    }

    return this.#invoker.lax<NetworkSecurityGroup>`network nsg show --name ${name}`;
  }

  async nsgUpsert(name: string, options?: NsgUpsertOptions): Promise<NetworkSecurityGroup> {
    let { groupName, subscriptionId, location } = this.#getResourceContext(options);
    if (groupName == null) {
      throw new Error("A group name is required to perform NSG operations.")
    }

    if (options && options.deleteUnknownRules && options.rules == null) {
      throw new Error("Rules must be explicitly described when deleting unknown rules is requested");
    }

    let desiredRules = options?.rules?.map(d => {
      const result = { ...d }; // a shallow clone should be safe enough
      ensureDefaultNsgRuleOptionsSet(result);
      return result;
    });

    if (desiredRules && desiredRules.length > 0 && desiredRules.some(r => !isNsgAccessType(r.access))) {
      throw new Error("All NSG rules must specify access explicitly.");
    }

    let upsertRequired = false;
    let nsg = await this.nsgGet(name, options);
    if (nsg) {
      subscriptionId ??= extractSubscriptionId(nsg.id);

      if (location != null && nsg.location != null && location !== nsg.location) {
        throw new Error(`Specified location ${location} conflicts with existing ${nsg.location}.`);
      }

      if (desiredRules) {
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
              ...existing,
              ...desired,
              etag: existing.etag,
              type: existing.type,
            });
          }
        }

        if (options?.deleteUnknownRules !== true && existingRules.length > 0) {
          // preserve unmatched existing rules
          upsertRules.push(...existingRules);
        }

        if (desiredRules.length > 0) {
          // unmatched new rules
          upsertRules.push(...desiredRules);
        }

        // TODO: implement a no-op when no modifications are required between nsg.securityRules and upsertRules
        upsertRequired = true;
        nsg.securityRules = upsertRules;
      }

    } else {
      upsertRequired = true;
      nsg = {
        name,
      }

      if (location) {
        nsg.location = location;
      }

      if (desiredRules) {
        nsg.securityRules = desiredRules;
      }

    }

    if (upsertRequired) {
      const client = this.getClient(subscriptionId);
      nsg = await client.networkSecurityGroups.beginCreateOrUpdateAndWait(
        groupName,
        name,
        nsg
      );
    }

    return nsg;
  }

  getClient(subscriptionId?: SubscriptionId | null, options?: NetworkManagementClientOptionalParams): NetworkManagementClient {
    return this.#managementClientFactory.get(
      NetworkManagementClient,
      (subscriptionId ?? this.#options.subscriptionId) as SubscriptionId,
      options);
  }

  #getResourceContext(options?: CommonNetworkOptions | null) {
    return {
      groupName: options?.groupName ?? this.#options.groupName ?? null,
      subscriptionId: options?.subscriptionId ?? this.#options.subscriptionId ?? null,
      location: options?.location ?? this.#options.location ?? null,
    }
  }
}
