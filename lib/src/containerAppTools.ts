import type {
  ContainerAppsAPIClientOptionalParams,
  ManagedEnvironment,
  ContainerApp,
  KnownManagedServiceIdentityType,
  Configuration,
  Ingress,
  Template,
  KnownActiveRevisionsMode,
  KnownIngressTransportMethod,
  KnownIngressClientCertificateMode,
  BaseContainer,
} from "@azure/arm-appcontainers";
import { ContainerAppsAPIClient } from "@azure/arm-appcontainers";
import { mergeAbortSignals } from "./tsUtils.js";
import {
  applySourceToTargetObjectWithTemplate,
  applySourceToTargetObject,
  applyUnorderedValueArrayProp,
  wrapPropObjectApply,
  createKeyedArrayPropApplyFn,
  shallowCloneDefinedValues,
  shallowMergeDefinedValues,
  type ApplyContext,
} from "./optionsUtils.js";
import type { SubscriptionId } from "./azureTypes.js";
import { applyManagedServiceIdentity, extractSubscriptionFromId, locationNameOrCodeEquals } from "./azureUtils.js";
import { ManagementClientFactory, handleGet } from "./azureSdkUtils.js";

interface ContainerAppToolsOptions {
  groupName?: string | null;
  location?: string | null;
  subscriptionId?: SubscriptionId | null;
  abortSignal?: AbortSignal;
}

function splitContainerAppOptionsAndDescriptor<T extends ContainerAppToolsOptions>(optionsDescriptor: T) {
  const { groupName, location, subscriptionId, abortSignal, ...rest } = optionsDescriptor;
  return {
    options: { groupName, location, subscriptionId, abortSignal } as ContainerAppToolsOptions,
    descriptor: rest,
  };
}

type UserAssignedIdentityDescriptor = object;
interface ManagedServiceIdentityDescriptor {
  type: `${KnownManagedServiceIdentityType}`;
  userAssignedIdentities?: {
    [propertyName: string]: UserAssignedIdentityDescriptor;
  };
}

interface ManagedEnvironmentDescriptor extends Pick<
  ManagedEnvironment,
  | "daprAIInstrumentationKey"
  | "daprAIConnectionString"
  | "vnetConfiguration"
  | "appLogsConfiguration"
  | "zoneRedundant"
  | "workloadProfiles"
  | "infrastructureResourceGroup"
  | "peerAuthentication"
  | "peerTrafficConfiguration"
  // TODO: customDomainConfiguration
> {
  identity?: ManagedServiceIdentityDescriptor;
}

function applyManagedEnvironment(
  env: ManagedEnvironment,
  descriptor: ManagedEnvironmentDescriptor,
  context?: ApplyContext,
) {
  let appliedChanges = false;

  if (
    applySourceToTargetObjectWithTemplate(
      env,
      descriptor,
      {
        identity: wrapPropObjectApply(applyManagedServiceIdentity),
        workloadProfiles: createKeyedArrayPropApplyFn("name", applySourceToTargetObject, true, true),
      },
      context,
    )
  ) {
    appliedChanges = true;
  }

  return appliedChanges;
}

interface IngressDescriptor extends Omit<Ingress, "fqdn" | "transport" | "clientCertificateMode"> {
  transport?: `${KnownIngressTransportMethod}`;
  clientCertificateMode?: `${KnownIngressClientCertificateMode}`;
}

interface ConfigurationDescriptor extends Omit<Configuration, "activeRevisionsMode" | "ingress"> {
  activeRevisionsMode?: `${KnownActiveRevisionsMode}`;
  ingress?: IngressDescriptor;
}

function applyConfiguration(config: Configuration, descriptor: ConfigurationDescriptor, context?: ApplyContext) {
  let appliedChanges = false;
  if (
    applySourceToTargetObjectWithTemplate(
      config,
      descriptor,
      {
        identitySettings: createKeyedArrayPropApplyFn("identity", applySourceToTargetObject, true, true),
        registries: createKeyedArrayPropApplyFn("server", applySourceToTargetObject, true, true),
        secrets: createKeyedArrayPropApplyFn("name", applySourceToTargetObject, true, true),
      },
      context,
    )
  ) {
    appliedChanges = true;
  }

  return appliedChanges;
}

type TemplateDescriptor = Template;

function applyContainer(target: BaseContainer, source: BaseContainer, context?: ApplyContext) {
  return applySourceToTargetObjectWithTemplate(
    target,
    source,
    {
      args: applyUnorderedValueArrayProp,
      command: applyUnorderedValueArrayProp,
      env: createKeyedArrayPropApplyFn("name", applySourceToTargetObject, true, true),
      volumeMounts: createKeyedArrayPropApplyFn("volumeName", applySourceToTargetObject, true, true),
    },
    context,
  );
}

function applyContainerTemplate(template: Template, descriptor: TemplateDescriptor, context?: ApplyContext) {
  return applySourceToTargetObjectWithTemplate(
    template,
    descriptor,
    {
      initContainers: createKeyedArrayPropApplyFn("name", applyContainer, true, true),
      containers: createKeyedArrayPropApplyFn("name", applyContainer, true, true),
      scale: {
        rules: createKeyedArrayPropApplyFn("name", applySourceToTargetObject, true, true),
      },
      serviceBinds: createKeyedArrayPropApplyFn("name", applySourceToTargetObject, true, true),
      volumes: createKeyedArrayPropApplyFn("name", applySourceToTargetObject, true, true),
    },
    context,
  );
}

