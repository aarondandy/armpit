import type {
  NetworkManagementClientOptionalParams,
  NetworkSecurityGroup,
  SecurityRule,
  VirtualNetwork,
  VirtualNetworkBgpCommunities,
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
  NatGateway,
  KnownNatGatewaySkuName,
  NetworkInterface,
  KnownNetworkInterfaceNicType,
  KnownNetworkInterfaceAuxiliaryMode,
  KnownNetworkInterfaceAuxiliarySku,
  NetworkInterfaceIPConfiguration,
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
  applySourceToTargetObjectWithTemplate,
  createKeyedArrayPropApplyFn,
  applyResourceRefProperty,
  applyResourceRefListProperty,
  type ApplyContext,
  applyUnorderedValueArrayProp,
  applySourceToTargetObject,
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

function applyPrivateZoneVnetLink(
  target: VirtualNetworkLink,
  source: PrivateZoneVnetLinkDescriptor,
  context?: ApplyContext,
) {
  return applySourceToTargetObjectWithTemplate(
    target,
    source,
    {
      virtualNetwork: applyResourceRefProperty,
    },
    context,
  );
}

type DelegationDescriptor = Pick<Delegation, "name" | "serviceName">;

function applyDelegation(target: Delegation, source: DelegationDescriptor, context?: ApplyContext) {
  const { serviceName, ...rest } = source;
  let appliedChanges = false;

  if (serviceName != null) {
    if (target.serviceName == null) {
      target.serviceName = serviceName;
    } else if (target.serviceName !== serviceName) {
      throw new Error("Service name mismatch");
    }
  }

  if (applySourceToTargetObject(target, rest, context)) {
    appliedChanges = true;
  }
  return appliedChanges;
}

interface SubnetDescriptor extends Pick<Subnet, "name" | "addressPrefix" | "addressPrefixes"> {
  // TODO: serviceEndpoints, serviceEndpointPolicies
  // TODO: ipamPoolPrefixAllocations
  defaultOutboundAccess?: boolean;
  delegations?: DelegationDescriptor | string | (DelegationDescriptor | string)[];
  ipAllocations?: NetworkSubResource[];
  natGateway?: NetworkSubResource;
  networkSecurityGroup?: NetworkSubResource;
  privateEndpointNetworkPolicies?: `${KnownVirtualNetworkPrivateEndpointNetworkPolicies}`;
  privateLinkServiceNetworkPolicies?: `${KnownVirtualNetworkPrivateLinkServiceNetworkPolicies}`;
  routeTable?: NetworkSubResource;
  sharingScope?: `${KnownSharingScope}`;
}

function applySubnet(target: Subnet, source: SubnetDescriptor, context?: ApplyContext) {
  const { name, addressPrefix, addressPrefixes, delegations: givenDelegations, ...rest } = source;

  let appliedChanges = false;
  if (target.name == null) {
    target.name = name;
    appliedChanges = true;
  } else if (target.name !== name) {
    throw new Error("Name mismatch");
  }

  if (!pluralPropPairsAreEqual(target.addressPrefix, target.addressPrefixes, addressPrefix, addressPrefixes)) {
    target.addressPrefix = addressPrefix;
    target.addressPrefixes = addressPrefixes;
    appliedChanges = true;
  }

  let delegationDescriptors: DelegationDescriptor[] | undefined;
  if (givenDelegations != null) {
    delegationDescriptors = (Array.isArray(givenDelegations) ? givenDelegations : [givenDelegations]).map(d =>
      typeof d === "string" ? { serviceName: d } : { ...d },
    );

    function assignDelegateNames(delegations: DelegationDescriptor[]) {
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

    assignDelegateNames(delegationDescriptors);
  }

  if (
    applySourceToTargetObjectWithTemplate(
      target,
      {
        delegations: delegationDescriptors,
        ...rest,
      },
      {
        delegations: createKeyedArrayPropApplyFn("serviceName", applyDelegation, true, true),
        ipAllocations: applyResourceRefListProperty,
        natGateway: applyResourceRefProperty,
        networkSecurityGroup: applyResourceRefProperty,
        routeTable: applyResourceRefProperty,
      },
      context,
    )
  ) {
    appliedChanges = true;
  }

  return appliedChanges;
}

interface VnetDescriptor
  extends Pick<
    VirtualNetwork,
    | "flowTimeoutInMinutes"
    | "dhcpOptions"
    | "enableDdosProtection"
    | "enableVmProtection"
    | "ddosProtectionPlan"
    | "encryption"
    | "ipAllocations"
  > {
  // TODO: virtualNetworkPeerings
  addressSpace?: { addressPrefixes?: string[] };
  addressPrefix?: string;
  bgpCommunities?: Pick<VirtualNetworkBgpCommunities, "virtualNetworkCommunity">;
  privateEndpointVNetPolicies?: `${KnownPrivateEndpointVNetPolicies}`;
  subnets?: SubnetDescriptor[];
}

interface VnetDescriptorWithOptions extends VnetDescriptor {
  deleteUnknownSubnets?: boolean;
}

function applyVnet(target: VirtualNetwork, source: VnetDescriptorWithOptions, context?: ApplyContext) {
  const { deleteUnknownSubnets, addressPrefix, addressSpace, ...descriptorRest } = source;
  let appliedChanges = false;

  let addressSpaceDescriptor: VnetDescriptor["addressSpace"] | undefined;
  if (addressPrefix != null && addressSpace != null) {
    throw new Error("Can only specify one of addressPrefix or addressSpace");
  } else if (addressPrefix != null) {
    addressSpaceDescriptor = { addressPrefixes: [addressPrefix] };
  } else if (addressSpace != null) {
    addressSpaceDescriptor = addressSpace;
  }

  if (addressSpaceDescriptor != null) {
    if (target.addressSpace == null) {
      target.addressSpace = {};
      appliedChanges = true;
    }

    if (addressSpaceDescriptor.addressPrefixes != null) {
      if (applyUnorderedValueArrayProp(target.addressSpace, addressSpaceDescriptor, "addressPrefixes")) {
        appliedChanges = true;
      }
    }
  }

  if (
    applySourceToTargetObjectWithTemplate(
      target,
      descriptorRest,
      {
        ddosProtectionPlan: applyResourceRefProperty,
        dhcpOptions: {
          dnsServers: applyUnorderedValueArrayProp,
        },
        ipAllocations: applyResourceRefListProperty,
        subnets: createKeyedArrayPropApplyFn("name", applySubnet, true, !!deleteUnknownSubnets),
      },
      context,
    )
  ) {
    appliedChanges = true;
  }

  return appliedChanges;
}

interface SecurityRuleDescriptor extends Omit<SecurityRule, "id" | "etag" | "type" | "provisioningState"> {
  priority: number;
  direction: `${KnownSecurityRuleDirection}`;
  access: `${KnownSecurityRuleAccess}`;
  protocol: `${KnownSecurityRuleProtocol}`;
}

function applySecurityRule(target: SecurityRule, source: SecurityRuleDescriptor, context?: ApplyContext) {
  const {
    name,
    sourcePortRange,
    sourcePortRanges,
    destinationPortRange,
    destinationPortRanges,
    sourceAddressPrefix,
    sourceAddressPrefixes,
    destinationAddressPrefix,
    destinationAddressPrefixes,
    ...rest
  } = source;

  let appliedChanges = false;
  if (target.name == null) {
    target.name = name;
    appliedChanges = true;
  } else if (target.name !== name) {
    throw new Error("Name mismatch");
  }

  if (!pluralPropPairsAreEqual(target.sourcePortRange, target.sourcePortRanges, sourcePortRange, sourcePortRanges)) {
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

  if (
    applySourceToTargetObjectWithTemplate(
      target,
      rest,
      {
        sourceApplicationSecurityGroups: applyResourceRefListProperty,
        destinationApplicationSecurityGroups: applyResourceRefListProperty,
      },
      context,
    )
  ) {
    appliedChanges = true;
  }

  return appliedChanges;
}

interface NsgDescriptor {
  securityRules?: SecurityRuleDescriptor[];
}

function applyNsg(nsg: NetworkSecurityGroup, givenDescriptor: NsgDescriptorWithOptions, context?: ApplyContext) {
  const { deleteUnknownRules, securityRules: givenDescriptorRules, ...givenDescriptorRest } = givenDescriptor;

  const rulesToApply = givenDescriptorRules?.map(d => {
    const rule = { ...d }; // a shallow clone should be safe enough
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

    return rule as SecurityRuleDescriptor;
  });

  return applySourceToTargetObjectWithTemplate(
    nsg,
    {
      securityRules: rulesToApply,
      ...givenDescriptorRest,
    },
    {
      securityRules: createKeyedArrayPropApplyFn("name", applySecurityRule, true, !!deleteUnknownRules),
    },
    context,
  );
}

function applyNameOrSkuObjectProperty<
  TTargetItem extends { name?: string },
  TTarget extends { [K in TKey]?: TTargetItem },
  TSource extends { [K in TKey]?: string | { name?: string } },
  TKey extends keyof TSource,
>(target: TTarget, source: TSource, key: TKey, context?: ApplyContext) {
  const sourceSkuValue = source[key] as string | undefined | { name: string };
  const sourceSku = typeof sourceSkuValue === "string" ? { name: sourceSkuValue } : sourceSkuValue;
  let updated = false;

  if (sourceSku == null) {
    return updated;
  }

  let targetSku = target[key] as TTargetItem;
  if (targetSku == null) {
    targetSku = { name: sourceSku.name } as TTargetItem;
    target[key] = targetSku as TTarget[TKey];
    updated = true;
  }

  if (applySourceToTargetObject(targetSku, sourceSku, context)) {
    updated = true;
  }

  return updated;
}

interface NsgDescriptorWithOptions extends NsgDescriptor {
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

function applyPip(pip: PublicIPAddress, descriptor: PublicIpDescriptor, context?: ApplyContext) {
  return applySourceToTargetObjectWithTemplate(
    pip,
    descriptor,
    {
      linkedPublicIPAddress: applyResourceRefProperty,
      natGateway: applyResourceRefProperty,
      publicIPPrefix: applyResourceRefProperty,
      servicePublicIPAddress: applyResourceRefProperty,
      sku: applyNameOrSkuObjectProperty,
      zones: applyUnorderedValueArrayProp,
    },
    context,
  );
}

interface NatGatewayDescriptor
  extends Pick<
    NatGateway,
    | "zones"
    | "idleTimeoutInMinutes"
    | "publicIpAddresses"
    | "publicIpAddressesV6"
    | "publicIpPrefixes"
    | "publicIpPrefixesV6"
    | "sourceVirtualNetwork"
  > {
  sku: `${KnownNatGatewaySkuName}` | NatGateway["sku"];
}

function applyNatGateway(nat: NatGateway, descriptor: NatGatewayDescriptor, context?: ApplyContext) {
  return applySourceToTargetObjectWithTemplate(
    nat,
    descriptor,
    {
      publicIpAddresses: applyResourceRefListProperty,
      publicIpAddressesV6: applyResourceRefListProperty,
      publicIpPrefixes: applyResourceRefListProperty,
      publicIpPrefixesV6: applyResourceRefListProperty,
      sku: applyNameOrSkuObjectProperty,
      sourceVirtualNetwork: applyResourceRefProperty,
      zones: applyUnorderedValueArrayProp,
    },
    context,
  );
}

interface NetworkInterfaceIPConfigurationDescriptor
  extends Omit<
    NetworkInterfaceIPConfiguration,
    | "id"
    | "etag"
    | "type"
    | "privateIPAllocationMethod"
    | "privateIPAddressVersion"
    | "provisioningState"
    | "privateLinkConnectionProperties"
  > {
  privateIPAllocationMethod?: `${KnownIPAllocationMethod}`;
  privateIPAddressVersion?: `${KnownIPVersion}`;
}

function applyIpConfiguration(
  target: NetworkInterfaceIPConfiguration,
  source: NetworkInterfaceIPConfigurationDescriptor,
  context?: ApplyContext,
) {
  return applySourceToTargetObjectWithTemplate(
    target,
    source,
    {
      gatewayLoadBalancer: applyResourceRefProperty,
      subnet: applyResourceRefProperty,
      publicIPAddress: applyResourceRefProperty,
      virtualNetworkTaps: applyResourceRefListProperty,
      applicationGatewayBackendAddressPools: applyResourceRefListProperty,
      loadBalancerBackendAddressPools: applyResourceRefListProperty,
      loadBalancerInboundNatRules: applyResourceRefListProperty,
      applicationSecurityGroups: applyResourceRefListProperty,
    },
    context,
  );
}

interface NetworkInterfaceDescriptor
  extends Pick<
    NetworkInterface,
    "enableAcceleratedNetworking" | "disableTcpStateTracking" | "enableIPForwarding" | "workloadType"
  > {
  networkSecurityGroup?: NetworkSubResource;
  nicType?: `${KnownNetworkInterfaceNicType}`;
  auxiliaryMode?: `${KnownNetworkInterfaceAuxiliaryMode}`;
  auxiliarySku?: `${KnownNetworkInterfaceAuxiliarySku}`;
  ipConfigurations: NetworkInterfaceIPConfigurationDescriptor[];
}

function applyNetworkInterface(nic: NetworkInterface, descriptor: NetworkInterfaceDescriptor) {
  return applySourceToTargetObjectWithTemplate(nic, descriptor, {
    networkSecurityGroup: applyResourceRefProperty,
    ipConfigurations: createKeyedArrayPropApplyFn("name", applyIpConfiguration, true, true),
  });
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

  async natGatewayGet(name: string, options?: NetworkToolsOptions): Promise<NatGateway | null> {
    const { groupName, subscriptionId, abortSignal } = this.#buildMergedOptions(options);
    if (subscriptionId != null && groupName != null) {
      const client = this.getClient(subscriptionId);
      return await handleGet(client.natGateways.get(groupName, name, { abortSignal }));
    }

    const args = ["--name", name];
    if (groupName) {
      args.push("--resource-group", groupName);
    }

    return this.#getLaxInvokerFn(options)<NatGateway>`network nat gateway show ${args}`;
  }

  async natGatewayUpsert(
    name: string,
    descriptorOptions: NatGatewayDescriptor & NetworkToolsOptions,
  ): Promise<NatGateway> {
    const { options, descriptor } = splitNetworkOptionsAndDescriptor(descriptorOptions);

    const opContext = this.#buildMergedOptions(options);

    if (opContext.groupName == null) {
      throw new Error("A group name is required to perform NSG operations.");
    }

    let upsertRequired = false;
    let nat = await this.natGatewayGet(name, options);

    let subscriptionId = opContext.subscriptionId;
    const location = opContext.location;

    if (nat) {
      subscriptionId ??= extractSubscriptionFromId(nat.id);

      if (location != null && nat.location != null && !locationNameOrCodeEquals(location, nat.location)) {
        throw new Error(`Specified location ${location} conflicts with existing ${nat.location}.`);
      }
    } else {
      if (location == null) {
        throw new Error("A location is required");
      }

      upsertRequired = true;
      nat = {
        name,
        location,
      };
    }

    if (applyNatGateway(nat, descriptor)) {
      upsertRequired = true;
    }

    if (upsertRequired) {
      const client = this.getClient(subscriptionId);
      nat = await client.natGateways.beginCreateOrUpdateAndWait(opContext.groupName, name, nat, {
        abortSignal: opContext.abortSignal,
      });
    }

    return nat;
  }

  async nicGet(name: string, options?: NetworkToolsOptions): Promise<NetworkInterface | null> {
    const { groupName, subscriptionId, abortSignal } = this.#buildMergedOptions(options);
    if (subscriptionId != null && groupName != null) {
      const client = this.getClient(subscriptionId);
      return await handleGet(client.networkInterfaces.get(groupName, name, { abortSignal }));
    }

    const args = ["--name", name];
    if (groupName) {
      args.push("--resource-group", groupName);
    }

    return await this.#getLaxInvokerFn(options)<NetworkInterface>`network nic show ${args}`;
  }

  async nicUpsert(
    name: string,
    descriptorOptions: NetworkInterfaceDescriptor & NetworkToolsOptions,
  ): Promise<NetworkInterface> {
    const { options, descriptor } = splitNetworkOptionsAndDescriptor(descriptorOptions);

    const opContext = this.#buildMergedOptions(options);

    if (opContext.groupName == null) {
      throw new Error("A group name is required to perform NSG operations.");
    }

    let upsertRequired = false;
    let nic = await this.nicGet(name, options);

    let subscriptionId = opContext.subscriptionId;
    const location = opContext.location;

    if (nic) {
      subscriptionId ??= extractSubscriptionFromId(nic.id);

      if (location != null && nic.location != null && !locationNameOrCodeEquals(location, nic.location)) {
        throw new Error(`Specified location ${location} conflicts with existing ${nic.location}.`);
      }
    } else {
      if (location == null) {
        throw new Error("A location is required");
      }

      upsertRequired = true;
      nic = {
        name,
        location,
      };
    }

    if (applyNetworkInterface(nic, descriptor)) {
      upsertRequired = true;
    }

    if (upsertRequired) {
      const client = this.getClient(subscriptionId);
      nic = await client.networkInterfaces.beginCreateOrUpdateAndWait(opContext.groupName, name, nic, {
        abortSignal: opContext.abortSignal,
      });
    }

    return nic;
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

    return await this.#getLaxInvokerFn(options)<NetworkSecurityGroup>`network nsg show ${args}`;
  }

  async nsgUpsert(
    name: string,
    descriptorOptions?: NsgDescriptorWithOptions & NetworkToolsOptions,
  ): Promise<NetworkSecurityGroup> {
    const { options, descriptor } = descriptorOptions
      ? splitNetworkOptionsAndDescriptor(descriptorOptions)
      : { descriptor: {} };

    const opContext = this.#buildMergedOptions(options);

    if (opContext.groupName == null) {
      throw new Error("A group name is required to perform NSG operations.");
    }

    if (descriptor?.deleteUnknownRules && descriptor?.securityRules == null) {
      throw new Error("Rules must be explicitly described when deleting unknown rules is requested");
    }

    if (
      descriptor?.securityRules != null &&
      descriptor.securityRules.length > 0 &&
      descriptor.securityRules.some(r => r.access == null || (r.access as string) === "")
    ) {
      throw new Error("All NSG rules descriptors must specify access explicitly.");
    }

    let upsertRequired = false;
    let nsg = await this.nsgGet(name, options);

    let subscriptionId = opContext.subscriptionId;
    const location = opContext.location;

    if (nsg) {
      subscriptionId ??= extractSubscriptionFromId(nsg.id);

      if (location != null && nsg.location != null && !locationNameOrCodeEquals(location, nsg.location)) {
        throw new Error(`Specified location ${location} conflicts with existing ${nsg.location}.`);
      }
    } else {
      if (location == null) {
        throw new Error("A location is required");
      }

      upsertRequired = true;
      nsg = {
        name,
        location,
      };
    }

    if (applyNsg(nsg, descriptor)) {
      upsertRequired = true;
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
    const { options, descriptor } = descriptorOptions
      ? splitNetworkOptionsAndDescriptor(descriptorOptions)
      : { descriptor: {} };

    const opContext = this.#buildMergedOptions(options);

    if (opContext.groupName == null) {
      throw new Error("A group name is required to perform NSG operations.");
    }

    let upsertRequired = false;
    let pip = await this.pipGet(name, options);

    let subscriptionId = opContext.subscriptionId;
    const location = opContext.location;

    if (pip) {
      subscriptionId ??= extractSubscriptionFromId(pip.id);

      if (location != null && pip.location != null && !locationNameOrCodeEquals(location, pip.location)) {
        throw new Error(`Specified location ${location} conflicts with existing ${pip.location}.`);
      }
    } else {
      if (location == null) {
        throw new Error("A location is required");
      }

      upsertRequired = true;
      pip = {
        name,
        location,
      };
    }

    if (applyPip(pip, descriptor)) {
      upsertRequired = true;
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
    const {
      options,
      descriptor: { virtualNetwork: givenDescriptorVnet, ...givenDescriptorRest },
    } = splitPrivateDnsOptionsAndDescriptor(descriptorOptions);

    const opContext = this.#buildMergedOptions(options);

    if (opContext.groupName == null) {
      throw new Error("A group name is required to perform DNS zone link operations");
    }

    // Attempt to resolve vnet name to an ID before the upsert
    let descriptorVnetRef: { id?: string };
    if (givenDescriptorVnet == null) {
      throw new Error("A virtual network is required");
    } else if (isResourceId(givenDescriptorVnet)) {
      descriptorVnetRef = { id: givenDescriptorVnet };
    } else if (typeof givenDescriptorVnet === "string") {
      const vnetMatch = await this.vnetGet(givenDescriptorVnet, options);
      if (vnetMatch == null) {
        throw new Error(`Failed to find vnet '${givenDescriptorVnet}'`);
      }

      descriptorVnetRef = { id: vnetMatch.id };
    } else {
      descriptorVnetRef = { id: givenDescriptorVnet.id };
    }

    let subscriptionId = opContext.subscriptionId;
    let upsertRequired = false;

    let link = await this.privateZoneVnetLinkGet(zoneName, name, options);
    if (link) {
      subscriptionId ??= extractSubscriptionFromId(link.id);
    } else {
      upsertRequired = true;
      link = {
        name,
        location: "global",
      };
    }

    if (applyPrivateZoneVnetLink(link, { virtualNetwork: descriptorVnetRef, ...givenDescriptorRest })) {
      upsertRequired = true;
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

  async vnetUpsert(
    name: string,
    optionsDescriptor?: VnetDescriptorWithOptions & NetworkToolsOptions,
  ): Promise<VirtualNetwork> {
    const { options, descriptor } = optionsDescriptor
      ? splitNetworkOptionsAndDescriptor(optionsDescriptor)
      : { descriptor: {} };
    const opContext = this.#buildMergedOptions(options);

    if (opContext.groupName == null) {
      throw new Error("A group name is required to perform network operations.");
    }

    let upsertRequired = false;
    let subscriptionId = opContext.subscriptionId;
    const location = opContext.location;

    let vnet = await this.vnetGet(name, options);
    if (vnet) {
      subscriptionId ??= extractSubscriptionFromId(vnet.id);

      if (location != null && vnet.location != null && !locationNameOrCodeEquals(location, vnet.location)) {
        throw new Error(`Specified location ${location} conflicts with existing ${vnet.location}.`);
      }
    } else {
      if (location == null) {
        throw new Error("A location is required");
      }

      upsertRequired = true;
      vnet = { name, location };
    }

    if (applyVnet(vnet, descriptor)) {
      upsertRequired = true;
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
