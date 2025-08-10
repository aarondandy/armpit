import type {
  ComputeManagementClientOptionalParams,
  DataDisk,
  Disk,
  KnownVirtualMachineEvictionPolicyTypes,
  KnownVirtualMachinePriorityTypes,
  OSDisk,
  VirtualMachine,
  VirtualMachineIdentity,
  VirtualMachineNetworkInterfaceConfiguration,
  VirtualMachineNetworkInterfaceIPConfiguration,
} from "@azure/arm-compute";
import { ComputeManagementClient } from "@azure/arm-compute";
import { mergeAbortSignals } from "./tsUtils.js";
import {
  shallowCloneDefinedValues,
  shallowMergeDefinedValues,
  ApplyContext,
  applySourceToTargetObjectWithTemplate,
  wrapPropObjectApply,
  applyUnorderedValueArrayProp,
  createKeyedArrayPropApplyFn,
  applyResourceRefProperty,
  applySourceToTargetObject,
  applyResourceRefListProperty,
  applyOrderedValueArrayProp,
} from "./optionsUtils.js";
import { type SubscriptionId, applyManagedServiceIdentity, locationNameOrCodeEquals } from "./azureUtils.js";
import { ManagementClientFactory, handleGet } from "./azureSdkUtils.js";

interface ComputeToolsOptions {
  groupName?: string | null;
  location?: string | null;
  subscriptionId?: SubscriptionId | null;
  abortSignal?: AbortSignal;
}

function splitComputeOptionsAndDescriptor<T extends ComputeToolsOptions>(optionsDescriptor: T) {
  const { groupName, location, subscriptionId, abortSignal, ...rest } = optionsDescriptor;
  return {
    options: { groupName, location, subscriptionId, abortSignal } as ComputeToolsOptions,
    descriptor: rest,
  };
}

type UserAssignedIdentitiesValueDescriptor = object;
interface VirtualMachineIdentityDescriptor extends Pick<VirtualMachineIdentity, "type"> {
  userAssignedIdentities?: {
    [propertyName: string]: UserAssignedIdentitiesValueDescriptor;
  };
}

interface DiskDescriptor
  extends Omit<
    Disk,
    | "id"
    | "name"
    | "location"
    | "type"
    | "managedBy"
    | "managedByExtended"
    | "timeCreated"
    | "diskSizeBytes"
    | "uniqueId"
    | "provisioningState"
    | "diskState"
    | "shareInfo"
    | "burstingEnabledTime"
    | "propertyUpdatesInProgress"
    | "lastOwnershipUpdateTime"
    | "sku"
    | "creationData"
  > {
  sku?: Omit<Disk["sku"], "tier">;
  creationData?: Omit<Disk["creationData"], "sourceUniqueId">;
}

function applyDisk(target: Disk, source: DiskDescriptor, context?: ApplyContext) {
  return applySourceToTargetObjectWithTemplate(target, source, {}, context);
}

function applyVmOsDisk(target: OSDisk, source: OSDisk, context?: ApplyContext) {
  return applySourceToTargetObjectWithTemplate(target, source, {}, context);
}

function applyVmDataDisk(target: DataDisk, source: DataDisk, context?: ApplyContext) {
  const { lun, ...rest } = source;

  if (lun != null) {
    if (target.lun == null) {
      target.lun = lun;
    } else if (target.lun !== lun) {
      throw new Error("Mismatch of 'lun' property when applying a data disk descriptor");
    }
  }

  return applySourceToTargetObjectWithTemplate(target, rest, {}, context);
}

function applyVmNicIpConfig(
  target: VirtualMachineNetworkInterfaceIPConfiguration,
  source: VirtualMachineNetworkInterfaceIPConfiguration,
  context?: ApplyContext,
) {
  return applySourceToTargetObjectWithTemplate(
    target,
    source,
    {
      applicationSecurityGroups: applyResourceRefListProperty,
      applicationGatewayBackendAddressPools: applyResourceRefListProperty,
      loadBalancerBackendAddressPools: applyResourceRefProperty,
      publicIPAddressConfiguration: {
        publicIPPrefix: applyResourceRefProperty,
      },
      subnet: applyResourceRefProperty,
    },
    context,
  );
}

function applyVmNicConfig(
  target: VirtualMachineNetworkInterfaceConfiguration,
  source: VirtualMachineNetworkInterfaceConfiguration,
  context?: ApplyContext,
) {
  return applySourceToTargetObjectWithTemplate(
    target,
    source,
    {
      dnsSettings: {
        dnsServers: applyOrderedValueArrayProp,
      },
      dscpConfiguration: applyResourceRefProperty,
      ipConfigurations: createKeyedArrayPropApplyFn("name", applyVmNicIpConfig, true, true),
      networkSecurityGroup: applyResourceRefProperty,
    },
    context,
  );
}

interface VirtualMachineDescriptor
  extends Omit<
    VirtualMachine,
    | "id"
    | "name"
    | "type"
    | "etag"
    | "location"
    | "tags"
    | "resources"
    | "managedBy"
    | "provisioningState"
    | "instanceView"
    | "vmId"
    | "timeCreated"
    | "evictionPolicy"
    | "identity"
    | "priority"
  > {
  evictionPolicy?: `${KnownVirtualMachineEvictionPolicyTypes}`;
  identity?: VirtualMachineIdentityDescriptor;
  priority?: `${KnownVirtualMachinePriorityTypes}`;
}

