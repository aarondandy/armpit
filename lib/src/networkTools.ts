import type {
  NetworkManagementClientOptionalParams,
  NetworkSecurityGroup,
  SecurityRule,
  VirtualNetwork,
  Subnet,
  Delegation,
  KnownSecurityRuleDirection,
  KnownSecurityRuleAccess,
  KnownSecurityRuleProtocol,
  KnownVirtualNetworkPrivateEndpointNetworkPolicies,
  KnownVirtualNetworkPrivateLinkServiceNetworkPolicies,
  KnownSharingScope,
  KnownPrivateEndpointVNetPolicies,
  PublicIPAddress,
  KnownIPAllocationMethod,
  KnownIPVersion,
  KnownPublicIPAddressSkuName,
  ApplicationSecurityGroup,
  SubResource as NetworkSubResource,
} from "@azure/arm-network";
import { NetworkManagementClient } from "@azure/arm-network";
import type {
  PrivateDnsManagementClientOptionalParams,
  PrivateZone,
  VirtualNetworkLink,
  KnownResolutionPolicy,
} from "@azure/arm-privatedns";
import { PrivateDnsManagementClient } from "@azure/arm-privatedns";
import { isArrayEqualUnordered, mergeAbortSignals } from "./tsUtils.js";
import {
  shallowMergeDefinedValues,
  shallowCloneDefinedValues,
  applyOptionsDifferencesShallow,
  applyArrayKeyedDescriptor,
  applyArrayIdDescriptors,
  applyOptionsDifferencesDeep,
} from "./optionsUtils.js";
import {
  type SubscriptionId,
  extractSubscriptionFromId,
  isResourceId,
  locationNameOrCodeEquals,
} from "./azureUtils.js";
import { handleGet, ManagementClientFactory } from "./azureSdkUtils.js";
import type { AzCliOptions, AzCliInvoker, AzCliTemplateFn } from "./azCliInvoker.js";

interface NetworkToolsOptions {
  groupName?: string | null;
  location?: string | null;
  subscriptionId?: SubscriptionId | null;
  abortSignal?: AbortSignal;
}

function splitNetworkOptionsAndDescriptor<T extends NetworkToolsOptions>(optionsDescriptor: T) {
  const { groupName, location, subscriptionId, abortSignal, ...rest } = optionsDescriptor;
  return {
    options: { groupName, location, subscriptionId, abortSignal } as NetworkToolsOptions,
    descriptor: rest,
  };
}

interface PrivateDnsToolsOptions {
  groupName?: string | null;
  subscriptionId?: SubscriptionId | null;
  abortSignal?: AbortSignal;
}

function splitPrivateDnsOptionsAndDescriptor<T extends PrivateDnsToolsOptions>(optionsDescriptor: T) {
  const { groupName, subscriptionId, abortSignal, ...rest } = optionsDescriptor;
  return {
    options: { groupName, subscriptionId, abortSignal } as PrivateDnsToolsOptions,
    descriptor: rest,
  };
}

interface PrivateZoneVnetLinkDescriptor {
  virtualNetwork: { id?: string } | string;
  registrationEnabled?: boolean;
  resolutionPolicy?: `${KnownResolutionPolicy}`;
}

type DelegationDescriptor = Pick<Delegation, "name" | "serviceName">;

interface SubnetDescriptor extends Pick<Subnet, "name" | "addressPrefix" | "addressPrefixes"> {
  // TODO: networkSecurityGroup
  // TODO: routeTable
  // TODO: serviceEndpoints, serviceEndpointPolicies
  // TODO: ipAllocations
  // TODO: ipamPoolPrefixAllocations
  delegations?: DelegationDescriptor | string | (DelegationDescriptor | string)[];
  networkSecurityGroup?: NetworkSubResource;
  natGateway?: NetworkSubResource;
  privateEndpointNetworkPolicies?: `${KnownVirtualNetworkPrivateEndpointNetworkPolicies}`;
  privateLinkServiceNetworkPolicies?: `${KnownVirtualNetworkPrivateLinkServiceNetworkPolicies}`;
  sharingScope?: `${KnownSharingScope}`;
  defaultOutboundAccess?: boolean;
}

