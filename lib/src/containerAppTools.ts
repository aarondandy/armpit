import type { ContainerAppsAPIClientOptionalParams, ManagedEnvironment, ContainerApp } from "@azure/arm-appcontainers";
import { ContainerAppsAPIClient } from "@azure/arm-appcontainers";
import { mergeAbortSignals, mergeOptionsObjects, applyOptionsDifferences } from "./tsUtils.js";
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

type ContainerAppUpsertOptions = ContainerAppToolsCommonOptions & Pick<ContainerApp, "environmentId">;

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

          if (applyOptionsDifferences(appEnv.vnetConfiguration, options.vnetConfiguration)) {
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
              applyOptionsDifferences(
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
      throw new Error();
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

    return this.#getLaxInvokerFn(options)<ManagedEnvironment>`containerapp show ${args}`;
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
    } else {
      if (location == null) {
        throw new Error("A location is required");
      }

      upsertRequired = true;
      app = {
        name,
        location,
      };
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
