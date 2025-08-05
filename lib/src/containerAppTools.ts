import type {
  ContainerAppsAPIClientOptionalParams,
  ManagedEnvironment,
  ContainerApp,
  ManagedServiceIdentity,
  KnownManagedServiceIdentityType,
  Configuration,
  Ingress,
  Template,
  KnownActiveRevisionsMode,
  BaseContainer,
} from "@azure/arm-appcontainers";
import { ContainerAppsAPIClient } from "@azure/arm-appcontainers";
import { mergeAbortSignals, isArrayEqual } from "./tsUtils.js";
import {
  applyArrayKeyedDescriptor,
  applyOptionsDifferencesShallow,
  applyOptionsDifferencesDeep,
  applyObjectKeyProperties,
  applyResourceRefListProperty,
  applyResourceRefProperty,
  applySourceToTargetObjectWithTemplate,
  applySourceToTargetObject,
  applyUnorderedValueArrayProp,
  createKeyedArrayPropApplyFn,
  shallowCloneDefinedValues,
  shallowMergeDefinedValues,
  type ApplyContext,
} from "./optionsUtils.js";
import { type SubscriptionId, extractSubscriptionFromId, locationNameOrCodeEquals } from "./azureUtils.js";
import { ManagementClientFactory, handleGet } from "./azureSdkUtils.js";
import { AzCliInvoker, AzCliOptions, AzCliTemplateFn } from "./azCliInvoker.js";

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

interface ManagedServiceIdentityDescriptor extends Pick<ManagedServiceIdentity, "type"> {
  type: `${KnownManagedServiceIdentityType}`;
  userAssignedIdentities?: {
    [propertyName: string]: UserAssignedIdentityDescriptor;
  };
}

function applyManagedServiceIdentityProperty<
  TTarget extends { [K in TKey]?: ManagedServiceIdentity },
  TSource extends { [K in TKey]?: ManagedServiceIdentityDescriptor },
  TKey extends keyof TSource,
>(targetObj: TTarget, sourceObj: TSource, key: TKey, context?: ApplyContext) {
  let appliedChanges = false;
  const sourceValue = sourceObj[key] as ManagedServiceIdentityDescriptor | undefined;
  if (sourceValue == null) {
    if (sourceValue === null) {
      throw new Error("Null managed service identity assignment is not supported");
    } else {
      return appliedChanges;
    }
  }

  let targetValue = targetObj[key] as ManagedServiceIdentity | undefined;
  if (targetValue == null) {
    targetValue = { type: sourceValue.type };
    targetObj[key] = targetValue as TTarget[TKey];
    appliedChanges = true;
  }

  const { userAssignedIdentities, ...rest } = sourceValue;

  targetValue.userAssignedIdentities ??= {};
  if (
    applyObjectKeyProperties(
      targetValue.userAssignedIdentities,
      userAssignedIdentities ?? {},
      (k, t, s) => {
        t[k] = s[k] ?? {};
      },
      true,
    )
  ) {
    appliedChanges = true;
  }

  if (applySourceToTargetObject(targetValue, rest, context)) {
    appliedChanges = true;
  }

  return appliedChanges;
}

function applyIdentityOptions(target: ManagedServiceIdentity, descriptor: ManagedServiceIdentityDescriptor) {
  const { userAssignedIdentities, ...descriptorRest } = descriptor;
  let updated = false;

  if (userAssignedIdentities != null) {
    target.userAssignedIdentities ??= {};

    if (
      applyObjectKeyProperties(
        target.userAssignedIdentities,
        userAssignedIdentities,
        (k, t, s) => {
          t[k] = s[k] ?? {};
        },
        true,
      )
    ) {
      updated = true;
    }
  }

  if (applyOptionsDifferencesShallow(target, descriptorRest as ManagedServiceIdentity)) {
    updated = true;
  }

  return updated;
}

interface ManagedEnvironmentDescriptor
  extends Pick<
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
        identity: applyManagedServiceIdentityProperty,
        workloadProfiles: createKeyedArrayPropApplyFn("name", applySourceToTargetObject, true, true),
      },
      context,
    )
  ) {
    appliedChanges = true;
  }

  return appliedChanges;
}