interface VnetDescriptor extends Pick<VirtualNetwork, "flowTimeoutInMinutes"> {
  // TODO: dhcpOptions
  // TODO: virtualNetworkPeerings
  // TODO: enableDdosProtection, ddosProtectionPlan
  // TODO: enableVmProtection
  // TODO: bgpCommunities
  // TODO: encryption
  // TODO: ipAllocations
  addressSpace?: { addressPrefixes?: string[] };
  addressPrefix?: string;
  subnets?: SubnetDescriptor[];
  deleteUnknownSubnets?: boolean;
  privateEndpointVNetPolicies?: `${KnownPrivateEndpointVNetPolicies}`;
}

interface SecurityRuleDescriptor extends Omit<SecurityRule, "id" | "etag" | "type"> {
  priority: number;
  direction: `${KnownSecurityRuleDirection}`;
  access: `${KnownSecurityRuleAccess}`;
  protocol: `${KnownSecurityRuleProtocol}`;
}

interface NsgDescriptor {
  rules?: SecurityRuleDescriptor[];
  deleteUnknownRules?: boolean;
}

interface PublicIpDescriptor
  extends Pick<
    PublicIPAddress,
    "zones" | "dnsSettings" | "ddosSettings" | "ipAddress" | "publicIPPrefix" | "idleTimeoutInMinutes" | "deleteOption"
  > {
  servicePublicIPAddress?: NetworkSubResource;
  natGateway?: NetworkSubResource;
  linkedPublicIPAddress?: NetworkSubResource;
  publicIPAllocationMethod?: `${KnownIPAllocationMethod}`;
  publicIPAddressVersion?: `${KnownIPVersion}`;
  sku?: `${KnownPublicIPAddressSkuName}` | PublicIPAddress["sku"];
}

function pluralPropPairsAreEqual<T>(
  a: T | null | undefined,
  aMulti: T[] | null | undefined,
  b: T | null | undefined,
  bMulti: T[] | null | undefined,
  equals?: (a: T, b: T) => boolean,
) {
  equals ??= (a, b) => a == b;

  if (aMulti == null && bMulti == null) {
    if (a == null) {
      return b == null;
    }
    if (b == null) {
      return false;
    }

    return equals(a, b);
  }

  const aNormalized = [];
  if (aMulti != null) {
    aNormalized.push(...aMulti);
  }
  if (a != null && !aNormalized.includes(a)) {
    aNormalized.push(a);
  }

  const bNormalized = [];
  if (bMulti != null) {
    bNormalized.push(...bMulti);
  }
  if (b != null && !bNormalized.includes(b)) {
    bNormalized.push(b);
  }

  return isArrayEqualUnordered(aNormalized, bNormalized, equals);
}

function applyResourceIdProperty<TTarget>(target: TTarget, key: keyof TTarget, source?: { id?: string }) {
  if (source?.id != null && source.id != (target[key] as { id?: string })?.id) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (target as any)[key] = { id: source.id };
    return true;
  }

  return false;
}

export class NetworkTools {
  #invoker: AzCliInvoker;
  #managementClientFactory: ManagementClientFactory;
  #options: NetworkToolsOptions;

  constructor(
    dependencies: {
      invoker: AzCliInvoker;
      managementClientFactory: ManagementClientFactory;
    },
    options: NetworkToolsOptions,
  ) {
    this.#invoker = dependencies.invoker;
    this.#managementClientFactory = dependencies.managementClientFactory;
    this.#options = shallowCloneDefinedValues(options);
  }

