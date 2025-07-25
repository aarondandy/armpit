import type {
  ContainerAppsAPIClientOptionalParams,
  ManagedEnvironment,
  ContainerApp,
  ManagedServiceIdentity,
  Configuration,
  Ingress,
  Template,
} from "@azure/arm-appcontainers";
import { ContainerAppsAPIClient } from "@azure/arm-appcontainers";
import {
  mergeAbortSignals,
  mergeOptionsObjects,
  applyOptionsDifferencesShallow,
  isArrayEqualUnordered,
  applyDescriptorOptionsDeep,
  isObjectShallowEqual,
} from "./tsUtils.js";
import { type SubscriptionId, extractSubscriptionFromId, locationNameOrCodeEquals } from "./azureUtils.js";
import { ManagementClientFactory, handleGet } from "./azureSdkUtils.js";
import { AzCliInvoker, AzCliOptions, AzCliTemplateFn } from "./azCliInvoker.js";

interface ContainerAppToolsCommonOptions {
  groupName?: string | null;
  location?: string | null;
  subscriptionId?: SubscriptionId | null;
  abortSignal?: AbortSignal;
}

type ContainerAppToolsConstructorOptions = ContainerAppToolsCommonOptions;

type ManagedEnvironmentUpsertOptions = ContainerAppToolsCommonOptions &
  Pick<ManagedEnvironment, "vnetConfiguration" | "appLogsConfiguration">;

interface ManagedServiceIdentityDescriptor extends Pick<ManagedServiceIdentity, "type"> {
  userAssignedIdentities?: {
    [propertyName: string]: object;
  };
}

function applyIdentityOptions(target: ManagedServiceIdentity, source: ManagedServiceIdentityDescriptor) {
  let updated = false;

  if (source.type != null && source.type != target.type) {
    updated = true;
    target.type = source.type;
  }

  if (source.userAssignedIdentities != null) {
    target.userAssignedIdentities ??= {};
    const sourceKeys = Object.keys(source.userAssignedIdentities);
    const targetKeys = Object.keys(target.userAssignedIdentities);

    for (const toRemove of targetKeys.filter(k => !sourceKeys.includes(k))) {
      updated = true;
      delete target.userAssignedIdentities[toRemove];
    }

    for (const toAdd of sourceKeys.filter(k => !targetKeys.includes(k))) {
      updated = true;
      target.userAssignedIdentities[toAdd] = source.userAssignedIdentities[toAdd] ?? {};
    }
  }

  return updated;
}

interface ConfigurationDescriptor extends Pick<Configuration, "secrets" | "registries" | "maxInactiveRevisions"> {
  activeRevisionsMode?: "Multiple" | "Single";
  ingress?: Omit<Ingress, "fqdn">;
}

function applyConfigurationOptions(target: Configuration, source: ConfigurationDescriptor) {
  let updated = false;

  if (source.secrets != null) {
    if (target.secrets == null || !isArrayEqualUnordered(source.secrets, target.secrets, isObjectShallowEqual)) {
      target.secrets = source.secrets;
      updated = true;
    }
  }

  if (source.activeRevisionsMode != null && source.activeRevisionsMode != target.activeRevisionsMode) {
    target.activeRevisionsMode = source.activeRevisionsMode;
    updated = true;
  }

  if (source.ingress != null) {
    target.ingress ??= {};
    if (applyDescriptorOptionsDeep(target.ingress, source.ingress)) {
      updated = true;
    }
  }

  if (source.registries != null) {
    target.registries = source.registries;
    updated = true;
  }

  if (source.maxInactiveRevisions != null && source.maxInactiveRevisions !== target.maxInactiveRevisions) {
    target.maxInactiveRevisions = source.maxInactiveRevisions;
    updated = true;
  }

  return updated;
}

type TemplateDescriptor = Template;

function applyTemplateOptions(target: Template, source: TemplateDescriptor) {
  return applyDescriptorOptionsDeep(target, source);
}

interface ContainerAppUpsertOptions extends ContainerAppToolsCommonOptions, Pick<ContainerApp, "environmentId"> {
  identity?: ManagedServiceIdentityDescriptor;
  configuration?: ConfigurationDescriptor;
  template?: TemplateDescriptor;
}

export class ContainerAppTools {
  #invoker: AzCliInvoker;
  #managementClientFactory: ManagementClientFactory;
  #options: ContainerAppToolsConstructorOptions;

  constructor(
    dependencies: {
      invoker: AzCliInvoker;
      managementClientFactory: ManagementClientFactory;
    },
    options: ContainerAppToolsConstructorOptions,
  ) {
    this.#invoker = dependencies.invoker;
    this.#managementClientFactory = dependencies.managementClientFactory;
    this.#options = { ...options };
  }