type IngressDescriptor = Omit<Ingress, "fqdn">;

interface ConfigurationDescriptor extends Omit<Configuration, "activeRevisionsMode" | "ingress"> {
  activeRevisionsMode?: `${KnownActiveRevisionsMode}`;
  ingress?: IngressDescriptor;
}

type TemplateDescriptor = Template;

interface ContainerAppDescriptor extends Pick<ContainerApp, "environmentId" | "workloadProfileName"> {
  identity?: ManagedServiceIdentityDescriptor;
  configuration?: ConfigurationDescriptor;
  template?: TemplateDescriptor;
}

export class ContainerAppTools {
  #invoker: AzCliInvoker;
  #managementClientFactory: ManagementClientFactory;
  #options: ContainerAppToolsOptions;

  constructor(
    dependencies: {
      invoker: AzCliInvoker;
      managementClientFactory: ManagementClientFactory;
    },
    options: ContainerAppToolsOptions,
  ) {
    this.#invoker = dependencies.invoker;
    this.#managementClientFactory = dependencies.managementClientFactory;
    this.#options = shallowCloneDefinedValues(options);
  }

  async envGet(name: string, options?: ContainerAppToolsOptions): Promise<ManagedEnvironment | null> {
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

  async appUpsert(name: string, optionsDescriptor: ContainerAppDescriptor & ContainerAppToolsOptions) {
    const {
      options,
      descriptor: { identity, configuration, template, ...descriptorRest },
    } = splitContainerAppOptionsAndDescriptor(optionsDescriptor);

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

      if (identity != null) {
        if (app.identity != null) {
          if (applyIdentityOptions(app.identity, identity)) {
            upsertRequired = true;
          }
        } else {
          app.identity = shallowCloneDefinedValues(identity);
          upsertRequired = true;
        }
      }

      if (configuration != null) {
        function applyConfigurationOptions(target: Configuration, source: ConfigurationDescriptor) {
          let updated = false;

          const { identitySettings, registries, secrets, service, ...descriptorRest } = source;

          if (identitySettings != null) {
            target.identitySettings ??= [];
            if (
              applyArrayKeyedDescriptor(
                target.identitySettings,
                identitySettings,
                "identity",
                applyOptionsDifferencesDeep,
                shallowCloneDefinedValues,
                { deleteUnmatchedTargets: true },
              )
            ) {
              updated = true;
            }
          }

          if (registries != null) {
            target.registries ??= [];
            if (
              applyArrayKeyedDescriptor(
                target.registries,
                registries,
                "server",
                applyOptionsDifferencesShallow,
                shallowCloneDefinedValues,
                { deleteUnmatchedTargets: true },
              )
            ) {
              updated = true;
            }
          }

          if (secrets != null) {
            target.secrets ??= [];
            if (
              applyArrayKeyedDescriptor(
                target.secrets,
                secrets,
                "name",
                applyOptionsDifferencesShallow,
                shallowCloneDefinedValues,
                { deleteUnmatchedTargets: true },
              )
            ) {
              updated = true;
            }
          }

          if (service != null) {
            if (target.service == null) {
              target.service = service;
            } else {
              if (applyOptionsDifferencesDeep(target.service, service)) {
                updated = true;
              }
            }
          }

          // simple shallow copy
          if (applyOptionsDifferencesDeep(target, descriptorRest as Configuration)) {
            updated = true;
          }

          return updated;
        }

        app.configuration ??= {};
        if (applyConfigurationOptions(app.configuration, configuration)) {
          upsertRequired = true;
        }
      }

      if (template != null) {
        function applyTemplateOptions(target: Template, source: TemplateDescriptor) {
          const { initContainers, containers, scale, serviceBinds, volumes, ...descriptorRest } = source;
          let updated = false;

          function applyContainerOptions(target: BaseContainer, source: BaseContainer) {
            let updated = false;

            const { args, command, env, volumeMounts, ...descriptorRest } = source;

            if (args != null) {
              target.args ??= [];
              if (!isArrayEqual(target.args, args)) {
                target.args = [...args];
                updated = true;
              }
            }

            if (command != null) {
              target.command ??= [];
              if (!isArrayEqual(target.command, command)) {
                target.command = [...command];
                updated = true;
              }
            }

            if (env != null) {
              target.env ??= [];
              if (
                applyArrayKeyedDescriptor(
                  target.env,
                  env,
                  "name",
                  applyOptionsDifferencesShallow,
                  shallowCloneDefinedValues,
                  { deleteUnmatchedTargets: true },
                )
              ) {
                updated = true;
              }
            }

            if (volumeMounts != null) {
              target.volumeMounts ??= [];
              if (
                applyArrayKeyedDescriptor(
                  target.volumeMounts,
                  volumeMounts,
                  "volumeName",
                  applyOptionsDifferencesShallow,
                  shallowCloneDefinedValues,
                  { deleteUnmatchedTargets: true },
                )
              ) {
                updated = true;
              }
            }

            if (applyOptionsDifferencesDeep(target, descriptorRest)) {
              updated = true;
            }

            return updated;
          }

          if (initContainers != null) {
            target.initContainers ??= [];
            if (
              applyArrayKeyedDescriptor(
                target.initContainers,
                initContainers,
                "name",
                applyContainerOptions,
                shallowCloneDefinedValues,
                { deleteUnmatchedTargets: true },
              )
            ) {
              updated = true;
            }
          }

          if (containers != null) {
            target.containers ??= [];
            if (
              applyArrayKeyedDescriptor(
                target.containers,
                containers,
                "name",
                applyContainerOptions,
                shallowCloneDefinedValues,
                { deleteUnmatchedTargets: true },
              )
            ) {
              updated = true;
            }
          }

          if (scale != null) {
            const { rules: scaleRules, ...scaleRest } = scale;
            target.scale ??= {};

            if (scaleRules != null) {
              target.scale.rules ??= [];
              if (
                applyArrayKeyedDescriptor(
                  target.scale.rules,
                  scaleRules,
                  "name",
                  applyOptionsDifferencesShallow,
                  shallowCloneDefinedValues,
                  { deleteUnmatchedTargets: true },
                )
              ) {
                updated = true;
              }
            }

            if (applyOptionsDifferencesDeep(target.scale, scaleRest)) {
              updated = true;
            }
          }

          if (serviceBinds != null) {
            target.serviceBinds ??= [];
            if (
              applyArrayKeyedDescriptor(
                target.serviceBinds,
                serviceBinds,
                "name",
                applyOptionsDifferencesShallow,
                shallowCloneDefinedValues,
                { deleteUnmatchedTargets: true },
              )
            ) {
              updated = true;
            }
          }

          if (volumes != null) {
            target.volumes ??= [];
            if (
              applyArrayKeyedDescriptor(
                target.volumes,
                volumes,
                "name",
                applyOptionsDifferencesShallow,
                shallowCloneDefinedValues,
                { deleteUnmatchedTargets: true },
              )
            ) {
              updated = true;
            }
          }

          if (applyOptionsDifferencesDeep(target, descriptorRest)) {
            updated = true;
          }

          return updated;
        }

        app.template ??= {};
        if (applyTemplateOptions(app.template, template)) {
          upsertRequired = true;
        }
      }

      if (applyOptionsDifferencesShallow(app, descriptorRest)) {
        upsertRequired = true;
      }
    } else {
      if (location == null) {
        throw new Error("A location is required");
      }

      upsertRequired = true;
      app = {
        name,
        location,
        identity,
        configuration,
        template,
        ...descriptorRest,
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

  #buildInvokerOptions(options?: ContainerAppToolsOptions | null): AzCliOptions {
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

  #getLaxInvokerFn(options?: ContainerAppToolsOptions): AzCliTemplateFn<null> {
    return this.#invoker({
      ...this.#buildInvokerOptions(options),
      allowBlanks: true,
    });
  }
}