  async asgGet(name: string, options?: NetworkToolsOptions): Promise<ApplicationSecurityGroup | null> {
    const { groupName, subscriptionId, abortSignal } = this.#buildMergedOptions(options);
    if (subscriptionId != null && groupName != null) {
      const client = this.getClient(subscriptionId);
      return await handleGet(client.applicationSecurityGroups.get(groupName, name, { abortSignal }));
    }

    const args = ["--name", name];
    if (groupName) {
      args.push("--resource-group", groupName);
    }

    return this.#getLaxInvokerFn(options)<NetworkSecurityGroup>`network asg show ${args}`;
  }

  async asgUpsert(name: string, options?: NetworkToolsOptions): Promise<ApplicationSecurityGroup> {
    const opContext = this.#buildMergedOptions(options);

    if (opContext.groupName == null) {
      throw new Error("A group name is required to perform NSG operations.");
    }

    let upsertRequired = false;
    let asg = await this.asgGet(name, options);

    let subscriptionId = opContext.subscriptionId;
    const location = opContext.location;

    if (asg) {
      subscriptionId ??= extractSubscriptionFromId(asg.id);

      if (location != null && asg.location != null && !locationNameOrCodeEquals(location, asg.location)) {
        throw new Error(`Specified location ${location} conflicts with existing ${asg.location}.`);
      }
    } else {
      if (location == null) {
        throw new Error("A location is required");
      }

      upsertRequired = true;
      asg = {
        name,
        location,
      };
    }

    if (upsertRequired) {
      const client = this.getClient(subscriptionId);
      asg = await client.applicationSecurityGroups.beginCreateOrUpdateAndWait(opContext.groupName, name, asg, {
        abortSignal: opContext.abortSignal,
      });
    }

    return asg;
  }

  async nsgGet(name: string, options?: NetworkToolsOptions): Promise<NetworkSecurityGroup | null> {
    const { groupName, subscriptionId, abortSignal } = this.#buildMergedOptions(options);
    if (subscriptionId != null && groupName != null) {
      const client = this.getClient(subscriptionId);
      return await handleGet(client.networkSecurityGroups.get(groupName, name, { abortSignal }));
    }

    const args = ["--name", name];
    if (groupName) {
      args.push("--resource-group", groupName);
    }

    return this.#getLaxInvokerFn(options)<NetworkSecurityGroup>`network nsg show ${args}`;
  }