  async envGet(name: string, options?: ContainerAppToolsCommonOptions): Promise<ManagedEnvironment | null> {
    const { groupName, subscriptionId, abortSignal } = this.#buildMergedOptions(options);
    if (subscriptionId != null && groupName != null) {
      const client = this.getClient(subscriptionId);
      return await handleGet(client.managedEnvironments.get(groupName, name, { abortSignal }));
    }

    const args = ["--name", name];
    if (groupName) {
      args.push("--resource-group", groupName);
    }

    return this.#getLaxInvokerFn(options)<ManagedEnvironment>`containerapp env show ${args}`;
  }

  async envUpsert(name: string, options?: ManagedEnvironmentUpsertOptions): Promise<ManagedEnvironment> {
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

      if (options) {
        if (options.vnetConfiguration) {
          appEnv.vnetConfiguration ??= {};

          if (applyOptionsDifferencesShallow(appEnv.vnetConfiguration, options.vnetConfiguration)) {
            upsertRequired = true;
          }
        }

        if (options.appLogsConfiguration) {
          appEnv.appLogsConfiguration ??= {};

          if (
            options.appLogsConfiguration.destination != null &&
            options.appLogsConfiguration.destination !== appEnv.appLogsConfiguration.destination
          ) {
            upsertRequired = true;
            appEnv.appLogsConfiguration.destination = options.appLogsConfiguration.destination;
          }

          if (options.appLogsConfiguration.logAnalyticsConfiguration) {
            appEnv.appLogsConfiguration.logAnalyticsConfiguration ??= {};
            if (
              applyOptionsDifferencesShallow(
                appEnv.appLogsConfiguration.logAnalyticsConfiguration,
                options.appLogsConfiguration.logAnalyticsConfiguration,
              )
            ) {
              upsertRequired = true;
            }
          }
        }
      }
    } else {
      if (location == null) {
        throw new Error("A location is required");
      }

      upsertRequired = true;
      appEnv = {
        name,
        location,
      };

      if (options) {
        appEnv.vnetConfiguration = options.vnetConfiguration;
        appEnv.appLogsConfiguration = options.appLogsConfiguration;
      }
    }

    if (upsertRequired) {
      const client = this.getClient(subscriptionId);
      appEnv = await client.managedEnvironments.beginCreateOrUpdateAndWait(opContext.groupName, name, appEnv, {
        abortSignal: opContext.abortSignal,
      });
    }

    return appEnv;
  }

  async appGet(name: string, options?: ContainerAppToolsCommonOptions): Promise<ContainerApp | null> {
    const { groupName, subscriptionId, abortSignal } = this.#buildMergedOptions(options);
    if (subscriptionId != null && groupName != null) {
      const client = this.getClient(subscriptionId);
      return await handleGet(client.containerApps.get(groupName, name, { abortSignal }));
    }

    const args = ["--name", name];
    if (groupName) {
      args.push("--resource-group", groupName);
    }

    return this.#getLaxInvokerFn(options)<ContainerApp>`containerapp show ${args}`;
  }

  async appUpsert(name: string, options?: ContainerAppUpsertOptions) {
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

      if (options) {
        if (options.environmentId != null && options.environmentId !== app.environmentId) {
          app.environmentId = options.environmentId;
        }

        if (options.template) {
          if (app.template == null) {
            app.template = options.template;
            upsertRequired = true;
          } else if (applyTemplateOptions(app.template, options.template)) {
            upsertRequired = true;
          }
        }

        if (options.configuration) {
          if (app.configuration == null) {
            app.configuration = options.configuration;
            upsertRequired = true;
          } else if (applyConfigurationOptions(app.configuration, options.configuration)) {
            upsertRequired = true;
          }
        }

        if (options.identity) {
          if (app.identity == null) {
            app.identity = options.identity;
            upsertRequired = true;
          } else if (applyIdentityOptions(app.identity, options.identity)) {
            upsertRequired = true;
          }
        }
      }
    } else {
      if (location == null) {
        throw new Error("A location is required");
      }

      upsertRequired = true;
      app = {
        name,
        location,
      };

      if (options) {
        app.configuration = options.configuration;
        app.environmentId = options.environmentId;
        app.identity = options.identity;
        app.template = options.template;
      }
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

  #buildMergedOptions(options?: ContainerAppToolsCommonOptions | null) {
    if (options == null) {
      return this.#options;
    }

    const merged = mergeOptionsObjects(this.#options, options);

    const abortSignal = mergeAbortSignals(options.abortSignal, this.#options.abortSignal);
    if (abortSignal) {
      merged.abortSignal = abortSignal;
    }

    return merged;
  }

  #buildInvokerOptions(options?: ContainerAppToolsCommonOptions | null): AzCliOptions {
    const mergedOptions = this.#buildMergedOptions(options);
    const result: AzCliOptions = {
      forceAzCommandPrefix: true,
      simplifyContainerAppResults: true,
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

  // #getInvokerFn(options?: ContainerAppToolsCommonOptions): AzCliTemplateFn<never> {
  //   return this.#invoker(this.#buildInvokerOptions(options));
  // }

  #getLaxInvokerFn(options?: ContainerAppToolsCommonOptions): AzCliTemplateFn<null> {
    return this.#invoker({
      ...this.#buildInvokerOptions(options),
      allowBlanks: true,
    });
  }
}
