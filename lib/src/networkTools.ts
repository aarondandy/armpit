import type {
  NetworkManagementClientOptionalParams,
  NetworkSecurityGroup,
  SecurityRule,
  VirtualNetwork,
  Subnet,
  Delegation,
} from "@azure/arm-network";
import { NetworkManagementClient } from "@azure/arm-network";
import {
  isStringValueOrValueArrayEqual,
  isArrayEqualUnordered,
} from "./tsUtils.js";
import {
  type SubscriptionId,
  extractSubscriptionFromId,
  idsEquals,
} from "./azureUtils.js";
import { handleGet, ManagementClientFactory } from "./azureSdkUtils.js";
import { type AzCliInvoker } from "./azCliUtils.js";

interface CommonNetworkToolsOptions {
  groupName?: string | null,
  location?: string | null,
  subscriptionId?: SubscriptionId | null,
  abortSignal?: AbortSignal,
}

interface NetworkToolsConstructorOptions extends CommonNetworkToolsOptions {
}

type DelegationDescriptor = Pick<Delegation, "name" | "serviceName">;

interface SubnetDescriptor extends Pick<Subnet, "name" | "addressPrefix" | "networkSecurityGroup"> {
  delegations?: DelegationDescriptor | string | (DelegationDescriptor | string)[],
}

function assignDelegateNames(delegations: Delegation[]) {
  for (let index = 0; index < delegations.length; index++) {
    const delegation = delegations[index];
    if (delegation.name == null || delegation.name === "") {
      delegation.name = findNextAvailableNumberName(index);
    }
  }

  function findNextAvailableNumberName(index: number) {
    for (; ; index++) {
      const nameCandidate = index.toString();
      if (!delegations.some(d => d.name === nameCandidate)) {
        return nameCandidate;
      }
    }
  }
}

function isDelegationEqual(a: Delegation, b: Delegation) {
  if (a == null) {
    return b == null;
  }

  if (b == null) {
    return false;
  }

  return a.name === b.name && a.serviceName === b.serviceName;
}

function isSubnetEqual(a: Subnet, b: Subnet) {
  if (a == null) {
    return b == null;
  }

  if (b == null) {
    return false;
  }

  if (
    a.name != b.name
    || a.networkSecurityGroup?.id !== b.networkSecurityGroup?.id
  ) {
    return false;
  }

  if (!isStringValueOrValueArrayEqual(a.addressPrefix ?? a.addressPrefixes, b.addressPrefix ?? b.addressPrefixes)) {
    return false;
  }

  if (!isArrayEqualUnordered(a.delegations ?? [], b.delegations ?? [], isDelegationEqual)) {
    return false;
  }

  return true;
}