  async nsgUpsert(
    name: string,
    descriptorOptions?: NsgDescriptor & NetworkToolsOptions,
  ): Promise<NetworkSecurityGroup> {
    const {
      options,
      descriptor: { rules, deleteUnknownRules, ...descriptorRest },
    } = descriptorOptions ? splitNetworkOptionsAndDescriptor(descriptorOptions) : { descriptor: {} };

    const opContext = this.#buildMergedOptions(options);

    if (opContext.groupName == null) {
      throw new Error("A group name is required to perform NSG operations.");
    }

    if (deleteUnknownRules && rules == null) {
      throw new Error("Rules must be explicitly described when deleting unknown rules is requested");
    }

    if (rules != null && rules.length > 0 && rules.some(r => r.access == null || (r.access as string) === "")) {
      throw new Error("All NSG rules must specify access explicitly.");
    }

    let upsertRequired = false;
    let nsg = await this.nsgGet(name, options);

    const nsgRulesNew = rules?.map(d => {
      const rule: SecurityRule = { ...d }; // a shallow clone should be safe enough
      if (!rule.protocol) {
        rule.protocol = "*";
      }

      if (!(rule.sourceAddressPrefix || rule.sourceAddressPrefixes || rule.sourceApplicationSecurityGroups)) {
        rule.sourceAddressPrefix = "*";
      }

      if (!(rule.sourcePortRange || rule.sourcePortRanges)) {
        rule.sourcePortRange = "*";
      }

      if (
        !(rule.destinationAddressPrefix || rule.destinationAddressPrefixes || rule.destinationApplicationSecurityGroups)
      ) {
        rule.destinationAddressPrefix = "*";
      }

      if (!(rule.destinationPortRange || rule.destinationPortRanges)) {
        rule.destinationPortRange = "*";
      }

      return rule;
    });

    function applySecurityRuleDifferences(target: SecurityRule, source: SecurityRule) {
      const {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        id: id,
        name: name,
        sourcePortRange,
        sourcePortRanges,
        destinationPortRange,
        destinationPortRanges,
        sourceAddressPrefix,
        sourceAddressPrefixes,
        destinationAddressPrefix,
        destinationAddressPrefixes,
        sourceApplicationSecurityGroups,
        destinationApplicationSecurityGroups,
        ...sourceRest
      } = source;

      let appliedChanges = false;

      if (target.name == null) {
        target.name = name;
        appliedChanges = true;
      }

      if (applyOptionsDifferencesShallow(target, sourceRest)) {
        appliedChanges = true;
      }

      if (
        !pluralPropPairsAreEqual(target.sourcePortRange, target.sourcePortRanges, sourcePortRange, sourcePortRanges)
      ) {
        target.sourcePortRange = sourcePortRange;
        target.sourcePortRanges = sourcePortRanges;
        appliedChanges = true;
      }

      if (
        !pluralPropPairsAreEqual(
          target.destinationPortRange,
          target.destinationPortRanges,
          destinationPortRange,
          destinationPortRanges,
        )
      ) {
        target.destinationPortRange = destinationPortRange;
        target.destinationPortRanges = destinationPortRanges;
        appliedChanges = true;
      }

      if (
        !pluralPropPairsAreEqual(
          target.sourceAddressPrefix,
          target.sourceAddressPrefixes,
          sourceAddressPrefix,
          sourceAddressPrefixes,
        )
      ) {
        target.sourceAddressPrefix = sourceAddressPrefix;
        target.sourceAddressPrefixes = sourceAddressPrefixes;
        appliedChanges = true;
      }

      if (
        !pluralPropPairsAreEqual(
          target.destinationAddressPrefix,
          target.destinationAddressPrefixes,
          destinationAddressPrefix,
          destinationAddressPrefixes,
        )
      ) {
        target.destinationAddressPrefix = destinationAddressPrefix;
        target.destinationAddressPrefixes = destinationAddressPrefixes;
        appliedChanges = true;
      }

      if (sourceApplicationSecurityGroups != null) {
        target.sourceApplicationSecurityGroups = [];
        if (applyArrayIdDescriptors(target.sourceApplicationSecurityGroups, sourceApplicationSecurityGroups)) {
          appliedChanges = true;
        }
      }

      if (destinationApplicationSecurityGroups != null) {
        target.destinationApplicationSecurityGroups = [];
        if (
          applyArrayIdDescriptors(target.destinationApplicationSecurityGroups, destinationApplicationSecurityGroups)
        ) {
          appliedChanges = true;
        }
      }

      return appliedChanges;
    }

    let subscriptionId = opContext.subscriptionId;
    const location = opContext.location;

    if (nsg) {
      subscriptionId ??= extractSubscriptionFromId(nsg.id);

      if (location != null && nsg.location != null && !locationNameOrCodeEquals(location, nsg.location)) {
        throw new Error(`Specified location ${location} conflicts with existing ${nsg.location}.`);
      }

      if (nsgRulesNew) {
        nsg.securityRules ??= [];
        if (
          applyArrayKeyedDescriptor(
            nsg.securityRules,
            nsgRulesNew,
            "name",
            applySecurityRuleDifferences,
            shallowCloneDefinedValues,
            {
              deleteUnmatchedTargets: deleteUnknownRules,
            },
          )
        ) {
          upsertRequired = true;
        }
      }

      if (applyOptionsDifferencesShallow(nsg, descriptorRest)) {
        upsertRequired = true;
      }
    } else {
      if (location == null) {
        throw new Error("A location is required");
      }

      upsertRequired = true;
      nsg = {
        name,
        location,
        securityRules: nsgRulesNew,
        ...descriptorRest,
      };
    }

    if (upsertRequired) {
      const client = this.getClient(subscriptionId);
      nsg = await client.networkSecurityGroups.beginCreateOrUpdateAndWait(opContext.groupName, name, nsg, {
        abortSignal: opContext.abortSignal,
      });
    }

    return nsg;
  }