interface ContainerAppDescriptor extends Pick<ContainerApp, "environmentId" | "workloadProfileName"> {
  configuration?: ConfigurationDescriptor;
  identity?: ManagedServiceIdentityDescriptor;
  template?: TemplateDescriptor;
}

function applyContainerApp(app: ContainerApp, descriptor: ContainerAppDescriptor, context?: ApplyContext) {
  let appliedChanges = false;

  if (
    applySourceToTargetObjectWithTemplate(
      app,
      descriptor,
      {
        identity: wrapPropObjectApply(applyManagedServiceIdentity),
        configuration: wrapPropObjectApply(applyConfiguration),
        template: wrapPropObjectApply(applyContainerTemplate),
      },
      context,
    )
  ) {
    appliedChanges = true;
  }

  return appliedChanges;
}

export class ContainerAppTools {
  #managementClientFactory: ManagementClientFactory;
  #options: ContainerAppToolsOptions;

  constructor(
    dependencies: {
      managementClientFactory: ManagementClientFactory;
    },
    options: ContainerAppToolsOptions,
  ) {
    this.#managementClientFactory = dependencies.managementClientFactory;
    this.#options = shallowCloneDefinedValues(options);
  }

  async envGet(name: string, options?: ContainerAppToolsOptions): Promise<ManagedEnvironment | null> {
    const { groupName, subscriptionId, abortSignal } = this.#buildMergedOptions(options);

    if (groupName == null) {
      throw new Error("A group name is required to perform operations.");
    }

    const client = this.getClient(subscriptionId);
    return await handleGet(client.managedEnvironments.get(groupName, name, { abortSignal }));
  }

  async envUpsert(
    name: string,
    optionsDescriptor?: ManagedEnvironmentDescriptor & ContainerAppToolsOptions,
  ): Promise<ManagedEnvironment> {
    const { options, descriptor } = optionsDescriptor
      ? splitContainerAppOptionsAndDescriptor(optionsDescriptor)
      : { descriptor: {} };

    const opContext = this.#buildMergedOptions(options);

    if (opContext.groupName == null) {
      throw new Error("A group name is required to perform operations.");
    }

    let upsertRequired = false;
    let appEnv = await this.envGet(name, options);

    let subscriptionId = opContext.subscriptionId;
    const location = opContext.location;

    if (appEnv) {
      subscriptionId ??= extractSubscriptionFromId(appEnv.id);

      if (location != null && appEnv.location != null && !locationNameOrCodeEquals(location, appEnv.location)) {
        throw new Error(`Specified location ${location} conflicts with existing ${appEnv.location}.`);
      }
    } else {
      if (location == null) {
        throw new Error("A location is required");
      }

      upsertRequired = true;
      appEnv = { name, location };
    }

    if (applyManagedEnvironment(appEnv, descriptor)) {
      upsertRequired = true;
    }

    if (upsertRequired) {
      const client = this.getClient(subscriptionId);
      appEnv = await client.managedEnvironments.beginCreateOrUpdateAndWait(opContext.groupName, name, appEnv, {
        abortSignal: opContext.abortSignal,
      });
    }

    return appEnv;
  }

  async appGet(name: string, options?: ContainerAppToolsOptions): Promise<ContainerApp | null> {
    const { groupName, subscriptionId, abortSignal } = this.#buildMergedOptions(options);

    if (groupName == null) {
      throw new Error("A group name is required to perform operations.");
    }

    const client = this.getClient(subscriptionId);
    return await handleGet(client.containerApps.get(groupName, name, { abortSignal }));
  }

  async appUpsert(name: string, optionsDescriptor: ContainerAppDescriptor & ContainerAppToolsOptions) {
    const { options, descriptor } = splitContainerAppOptionsAndDescriptor(optionsDescriptor);

    const opContext = this.#buildMergedOptions(options);

    if (opContext.groupName == null) {
      throw new Error("A group name is required to perform operations.");
    }

    let upsertRequired = false;
    let app = await this.appGet(name, options);

    let subscriptionId = opContext.subscriptionId;
    const location = opContext.location;

    if (app) {
      subscriptionId ??= extractSubscriptionFromId(app.id);

      if (location != null && app.location != null && !locationNameOrCodeEquals(location, app.location)) {
        throw new Error(`Specified location ${location} conflicts with existing ${app.location}.`);
      }
    } else {
      if (location == null) {
        throw new Error("A location is required");
      }

      upsertRequired = true;
      app = { name, location };
    }

    if (applyContainerApp(app, descriptor)) {
      upsertRequired = true;
    }

    if (upsertRequired) {
      const client = this.getClient(subscriptionId);
      app = await client.containerApps.beginCreateOrUpdateAndWait(opContext.groupName, name, app, {
        abortSignal: opContext.abortSignal,
      });
    }

    return app;
  }

  getClient(
    subscriptionId?: SubscriptionId | null,
    options?: ContainerAppsAPIClientOptionalParams,
  ): ContainerAppsAPIClient {
    return this.#managementClientFactory.get(
      ContainerAppsAPIClient,
      (subscriptionId ?? this.#options.subscriptionId) as SubscriptionId,
      options,
    );
  }

  #buildMergedOptions(options?: ContainerAppToolsOptions | null) {
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
