import type { ResourceGroup } from "@azure/arm-resources";
import {
  type Account,
  type ResourceSummary,
  isSubscriptionId,
  isTenantId,
  isNamedLocationDescriptor,
  extractSubscriptionId,
} from "./azUtils.js";
import { NameHash } from "./nameHash.js";
import { ExistingGroupLocationConflictError, GroupNotEmptyError } from "./errors.js";
import { CallableClassBase } from "./tsUtils.js";
import { execaAzCliInvokerFactory, type AzCliInvokable, type AzCliInvokers } from "./azCliUtils.js";
import { AzAccountTools } from "./azAccountTools.js";
import { AzNsgTools } from "./azNsgTools.js";
import { ArmpitCredential, ArmpitCredentialOptions } from "./armpitCredential.js";

export type {
  Account,
  ResourceSummary,
};

interface AzGlobal {
  readonly group: AzGroupTools;
  readonly account: AzAccountTools;
  getCredential(options?: ArmpitCredentialOptions): ArmpitCredential;
}

interface AzLocationBound {
  readonly location: string;
}

interface AzGroupBound extends AzLocationBound {
  readonly name: string;
  readonly subscriptionId?: string;
  readonly nsg: AzNsgTools;
  getCredential(options?: ArmpitCredentialOptions): ArmpitCredential;
}

interface AzGroupTools {
  (name: string, location: string): Promise<AzGroupBound & AzCliInvokable>;
  (descriptor: {name: string, location: string}): Promise<AzGroupBound & AzCliInvokable>;
}

class AzGroupTools extends CallableClassBase implements AzGroupTools {

  #invokers: AzCliInvokers;
  #context: { location?: string };

  constructor(invokers: AzCliInvokers, context: { location?: string }) {
    super();
    this.#invokers = invokers;
    this.#context = context;
  }

  protected fnImpl(name: string, location: string): Promise<AzGroupBound & AzCliInvokable>;
  protected fnImpl(descriptor: { readonly name: string, readonly location: string}): Promise<AzGroupBound & AzCliInvokable>;
  protected async fnImpl(nameOrDescriptor: string | { readonly name: string, readonly location: string }, secondArg?: string): Promise<AzGroupBound & AzCliInvokable> {
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
    } else if ("name" in nameOrDescriptor) {
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
      nsg: new AzNsgTools(invoker, context),
      getCredential: (options?: ArmpitCredentialOptions) => new ArmpitCredential(invoker, { subscription: subscriptionId ?? undefined, ...options }),
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

const az = (function(): AzGlobal & AzCliInvokable {
  const invoker = execaAzCliInvokerFactory({
    forceAzCommandPrefix: true,
    laxParsing: false,
  });
  const mainFn = invoker.strict;
  const cliResult = Object.assign(mainFn, {
    account: new AzAccountTools(invoker),
    group: new AzGroupTools(invoker, { })
  });
  let result = Object.assign(cliResult, {
    strict: invoker.strict,
    lax: invoker.lax,
    getCredential: (options?: ArmpitCredentialOptions) => new ArmpitCredential(invoker, options),
  });
  return result;
})();

export {
  az,
  isSubscriptionId,
  isTenantId,
  NameHash,
  ExistingGroupLocationConflictError,
  GroupNotEmptyError,
}