  async pipGet(name: string, options?: NetworkToolsOptions): Promise<PublicIPAddress | null> {
    const { groupName, subscriptionId, abortSignal } = this.#buildMergedOptions(options);
    if (subscriptionId != null && groupName != null) {
      const client = this.getClient(subscriptionId);
      return await handleGet(client.publicIPAddresses.get(groupName, name, { abortSignal }));
    }

    const args = ["--name", name];
    if (groupName) {
      args.push("--resource-group", groupName);
    }

    return this.#getLaxInvokerFn(options)<PublicIPAddress>`network public-ip show ${args}`;
  }

  async pipUpsert(
    name: string,
    descriptorOptions?: PublicIpDescriptor & NetworkToolsOptions,
  ): Promise<PublicIPAddress> {
    const {
      options,
      descriptor: {
        sku,
        linkedPublicIPAddress,
        natGateway,
        publicIPPrefix,
        servicePublicIPAddress,
        zones,
        ...descriptorRest
      },
    } = descriptorOptions ? splitNetworkOptionsAndDescriptor(descriptorOptions) : { descriptor: {} };

    const opContext = this.#buildMergedOptions(options);

    if (opContext.groupName == null) {
      throw new Error("A group name is required to perform NSG operations.");
    }

    const skuDescriptor = typeof sku === "string" ? { name: sku } : sku;

    let upsertRequired = false;
    let pip = await this.pipGet(name, options);

    let subscriptionId = opContext.subscriptionId;
    const location = opContext.location;

    if (pip) {
      subscriptionId ??= extractSubscriptionFromId(pip.id);

      if (location != null && pip.location != null && !locationNameOrCodeEquals(location, pip.location)) {
        throw new Error(`Specified location ${location} conflicts with existing ${pip.location}.`);
      }

      if (skuDescriptor != null) {
        pip.sku ??= {};
        if (applyOptionsDifferencesDeep(pip.sku, skuDescriptor)) {
          upsertRequired = true;
        }
      }

      if (zones != null) {
        pip.zones ??= [];
        if (isArrayEqualUnordered(pip.zones, zones)) {
          pip.zones = [...zones];
          upsertRequired = true;
        }
      }

      if (applyResourceIdProperty(pip, "linkedPublicIPAddress", linkedPublicIPAddress)) {
        upsertRequired = true;
      }

      if (applyResourceIdProperty(pip, "servicePublicIPAddress", servicePublicIPAddress)) {
        upsertRequired = true;
      }

      if (applyResourceIdProperty(pip, "natGateway", natGateway)) {
        upsertRequired = true;
      }

      if (applyResourceIdProperty(pip, "publicIPPrefix", publicIPPrefix)) {
        upsertRequired = true;
      }

      if (applyOptionsDifferencesDeep(pip, descriptorRest)) {
        upsertRequired = true;
      }
    } else {
      if (location == null) {
        throw new Error("A location is required");
      }

      upsertRequired = true;
      pip = {
        name,
        sku: skuDescriptor,
        location,
        linkedPublicIPAddress,
        natGateway,
        publicIPPrefix,
        servicePublicIPAddress,
        zones,
        ...descriptorRest,
      };
    }

    if (upsertRequired) {
      const client = this.getClient(subscriptionId);
      pip = await client.publicIPAddresses.beginCreateOrUpdateAndWait(opContext.groupName, name, pip, {
        abortSignal: opContext.abortSignal,
      });
    }

    return pip;
  }