function applyVm(target: VirtualMachine, source: VirtualMachineDescriptor, context?: ApplyContext) {
  let appliedChanges = false;
  if (
    applySourceToTargetObjectWithTemplate(
      target,
      source,
      {
        applicationProfile: {
          galleryApplications: createKeyedArrayPropApplyFn("packageReferenceId", applySourceToTargetObject, true, true),
        },
        availabilitySet: applyResourceRefProperty,
        capacityReservation: {
          capacityReservationGroup: applyResourceRefProperty,
        },
        host: applyResourceRefProperty,
        hostGroup: applyResourceRefProperty,
        identity: wrapPropObjectApply(applyManagedServiceIdentity),
        placement: {
          includeZones: applyUnorderedValueArrayProp,
          excludeZones: applyUnorderedValueArrayProp,
        },
        proximityPlacementGroup: applyResourceRefProperty,
        networkProfile: {
          networkInterfaceConfigurations: createKeyedArrayPropApplyFn("name", applyVmNicConfig, true, true),
          networkInterfaces: createKeyedArrayPropApplyFn("id", applySourceToTargetObject, true, true),
        },
        securityProfile: applyResourceRefProperty,
        storageProfile: {
          dataDisks: createKeyedArrayPropApplyFn("lun", applyVmDataDisk, true, true),
          osDisk: wrapPropObjectApply(applyVmOsDisk),
        },
        virtualMachineScaleSet: applyResourceRefProperty,
        zones: applyUnorderedValueArrayProp,
      },
      context,
    )
  ) {
    appliedChanges = true;
  }

  return appliedChanges;
}

export class ComputeTools {
  #managementClientFactory: ManagementClientFactory;
  #options: ComputeToolsOptions;

  constructor(
    dependencies: {
      managementClientFactory: ManagementClientFactory;
    },
    options: ComputeToolsOptions,
  ) {
    this.#managementClientFactory = dependencies.managementClientFactory;
    this.#options = shallowCloneDefinedValues(options);
  }

  async diskGet(name: string, options?: ComputeToolsOptions): Promise<Disk | null> {
    const { groupName, subscriptionId, abortSignal } = this.#buildMergedOptions(options);

    if (groupName == null) {
      throw new Error("A group name is required to perform operations.");
    }

    const client = this.getClient(subscriptionId);
    return await handleGet(client.disks.get(groupName, name, { abortSignal }));
  }

  async diskUpsert(name: string, optionsDescriptor: DiskDescriptor & ComputeToolsOptions): Promise<Disk> {
    const { options, descriptor } = splitComputeOptionsAndDescriptor(optionsDescriptor);
    const { location, groupName, subscriptionId, abortSignal } = this.#buildMergedOptions(options);

    if (groupName == null) {
      throw new Error("A group name is required to perform operations.");
    }

    let upsertRequired = false;

    const client = this.getClient(subscriptionId);

    let disk = await handleGet(client.disks.get(groupName, name, { abortSignal }));
    if (disk) {
      if (location != null && disk.location != null && !locationNameOrCodeEquals(location, disk.location)) {
        throw new Error(`Specified location ${location} conflicts with existing ${disk.location}.`);
      }
    } else {
      if (location == null) {
        throw new Error("A location is required");
      }

      upsertRequired = true;
      disk = { location };
    }

    if (applyDisk(disk, descriptor)) {
      upsertRequired = true;
    }

    if (upsertRequired) {
      disk = await client.disks.beginCreateOrUpdateAndWait(groupName, name, disk, {
        abortSignal: abortSignal,
      });
    }

    return disk;
  }

  async vmGet(name: string, options?: ComputeToolsOptions): Promise<VirtualMachine | null> {
    const { groupName, subscriptionId, abortSignal } = this.#buildMergedOptions(options);

    if (groupName == null) {
      throw new Error("A group name is required to perform operations.");
    }

    const client = this.getClient(subscriptionId);
    return await handleGet(client.virtualMachines.get(groupName, name, { abortSignal }));
  }

  async vmUpsert(
    name: string,
    optionsDescriptor: VirtualMachineDescriptor & ComputeToolsOptions,
  ): Promise<VirtualMachine> {
    const { options, descriptor } = splitComputeOptionsAndDescriptor(optionsDescriptor);
    const { location, groupName, subscriptionId, abortSignal } = this.#buildMergedOptions(options);

    if (groupName == null) {
      throw new Error("A group name is required to perform operations.");
    }

    let upsertRequired = false;

    const client = this.getClient(subscriptionId);

    let vm = await handleGet(client.virtualMachines.get(groupName, name, { abortSignal: abortSignal }));
    if (vm) {
      if (location != null && vm.location != null && !locationNameOrCodeEquals(location, vm.location)) {
        throw new Error(`Specified location ${location} conflicts with existing ${vm.location}.`);
      }
    } else {
      if (location == null) {
        throw new Error("A location is required");
      }

      upsertRequired = true;
      vm = { location };
    }

    if (applyVm(vm, descriptor)) {
      upsertRequired = true;
    }

    if (upsertRequired) {
      vm = await client.virtualMachines.beginCreateOrUpdateAndWait(groupName, name, vm, {
        abortSignal: abortSignal,
      });
    }

    return vm;
  }

  getClient(
    subscriptionId?: SubscriptionId | null,
    options?: ComputeManagementClientOptionalParams,
  ): ComputeManagementClient {
    return this.#managementClientFactory.get(
      ComputeManagementClient,
      (subscriptionId ?? this.#options.subscriptionId) as SubscriptionId,
      options,
    );
  }

  #buildMergedOptions(options?: ComputeToolsOptions | null) {
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
}