interface VnetUpsertOptions extends CommonNetworkToolsOptions {
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

function isNsgAccessType(access: unknown): access is SecurityRuleDescriptor["access"] {
  return access === "Allow" || access === "Deny";
}

function assignMissingRequiredSecurityRuleOptions(rule: SecurityRule) {
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

function isSecurityRuleEqual(a: SecurityRule, b: SecurityRule) {
  if (a == null) {
    return b == null;
  }

  if (b == null) {
    return false;
  }

  if (
    a.name != b.name
    || a.description != b.description
    || a.protocol !== b.protocol
    || a.access !== b.access
    || a.priority !== b.priority
    || a.direction !== b.direction
  ) {
    return false;
  }

  if (!isStringValueOrValueArrayEqual(a.sourcePortRange ?? a.sourcePortRanges, b.sourcePortRange ?? b.sourcePortRanges)) {
    return false;
  }

  if (!isStringValueOrValueArrayEqual(a.destinationPortRange ?? a.destinationPortRanges, b.destinationPortRange ?? b.destinationPortRanges)) {
    return false;
  }

  if (!isStringValueOrValueArrayEqual(a.sourceAddressPrefix ?? a.sourceAddressPrefixes, b.sourceAddressPrefix ?? b.sourceAddressPrefixes)) {
    return false;
  }

  if (!isStringValueOrValueArrayEqual(a.destinationAddressPrefix ?? a.destinationAddressPrefixes, b.destinationAddressPrefix ?? b.destinationAddressPrefixes)) {
    return false;
  }

  if (!idsEquals(a.sourceApplicationSecurityGroups, b.sourceApplicationSecurityGroups, true)) {
    return false;
  }

  if (!idsEquals(a.destinationApplicationSecurityGroups, b.destinationApplicationSecurityGroups, true)) {
    return false;
  }

  return true;
}

interface NsgUpsertOptions extends CommonNetworkToolsOptions {
  rules?: SecurityRuleDescriptor[],
  deleteUnknownRules?: boolean,
}

export class NetworkTools {
  #invoker: AzCliInvoker;
  #managementClientFactory: ManagementClientFactory;
  #options: NetworkToolsConstructorOptions;

  constructor(
    dependencies: {
      invoker: AzCliInvoker;
      managementClientFactory: ManagementClientFactory
    },
    options: NetworkToolsConstructorOptions
  ) {
    this.#invoker = dependencies.invoker;
    this.#managementClientFactory = dependencies.managementClientFactory;
    this.#options = options;
  }

  async vnetGet(name: string, options?: CommonNetworkToolsOptions): Promise<VirtualNetwork | null> {
    const { groupName, subscriptionId, abortSignal } = this.#getResourceContext(options);
    if (subscriptionId != null && groupName != null) {
      const client = this.getClient(subscriptionId);
      return await handleGet(client.virtualNetworks.get(groupName, name, {abortSignal}));
    }

    abortSignal?.throwIfAborted();
    return this.#invoker.lax<NetworkSecurityGroup>`network nsg show --name ${name}`;
  }

  async vnetUpsert(name: string, options?: VnetUpsertOptions): Promise<VirtualNetwork> {
    let { groupName, subscriptionId, location, abortSignal } = this.#getResourceContext(options);
    if (groupName == null) {
      throw new Error("A group name is required to perform network operations.")
    }

    let upsertRequired = false;
    let vnet = await this.vnetGet(name, options);

    let desiredSubnets = options?.subnets?.map(descriptor => {
      let {
        delegations,
        networkSecurityGroup,
        ...descriptorRest
      } = descriptor;

      let result = {
        ...descriptorRest,
      } as Subnet; // a shallow clone should be safe enough

      if (networkSecurityGroup) {
        result.networkSecurityGroup = { id: networkSecurityGroup.id };
      }

      if (delegations) {
        if (!Array.isArray(delegations)) {
          delegations = [delegations];
        }

        result.delegations = delegations.map(d => typeof d === "string" ? { serviceName: d } : { ...d });
        assignDelegateNames(result.delegations);
      }

      return result;
    });

    if (vnet) {
      subscriptionId ??= extractSubscriptionFromId(vnet.id);

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
            existingIndex = existingSubnets.findIndex(e => isStringValueOrValueArrayEqual(e.addressPrefix ?? e.addressPrefixes, desired.addressPrefix));
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

        if (!isArrayEqualUnordered(vnet.subnets ?? [], upsertSubnets, isSubnetEqual)) {
          upsertRequired = true;
          vnet.subnets = upsertSubnets;
        }
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

      if (desiredSubnets && desiredSubnets.length > 0) {
        vnet.subnets = desiredSubnets;
      }

    }

    if (upsertRequired) {
      const client = this.getClient(subscriptionId);
      vnet = await client.virtualNetworks.beginCreateOrUpdateAndWait(
        groupName,
        name,
        vnet,
        {abortSignal}
      );
    }

    return vnet;
  }

  async nsgGet(name: string, options?: CommonNetworkToolsOptions): Promise<NetworkSecurityGroup | null> {
    const { groupName, subscriptionId, abortSignal } = this.#getResourceContext(options);
    if (subscriptionId != null && groupName != null) {
      const client = this.getClient(subscriptionId);
      return await handleGet(client.networkSecurityGroups.get(groupName, name, {abortSignal}));
    }

    abortSignal?.throwIfAborted();
    return this.#invoker.lax<NetworkSecurityGroup>`network nsg show --name ${name}`;
  }

  async nsgUpsert(name: string, options?: NsgUpsertOptions): Promise<NetworkSecurityGroup> {
    let { groupName, subscriptionId, location, abortSignal } = this.#getResourceContext(options);
    if (groupName == null) {
      throw new Error("A group name is required to perform NSG operations.");
    }

    if (options && options.deleteUnknownRules && options.rules == null) {
      throw new Error("Rules must be explicitly described when deleting unknown rules is requested");
    }

    let desiredRules = options?.rules?.map(d => {
      const result = { ...d }; // a shallow clone should be safe enough
      assignMissingRequiredSecurityRuleOptions(result);
      return result as SecurityRule;
    });

    if (desiredRules && desiredRules.length > 0 && desiredRules.some(r => !isNsgAccessType(r.access))) {
      throw new Error("All NSG rules must specify access explicitly.");
    }

    let upsertRequired = false;
    let nsg = await this.nsgGet(name, options);
    if (nsg) {
      subscriptionId ??= extractSubscriptionFromId(nsg.id);

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

        if (!isArrayEqualUnordered(nsg.securityRules ?? [], upsertRules, isSecurityRuleEqual)) {
          upsertRequired = true;
          nsg.securityRules = upsertRules;
        }
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
        nsg,
        {abortSignal}
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

  #getResourceContext(options?: CommonNetworkToolsOptions | null) {
    return {
      groupName: options?.groupName ?? this.#options.groupName ?? null,
      subscriptionId: options?.subscriptionId ?? this.#options.subscriptionId ?? null,
      location: options?.location ?? this.#options.location ?? null,
      abortSignal: options?.abortSignal ?? this.#options.abortSignal,
    }
  }
}