  async privateZoneGet(name: string, options?: PrivateDnsToolsOptions): Promise<PrivateZone | null> {
    const { groupName, subscriptionId, abortSignal } = this.#buildMergedOptions(options);
    if (subscriptionId != null && groupName != null) {
      const client = this.getPrivateDnsClient(subscriptionId);
      return await handleGet(client.privateZones.get(groupName, name, { abortSignal }));
    }

    const args = ["--name", name];
    if (groupName) {
      args.push("--resource-group", groupName);
    }

    return this.#getLaxInvokerFn(options)<PrivateZone>`network private-dns zone show ${args}`;
  }

  async privateZoneUpsert(name: string, options?: PrivateDnsToolsOptions): Promise<PrivateZone> {
    const { groupName, subscriptionId, abortSignal } = this.#buildMergedOptions(options);
    if (groupName == null) {
      throw new Error("A group name is required to perform DNS zone operations");
    }

    let zone = await this.privateZoneGet(name, options);
    if (zone == null) {
      const client = this.getPrivateDnsClient(subscriptionId);
      zone = await client.privateZones.beginCreateOrUpdateAndWait(
        groupName,
        name,
        { location: "global" },
        { abortSignal },
      );
    }

    return zone;
  }

  async privateZoneVnetLinkGet(zoneName: string, name: string, options?: NetworkToolsOptions) {
    const { groupName, subscriptionId, abortSignal } = this.#buildMergedOptions(options);
    if (subscriptionId != null && groupName != null) {
      const client = this.getPrivateDnsClient(subscriptionId);
      return await handleGet(client.virtualNetworkLinks.get(groupName, zoneName, name, { abortSignal }));
    }

    const args = ["--zone-name", zoneName, "--name", name];
    if (groupName) {
      args.push("--resource-group", groupName);
    }

    return this.#getLaxInvokerFn(options)<VirtualNetworkLink>`network private-dns link vnet show ${args}`;
  }

  async privateZoneVnetLinkUpsert(
    zoneName: string,
    name: string,
    descriptorOptions: PrivateZoneVnetLinkDescriptor & PrivateDnsToolsOptions,
  ) {
    const { options, descriptor } = splitPrivateDnsOptionsAndDescriptor(descriptorOptions);
    const { virtualNetwork, ...descriptorRest } = descriptor;

    const opContext = this.#buildMergedOptions(options);

    if (opContext.groupName == null) {
      throw new Error("A group name is required to perform DNS zone link operations");
    }

    let virtualNetworkId: string | undefined;
    if (isResourceId(virtualNetwork)) {
      virtualNetworkId = virtualNetwork;
    } else if (typeof virtualNetwork === "string") {
      const vnetMatch = await this.vnetGet(virtualNetwork, options);
      if (vnetMatch == null) {
        throw new Error(`Failed to find vnet '${virtualNetworkId}'`);
      }

      virtualNetworkId = vnetMatch.id;
    } else {
      virtualNetworkId = virtualNetwork.id;
    }

    let subscriptionId = opContext.subscriptionId;

    let upsertRequired = false;
    let link = await this.privateZoneVnetLinkGet(zoneName, name, options);
    if (link) {
      subscriptionId ??= extractSubscriptionFromId(link.id);

      if (virtualNetworkId != null && link.virtualNetwork?.id !== virtualNetworkId) {
        link.virtualNetwork = { id: virtualNetworkId };
        upsertRequired = true;
      }

      if (applyOptionsDifferencesShallow(link, descriptorRest as VirtualNetworkLink)) {
        upsertRequired = true;
      }
    } else {
      upsertRequired = true;
      link = {
        name,
        location: "global",
        virtualNetwork: { id: virtualNetworkId },
        ...descriptorRest,
      };
    }

    if (upsertRequired) {
      const client = this.getPrivateDnsClient(subscriptionId);
      link = await client.virtualNetworkLinks.beginCreateOrUpdateAndWait(opContext.groupName, zoneName, name, link, {
        abortSignal: opContext.abortSignal,
      });
    }

    return link;
  }

