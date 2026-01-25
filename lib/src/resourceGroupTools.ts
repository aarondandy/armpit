import { ResourceManagementClient } from "@azure/arm-resources";
import { CallableClassBase, isObjectShallowEqual, mergeAbortSignals } from "./tsUtils.js";
import { shallowMergeDefinedValues, shallowCloneDefinedValues } from "./optionsUtils.js";
import { ExistingGroupLocationConflictError, GroupNotEmptyError } from "./errors.js";
import { isSubscriptionId, type SubscriptionId, type ResourceSummary } from "./azureTypes.js";
import {
  hasNameAndLocation,
  extractSubscriptionFromId,
  locationNameOrCodeEquals,
  toCliArgPairs,
} from "./azureUtils.js";
import { ManagementClientFactory, handleGet } from "./azureSdkUtils.js";
import { AzGroupProvider } from "./azInterfaces.js";
import { NetworkTools } from "./networkTools.js";
import { ContainerAppTools } from "./containerAppTools.js";
import { ComputeTools } from "./computeTools.js";
import { AppServiceTools } from "./appServiceTools.js";
import type { ResourceGroup, ResourceManagementClientOptionalParams } from "@azure/arm-resources";
import type { AzCliInvoker, AzCliOptions, AzCliTemplateFn } from "./azCliInvoker.js";
import type { ArmpitCredentialOptions, ArmpitCliCredentialFactory } from "./armpitCredential.js";

interface GroupToolsBaseOptions {
  subscriptionId?: SubscriptionId;
  abortSignal?: AbortSignal;
}

interface GroupToolsConstructorOptions extends GroupToolsBaseOptions {
  location?: string;
}

interface GroupToolsDependencies {
  invoker: AzCliInvoker;
  credentialFactory: ArmpitCliCredentialFactory;
  managementClientFactory: ManagementClientFactory;
}

interface GroupUpsertDescriptor extends Pick<ResourceGroup, "tags"> {
  name: string;
  location: string;
  subscriptionId?: SubscriptionId | string;
}

// eslint-disable-next-line @typescript-eslint/no-unsafe-declaration-merging
export interface ResourceGroupTools {
  (
    name: string,
    location: string,
    descriptorOptions?: Omit<GroupUpsertDescriptor, "name" | "location"> & { abortSignal?: AbortSignal },
  ): Promise<AzGroupProvider>;
  (descriptorOptions: GroupUpsertDescriptor & { abortSignal?: AbortSignal }): Promise<AzGroupProvider>;
}

// eslint-disable-next-line @typescript-eslint/no-unsafe-declaration-merging
export class ResourceGroupTools extends CallableClassBase implements ResourceGroupTools {
  #dependencies: GroupToolsDependencies;
  #invoker: AzCliInvoker;
  #options: GroupToolsConstructorOptions;

  constructor(dependencies: GroupToolsDependencies, options: GroupToolsConstructorOptions) {
    super();
    this.#dependencies = dependencies;
    this.#invoker = dependencies.invoker;
    this.#options = shallowCloneDefinedValues(options);
  }

