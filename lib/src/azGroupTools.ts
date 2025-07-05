import type { ResourceGroup } from "@azure/arm-resources";
import { CallableClassBase } from "./tsUtils.js";
import { ExistingGroupLocationConflictError, GroupNotEmptyError } from "./errors.js";
import {
  type ResourceSummary,
  isNamedLocationDescriptor,
  extractSubscriptionId,
} from "./azureUtils.js";
import { execaAzCliInvokerFactory, type AzCliInvoker } from "./azCliUtils.js";
import { ManagementClientFactory } from "./azureSdkUtils.js";
import type { ArmpitCredentialOptions, ArmpitCliCredentialFactory } from "./armpitCredential.js";
import { AzGroupInterface } from "./interface.js";
import { NetworkManagementTools } from "./networkManagementTools.js";

export interface AzGroupTools {
  (name: string, location: string): Promise<AzGroupInterface>;
  (descriptor: {name: string, location: string}): Promise<AzGroupInterface>;
}

export class AzGroupTools extends CallableClassBase implements AzGroupTools {

  #invokers: AzCliInvoker;
  #credentialFactory: ArmpitCliCredentialFactory;
  #managementClientFactory: ManagementClientFactory;
  #context: { location?: string };

  constructor(invokers: AzCliInvoker, credentialFactory: ArmpitCliCredentialFactory, managementClientFactory: ManagementClientFactory, context: { location?: string }) {
    super();
    this.#invokers = invokers;
    this.#credentialFactory = credentialFactory;
    this.#managementClientFactory = managementClientFactory;
    this.#context = context;
  }

  protected fnImpl(name: string, location: string): Promise<AzGroupInterface>;
  protected fnImpl(descriptor: { readonly name: string, readonly location: string}): Promise<AzGroupInterface>;
  protected async fnImpl(nameOrDescriptor: string | { readonly name: string, readonly location: string }, secondArg?: string): Promise<AzGroupInterface> {
    let descriptor: { name: string, location: string };

    if (nameOrDescriptor == null) {
      throw new Error("Name or descriptor is required");
    }

    if (typeof nameOrDescriptor === "string") {
      // overload: string, location: string
      descriptor = {
        name: nameOrDescriptor,
        location: secondArg ?? this.#getRequiredDefaultLocation()
      };
    } else if (nameOrDescriptor.name != null) {
      // overload: {name, location}

      if (typeof nameOrDescriptor.name !== "string") {
        throw new Error("Group name is required");
      }

      if (typeof nameOrDescriptor.location !== "string") {
        throw new Error("An explicit location is required");
      }

      descriptor = nameOrDescriptor;
    } else {
      throw new Error("Unexpected arguments");
    }

    if (descriptor.location == null) {
      // TODO: Can location be inherited if this.#azCli is AzLocationBound
      throw new Error("Location is required");
    }

    let group = await this.show(descriptor.name);
    if (group == null) {
      group = await this.create(descriptor.name, descriptor.location);
    } else if (group.location !== descriptor.location) {
      throw new ExistingGroupLocationConflictError(group, descriptor.location);
    }

    if (!isNamedLocationDescriptor(group)) {
      throw new Error("Resource group is not correctly formed");
    }

    const invoker = execaAzCliInvokerFactory({
      forceAzCommandPrefix: true,
      laxParsing: false,
      defaultLocation: group.location ?? descriptor.location,
      defaultResourceGroup: group.name ?? descriptor.name,
    });

    const { name: groupName, ...descriptorWithoutName } = descriptor;
    const subscriptionId = extractSubscriptionId(group.id);
    let context = {
      groupName,
      location: descriptor.location,
      subscriptionId,
    };

    const mainFn = invoker.strict;
    const cliResult = Object.assign(mainFn, descriptorWithoutName);
    Object.defineProperty(cliResult, "name", {
      value: groupName,
      configurable: true,
      enumerable: true,
      writable: false,
    });
    return Object.assign(cliResult, {
      strict: invoker.strict,
      lax: invoker.lax,
      network: new NetworkManagementTools(this.#managementClientFactory, context),
      getCredential: (options?: ArmpitCredentialOptions) => {
        if (subscriptionId) {
          options = { subscription: subscriptionId, ...options };
        }

        return this.#credentialFactory.getCredential(options);
      },
    });
  }

  async show(name: string): Promise<ResourceGroup | null> {
    return await this.#invokers.lax<ResourceGroup>`group show --name ${name}`;
  };

  async exists(name: string): Promise<boolean> {
    return !!(await this.#invokers.lax<boolean>`group exists --name ${name}`);
  }

  async create(name: string, location: string) {
    return await this.#invokers.strict<ResourceGroup>`group create --name ${name} -l ${location}`;
  }

  async delete(name: string) {
    const group = await this.show(name);
    if (group == null) {
      return false;
    }

    if (typeof group.name !== "string") {
      throw new Error(`Loaded resource group for ${name} is not valid`);
    } else if (group.name !== name) {
      throw new Error(`Loaded resource group for ${name} has a conflicting name: ${group.name}`);
    }

    const jmesQuery = "[].{id: id, name: name, type: type}"; // passes as an expression for correct escaping
    const resources = await this.#invokers.strict<ResourceSummary[]>`resource list --resource-group ${name} --query ${jmesQuery}`;
    if (resources.length !== 0) {
      throw new GroupNotEmptyError(name, resources);
    }

    await this.#invokers.strict<void>`group delete --yes --name ${name}`;
    return true;
  }

  #getRequiredDefaultLocation(): string {
    const location = this.#context.location;
    if (location == null) {
      throw new Error("No required default location has been set");
    }

    return location;
  }
}