  async vnetGet(name: string, options?: NetworkToolsOptions): Promise<VirtualNetwork | null> {
    const { groupName, subscriptionId, abortSignal } = this.#buildMergedOptions(options);
    if (subscriptionId != null && groupName != null) {
      const client = this.getClient(subscriptionId);
      return await handleGet(client.virtualNetworks.get(groupName, name, { abortSignal }));
    }

    const args = ["--name", name];
    if (groupName) {
      args.push("--resource-group", groupName);
    }

    return this.#getLaxInvokerFn(options)<NetworkSecurityGroup>`network vnet show ${args}`;
  }

  async vnetUpsert(name: string, optionsDescriptor?: VnetDescriptor & NetworkToolsOptions): Promise<VirtualNetwork> {
    const {
      options,
      descriptor: { deleteUnknownSubnets, subnets, addressPrefix, addressSpace, ...descriptorRest },
    } = optionsDescriptor ? splitNetworkOptionsAndDescriptor(optionsDescriptor) : { descriptor: {} };
    const opContext = this.#buildMergedOptions(options);

    if (opContext.groupName == null) {
      throw new Error("A group name is required to perform network operations.");
    }

    let addressSpaceDescriptor: VnetDescriptor["addressSpace"];
    if (addressPrefix != null && addressSpace != null) {
      throw new Error("Can only specify one of addressPrefix or addressSpace");
    } else if (addressPrefix != null) {
      addressSpaceDescriptor = { addressPrefixes: [addressPrefix] };
    } else if (addressSpace != null) {
      addressSpaceDescriptor = addressSpace;
    } else {
      addressSpaceDescriptor = undefined;
    }

    let upsertRequired = false;
    let vnet = await this.vnetGet(name, options);

    const subnetsNew = subnets?.map(descriptor => {
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

      const { networkSecurityGroup, delegations, ...descriptorRest } = descriptor;

      const result = {
        ...descriptorRest,
      } as Subnet; // a shallow clone should be safe enough

      if (networkSecurityGroup) {
        result.networkSecurityGroup = { id: networkSecurityGroup.id };
      }

      if (delegations) {
        result.delegations = (Array.isArray(delegations) ? delegations : [delegations]).map(d =>
          typeof d === "string" ? { serviceName: d } : { ...d },
        );
        assignDelegateNames(result.delegations); // TODO: This should be done at the time of the assignment for best compatibility with existing data
      }

      return result;
    });

    function applySubnetDifferences(target: Subnet, source: Subnet) {
      const {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        id: id,
        name: name,
        addressPrefix,
        addressPrefixes,
        delegations,
        networkSecurityGroup,
        natGateway,
        ...sourceRest
      } = source;

      let appliedChanges = false;

      if (target.name == null) {
        target.name = name;
        appliedChanges = true;
      }

      if (applyOptionsDifferencesShallow(target, sourceRest)) {
        appliedChanges = true;
      }

      if (!pluralPropPairsAreEqual(target.addressPrefix, target.addressPrefixes, addressPrefix, addressPrefixes)) {
        target.addressPrefix = addressPrefix;
        target.addressPrefixes = addressPrefixes;
        appliedChanges = true;
      }

      if (delegations) {
        target.delegations ??= [];
        if (
          applyArrayKeyedDescriptor(
            target.delegations,
            delegations,
            "serviceName",
            applyOptionsDifferencesShallow,
            shallowCloneDefinedValues,
            {
              deleteUnmatchedTargets: deleteUnknownSubnets,
            },
          )
        ) {
          appliedChanges = true;
        }
      }

      if (networkSecurityGroup?.id != null && target.networkSecurityGroup?.id != networkSecurityGroup.id) {
        target.networkSecurityGroup = { id: networkSecurityGroup.id };
        appliedChanges = true;
      }

      if (natGateway?.id != null && target.natGateway?.id != natGateway.id) {
        target.natGateway = { id: natGateway.id };
        appliedChanges = true;
      }

      return appliedChanges;
    }

    let subscriptionId = opContext.subscriptionId;
    const location = opContext.location;

    if (vnet) {
      subscriptionId ??= extractSubscriptionFromId(vnet.id);

      if (location != null && vnet.location != null && !locationNameOrCodeEquals(location, vnet.location)) {
        throw new Error(`Specified location ${location} conflicts with existing ${vnet.location}.`);
      }

      if (addressSpaceDescriptor) {
        vnet.addressSpace ??= {};
        if (addressSpaceDescriptor.addressPrefixes != null) {
          vnet.addressSpace.addressPrefixes ??= [];
          if (!isArrayEqualUnordered(vnet.addressSpace.addressPrefixes, addressSpaceDescriptor.addressPrefixes)) {
            vnet.addressSpace.addressPrefixes = addressSpaceDescriptor.addressPrefixes;
            upsertRequired = true;
          }
        }
      }

      if (subnetsNew) {
        vnet.subnets ??= [];
        if (
          applyArrayKeyedDescriptor(
            vnet.subnets,
            subnetsNew,
            "name",
            applySubnetDifferences,
            shallowCloneDefinedValues,
            {
              deleteUnmatchedTargets: deleteUnknownSubnets,
            },
          )
        ) {
          upsertRequired = true;
        }
      }

      if (applyOptionsDifferencesShallow(vnet, descriptorRest)) {
        upsertRequired = true;
      }
    } else {
      if (location == null) {
        throw new Error("A location is required");
      }

      upsertRequired = true;
      vnet = {
        name,
        location,
        addressSpace: addressSpaceDescriptor,
        subnets: subnetsNew,
        ...descriptorRest,
      };
    }

    if (upsertRequired) {
      const client = this.getClient(subscriptionId);
      vnet = await client.virtualNetworks.beginCreateOrUpdateAndWait(opContext.groupName, name, vnet, {
        abortSignal: opContext.abortSignal,
      });
    }

    return vnet;
  }

