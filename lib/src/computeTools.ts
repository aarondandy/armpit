import type { ComputeManagementClientOptionalParams, VirtualMachine } from "@azure/arm-compute";
import { ComputeManagementClient } from "@azure/arm-compute";
import { mergeAbortSignals, isArrayEqual } from "./tsUtils.js";
import {
  shallowCloneDefinedValues,
  shallowMergeDefinedValues,
  applyOptionsDifferencesShallow,
  applyOptionsDifferencesDeep,
  applyObjectKeyProperties,
  applyArrayKeyedDescriptor,
} from "./optionsUtils.js";
import { type SubscriptionId, extractSubscriptionFromId, locationNameOrCodeEquals } from "./azureUtils.js";
import { ManagementClientFactory, handleGet } from "./azureSdkUtils.js";
import { AzCliInvoker, AzCliOptions, AzCliTemplateFn } from "./azCliInvoker.js";

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
    | "timeCreated"
  > {}

export class ComputeTools {
  #invoker: AzCliInvoker;
  #managementClientFactory: ManagementClientFactory;
  #options: ComputeToolsOptions;

  constructor(
    dependencies: {
      invoker: AzCliInvoker;
      managementClientFactory: ManagementClientFactory;
    },
    options: ComputeToolsOptions,
  ) {
    this.#invoker = dependencies.invoker;
    this.#managementClientFactory = dependencies.managementClientFactory;
    this.#options = shallowCloneDefinedValues(options);
  }

  async vmGet(name: string, options?: ComputeToolsOptions): Promise<VirtualMachine | null> {
    const { groupName, subscriptionId, abortSignal } = this.#buildMergedOptions(options);
    if (subscriptionId != null && groupName != null) {
      const client = this.getClient(subscriptionId);
      return await handleGet(client.virtualMachines.get(groupName, name, { abortSignal }));
    }

    const args = ["--name", name];
    if (groupName) {
      args.push("--resource-group", groupName);
    }

    return this.#getLaxInvokerFn(options)<VirtualMachine>`vm show ${args}`;
  }

  async vmUpsert(
    name: string,
    optionsDescriptor: VirtualMachineDescriptor & ComputeToolsOptions,
  ): Promise<VirtualMachine> {
    const {
      options,
      descriptor: { ...descriptorRest },
    } = splitComputeOptionsAndDescriptor(optionsDescriptor);

    const opContext = this.#buildMergedOptions(options);

    if (opContext.groupName == null) {
      throw new Error("A group name is required to perform operations.");
    }

    let upsertRequired = false;
    let vm = await this.vmGet(name, options);

    let subscriptionId = opContext.subscriptionId;
    const location = opContext.location;

    if (vm) {
      subscriptionId ??= extractSubscriptionFromId(vm.id);

      if (location != null && vm.location != null && !locationNameOrCodeEquals(location, vm.location)) {
        throw new Error(`Specified location ${location} conflicts with existing ${vm.location}.`);
      }

      throw new Error();
    } else {
      if (location == null) {
        throw new Error("A location is required");
      }

      upsertRequired = true;
      vm = {
        name,
        location,
        ...descriptorRest,
      };
    }

    if (upsertRequired) {
      const client = this.getClient(subscriptionId);
      vm = await client.virtualMachines.beginCreateOrUpdateAndWait(opContext.groupName, name, vm, {
        abortSignal: opContext.abortSignal,
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

  #buildInvokerOptions(options?: ComputeToolsOptions | null): AzCliOptions {
    const mergedOptions = this.#buildMergedOptions(options);
    const result: AzCliOptions = {
      forceAzCommandPrefix: true,
      simplifyContainerAppResults: true, // required for most containerapp responses
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

  #getLaxInvokerFn(options?: ComputeToolsOptions): AzCliTemplateFn<null> {
    return this.#invoker({
      ...this.#buildInvokerOptions(options),
      allowBlanks: true,
    });
  }
}