  protected fnImpl(
    name: string,
    location: string,
    descriptorOptions?: Omit<GroupUpsertDescriptor, "name" | "location"> & { abortSignal?: AbortSignal },
  ): Promise<AzGroupProvider>;
  protected fnImpl(descriptorOptions: GroupUpsertDescriptor & { abortSignal?: AbortSignal }): Promise<AzGroupProvider>;
  protected async fnImpl(
    ...args:
      | [string, string, (Omit<GroupUpsertDescriptor, "name" | "location"> & { abortSignal?: AbortSignal })?]
      | [GroupUpsertDescriptor & { abortSignal?: AbortSignal }]
  ): Promise<AzGroupProvider> {
    let groupName: string;
    let location: string | undefined;
    let subscriptionId: SubscriptionId | undefined | null;
    let tags: ResourceGroup["tags"];
    let abortSignal: AbortSignal | undefined;

    if (!(args.length > 0)) {
      throw new Error("Name or descriptor is required");
    }

    if (typeof args[0] === "string") {
      // args: [name, location, partial descriptor & options]
      groupName = args[0];

      if (args.length >= 1) {
        if (args[1] != null) {
          if (typeof args[1] !== "string") {
            throw new Error("Location argument is not valid");
          }

          location = args[1];
        }

        if (args.length >= 2 && args[2] != null) {
          const descriptorOptions = args[2];
          if (descriptorOptions.subscriptionId != null) {
            if (!isSubscriptionId(descriptorOptions.subscriptionId)) {
              throw new Error("Given subscription ID is not valid");
            }

            subscriptionId = descriptorOptions.subscriptionId;
          }

          if (descriptorOptions.tags) {
            tags = descriptorOptions.tags;
          }

          if (descriptorOptions.abortSignal) {
            abortSignal = descriptorOptions.abortSignal;
          }
        }
      }
    } else if (args[0] != null) {
      const descriptorOptions = args[0];

      groupName = descriptorOptions.name;
      tags = descriptorOptions.tags;

      location = descriptorOptions.location;

      if (descriptorOptions.subscriptionId != null) {
        if (!isSubscriptionId(descriptorOptions.subscriptionId)) {
          throw new Error("Given subscription ID is not valid");
        }

        subscriptionId = descriptorOptions.subscriptionId;
      }

      if (descriptorOptions.abortSignal) {
        abortSignal = descriptorOptions.abortSignal;
      }
    } else {
      throw new Error("Unexpected arguments");
    }

    if (location == null) {
      if (this.#options.location == null) {
        throw new Error("Location is required and no default location has been set");
      }

      location = this.#options.location;
    }

    if (subscriptionId == null && this.#options.subscriptionId != null) {
      subscriptionId = this.#options.subscriptionId;
    }

    const operationOptions = {} as GroupToolsBaseOptions;
    if (subscriptionId) {
      operationOptions.subscriptionId = subscriptionId;
    }
    if (abortSignal) {
      operationOptions.abortSignal = abortSignal;
    }

    let group = await this.get(groupName, operationOptions);
    if (group == null) {
      group = await this.create(groupName, location, { tags, ...operationOptions });
    } else {
      if (!locationNameOrCodeEquals(location, group.location)) {
        throw new ExistingGroupLocationConflictError(group, location);
      }

      let upsertRequired = false;

      if (tags && !isObjectShallowEqual(tags, group.tags ?? {})) {
        upsertRequired = true;
      }

      if (upsertRequired) {
        group = await this.create(groupName, location, { tags, ...operationOptions });
      }
    }

    if (!hasNameAndLocation(group)) {
      throw new Error("Resource group is not correctly formed");
    }

    if (subscriptionId == null && group.id != null) {
      subscriptionId = extractSubscriptionFromId(group.id);
    }

    const invoker = this.#invoker({
      defaultLocation: group.location ?? location,
      defaultResourceGroup: group.name ?? groupName,
    });

    const generalToolOptions = {
      groupName,
      location,
      subscriptionId,
    };

    // eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
    const mainFn = (...args: unknown[]) => (invoker as Function)(...args);
    const cliResult = Object.assign(mainFn, { location, subscriptionId: subscriptionId ?? null });
    Object.defineProperty(cliResult, "name", {
      value: groupName,
      configurable: true,
      enumerable: true,
      writable: false,
    });
    return Object.assign(cliResult, {
      appService: new AppServiceTools(this.#dependencies, generalToolOptions),
      containerApp: new ContainerAppTools(this.#dependencies, generalToolOptions),
      compute: new ComputeTools(this.#dependencies, generalToolOptions),
      network: new NetworkTools(this.#dependencies, generalToolOptions),
      getCredential: (options?: ArmpitCredentialOptions) => {
        if (subscriptionId) {
          options = { subscription: subscriptionId, ...options };
        }

        return this.#dependencies.credentialFactory.getCredential(options);
      },
    });
  }

  async get(name: string, options?: GroupToolsBaseOptions): Promise<ResourceGroup | null> {
    const { subscriptionId, abortSignal } = this.#buildMergedOptions(options);
    if (subscriptionId != null) {
      const client = this.getClient(subscriptionId);
      return await handleGet(client.resourceGroups.get(name, { abortSignal }));
    }

    return await this.#getLaxInvokerFn(options)<ResourceGroup>`group show --name ${name}`;
  }

  async exists(name: string, options?: GroupToolsBaseOptions): Promise<boolean> {
    const { subscriptionId, abortSignal } = this.#buildMergedOptions(options);
    if (subscriptionId != null) {
      const client = this.getClient(subscriptionId);
      const result = await client.resourceGroups.checkExistence(name, { abortSignal });
      return !!result.body;
    }

    const args = ["--name", name];
    if (subscriptionId != null) {
      args.push("--subscription", subscriptionId);
    }

    return !!(await this.#getLaxInvokerFn(options)<boolean>`group exists ${args}`);
  }

  async create(
    name: string,
    location: string,
    options?: GroupToolsBaseOptions & Pick<GroupUpsertDescriptor, "tags">,
  ): Promise<ResourceGroup> {
    const { subscriptionId, abortSignal } = this.#buildMergedOptions(options);
    if (subscriptionId != null) {
      const client = this.getClient(subscriptionId);
      return await client.resourceGroups.createOrUpdate(name, { location, tags: options?.tags }, { abortSignal });
    }

    if (options?.tags != null) {
      return await this.#getInvokerFn(
        options,
      )<ResourceGroup>`group create --name ${name} --location ${location} --tags ${toCliArgPairs(options.tags)}`;
    } else {
      return await this.#getInvokerFn(options)<ResourceGroup>`group create --name ${name} --location ${location}`;
    }
  }

  async delete(name: string, options?: GroupToolsBaseOptions) {
    const group = await this.get(name, options);
    if (group == null) {
      return false;
    }

    if (typeof group.name !== "string") {
      throw new Error(`Loaded resource group for ${name} is not valid`);
    } else if (group.name !== name) {
      throw new Error(`Loaded resource group for ${name} has a conflicting name: ${group.name}`);
    }

    // TODO: Use SDK when possible

    const jmesQuery = "[].{id: id, name: name, type: type}"; // passes as an expression for correct escaping
    const resources = await this.#getInvokerFn(options)<
      ResourceSummary[]
    >`resource list --resource-group ${name} --query ${jmesQuery}`;
    if (resources.length !== 0) {
      throw new GroupNotEmptyError(name, resources);
    }

    await this.#getLaxInvokerFn(options)<void>`group delete --yes --name ${name}`;
    return true;
  }

  getClient(
    subscriptionId?: SubscriptionId,
    options?: ResourceManagementClientOptionalParams,
  ): ResourceManagementClient {
    let clientSubscriptionId: SubscriptionId;
    if (subscriptionId != null) {
      if (!isSubscriptionId(subscriptionId)) {
        throw new Error("Given subscription ID is not valid.");
      }

      clientSubscriptionId = subscriptionId;
    } else {
      if (this.#options.subscriptionId == null) {
        throw new Error(
          "No default subscription ID has been set, so an explicit subscription ID argument is required.",
        );
      }

      clientSubscriptionId = this.#options.subscriptionId;
    }

    return this.#dependencies.managementClientFactory.get(ResourceManagementClient, clientSubscriptionId, options);
  }

  #buildMergedOptions(options?: GroupToolsBaseOptions | null) {
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

  #buildInvokerOptions(options?: GroupToolsBaseOptions | null): AzCliOptions {
    const mergedOptions = this.#buildMergedOptions(options);
    const result: AzCliOptions = {
      forceAzCommandPrefix: true,
    };
    if (mergedOptions.abortSignal != null) {
      result.abortSignal = mergedOptions.abortSignal;
    }

    if (mergedOptions.location != null) {
      result.defaultLocation = mergedOptions.location;
    }

    return result;
  }

  #getInvokerFn(options?: GroupToolsBaseOptions): AzCliTemplateFn<never> {
    return this.#invoker(this.#buildInvokerOptions(options));
  }

  #getLaxInvokerFn(options?: GroupToolsBaseOptions): AzCliTemplateFn<null> {
    return this.#invoker({
      ...this.#buildInvokerOptions(options),
      allowBlanks: true,
    });
  }
}
