import {
  type ResourceGroup,
  type ResourceManagementClientOptionalParams,
  ResourceManagementClient,
} from "@azure/arm-resources";
import { CallableClassBase, mergeAbortSignals } from "./tsUtils.js";
import { shallowMergeDefinedValues, shallowCloneDefinedValues } from "./optionsUtils.js";
import { ExistingGroupLocationConflictError, GroupNotEmptyError } from "./errors.js";
import { isSubscriptionId, type SubscriptionId, type ResourceSummary } from "./azureTypes.js";
import { hasNameAndLocation, extractSubscriptionFromId, locationNameOrCodeEquals } from "./azureUtils.js";
import type { AzCliInvoker, AzCliOptions, AzCliTemplateFn } from "./azCliInvoker.js";
import { ManagementClientFactory, handleGet } from "./azureSdkUtils.js";
import type { ArmpitCredentialOptions, ArmpitCliCredentialFactory } from "./armpitCredential.js";
import { AzGroupInterface } from "./interface.js";
import { NetworkTools } from "./networkTools.js";
import { ContainerAppTools } from "./containerAppTools.js";
import { ComputeTools } from "./computeTools.js";
import { AppServiceTools } from "./appServiceTools.js";

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

interface GroupUpsertDescriptor {
  name: string;
  location: string;
  subscriptionId?: SubscriptionId | string;
}

// eslint-disable-next-line @typescript-eslint/no-unsafe-declaration-merging
export interface ResourceGroupTools {
  (name: string, location: string, subscriptionId?: SubscriptionId | string): Promise<AzGroupInterface>;
  (descriptor: GroupUpsertDescriptor): Promise<AzGroupInterface>;
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
    subscriptionId?: SubscriptionId | string,
    abortSignal?: AbortSignal,
  ): Promise<AzGroupInterface>;
  protected fnImpl(descriptor: GroupUpsertDescriptor, abortSignal?: AbortSignal): Promise<AzGroupInterface>;
  protected async fnImpl(
    nameOrDescriptor: string | GroupUpsertDescriptor,
    secondArg?: string | AbortSignal,
    thirdArg?: SubscriptionId | string,
    fourthArg?: AbortSignal,
  ): Promise<AzGroupInterface> {
    let groupName: string;
    let location: string;
    let subscriptionId: SubscriptionId | null = null;
    let abortSignal: AbortSignal | undefined;

    if (nameOrDescriptor == null) {
      throw new Error("Name or descriptor is required");
    }

    if (typeof nameOrDescriptor === "string") {
      // overload: name, location, subscriptionId?, abortSignal?
      abortSignal = fourthArg;

      groupName = nameOrDescriptor;
      if (secondArg == null) {
        location = this.#getRequiredDefaultLocation();
      } else if (typeof secondArg === "string") {
        location = secondArg;
      } else {
        throw new Error("Location argument is not valid");
      }

      if (thirdArg != null) {
        if (!isSubscriptionId(thirdArg)) {
          throw new Error("Given subscription ID is not valid");
        }

        subscriptionId = thirdArg;
      }
    } else if (nameOrDescriptor.name != null) {
      // overload: {name, location, subscriptionId?}, abortSignal?
      abortSignal = secondArg as AbortSignal;

      if (typeof nameOrDescriptor.name !== "string") {
        throw new Error("Group name is required");
      }

      groupName = nameOrDescriptor.name;

      if (typeof nameOrDescriptor.location !== "string") {
        throw new Error("An explicit location is required");
      }

      location = nameOrDescriptor.location;

      if (nameOrDescriptor.subscriptionId != null) {
        if (!isSubscriptionId(nameOrDescriptor.subscriptionId)) {
          throw new Error("Provided subscription ID is not valid");
        }

        subscriptionId = nameOrDescriptor.subscriptionId;
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

    const baseOptions = { subscriptionId: subscriptionId ?? undefined, abortSignal };
    let group = await this.get(groupName, baseOptions);
    if (group == null) {
      group = await this.create(groupName, location, baseOptions);
    } else if (!locationNameOrCodeEquals(location, group.location)) {
      throw new ExistingGroupLocationConflictError(group, location);
    }

    if (!hasNameAndLocation(group)) {
      throw new Error("Resource group is not correctly formed");
    }

    const invoker = this.#invoker({
      defaultLocation: group.location ?? location,
      defaultResourceGroup: group.name ?? groupName,
    });

    if (subscriptionId == null && group.id != null) {
      subscriptionId = extractSubscriptionFromId(group.id);
    }

    const generalToolOptions = {
      groupName,
      location,
      subscriptionId,
    };

    // eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
    const mainFn = (...args: unknown[]) => (invoker as Function)(...args);
    const cliResult = Object.assign(mainFn, { location, subscriptionId });
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

  async create(name: string, location: string, options?: GroupToolsBaseOptions): Promise<ResourceGroup> {
    const { subscriptionId, abortSignal } = this.#buildMergedOptions(options);
    if (subscriptionId != null) {
      const client = this.getClient(subscriptionId);
      return await client.resourceGroups.createOrUpdate(name, { location }, { abortSignal });
    }

    return await this.#getInvokerFn(options)<ResourceGroup>`group create --name ${name} --location ${location}`;
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

  #getRequiredDefaultLocation(): string {
    const location = this.#options.location;
    if (location == null) {
      throw new Error("No required default location has been set");
    }

    return location;
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