  getClient(
    subscriptionId?: SubscriptionId | null,
    options?: NetworkManagementClientOptionalParams,
  ): NetworkManagementClient {
    return this.#managementClientFactory.get(
      NetworkManagementClient,
      (subscriptionId ?? this.#options.subscriptionId) as SubscriptionId,
      options,
    );
  }

  getPrivateDnsClient(
    subscriptionId?: SubscriptionId | null,
    options?: PrivateDnsManagementClientOptionalParams,
  ): PrivateDnsManagementClient {
    return this.#managementClientFactory.get(
      PrivateDnsManagementClient,
      (subscriptionId ?? this.#options.subscriptionId) as SubscriptionId,
      options,
    );
  }

  #buildMergedOptions(options?: NetworkToolsOptions | null) {
    if (options == null) {
      return this.#options;
    }

    const merged = shallowMergeDefinedValues(this.#options, options);

    const abortSignal = mergeAbortSignals(options.abortSignal, this.#options.abortSignal);
    if (abortSignal) {
      merged.abortSignal = abortSignal;
    }

    return merged;
  }

  #buildInvokerOptions(options?: NetworkToolsOptions | null): AzCliOptions {
    const mergedOptions = this.#buildMergedOptions(options);
    const result: AzCliOptions = {
      forceAzCommandPrefix: true,
      unwrapResults: true, // required for network create/update responses
    };
    if (mergedOptions.abortSignal != null) {
      result.abortSignal = mergedOptions.abortSignal;
    }

    if (mergedOptions.location != null) {
      result.defaultLocation = mergedOptions.location;
    }

    if (mergedOptions.groupName != null) {
      result.defaultResourceGroup = mergedOptions.groupName;
    }

    return result;
  }

  #getLaxInvokerFn(options?: NetworkToolsOptions): AzCliTemplateFn<null> {
    return this.#invoker({
      ...this.#buildInvokerOptions(options),
      allowBlanks: true,
    });
  }
}
