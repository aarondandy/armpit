import type {
  AppServicePlan,
  AzureStorageInfoValue,
  HostingEnvironmentProfile,
  ManagedServiceIdentity,
  Site,
  SiteConfig,
  SiteDnsConfig,
  WebSiteManagementClientOptionalParams,
} from "@azure/arm-appservice";
import { WebSiteManagementClient } from "@azure/arm-appservice";
import { mergeAbortSignals } from "./tsUtils.js";
import {
  applySourceToTargetObjectWithTemplate,
  applySourceToTargetObject,
  wrapPropObjectApply,
  createKeyedArrayPropApplyFn,
  shallowCloneDefinedValues,
  shallowMergeDefinedValues,
  type ApplyContext,
  applyObjectKeyProperties,
} from "./optionsUtils.js";
import type { SubscriptionId } from "./azureTypes.js";
import { applyManagedServiceIdentity, locationNameOrCodeEquals } from "./azureUtils.js";
import { ManagementClientFactory, handleGet } from "./azureSdkUtils.js";

interface AppServiceToolsOptions {
  groupName?: string | null;
  location?: string | null;
  subscriptionId?: SubscriptionId | null;
  abortSignal?: AbortSignal;
}

function splitAppServiceOptionsAndDescriptor<T extends AppServiceToolsOptions>(optionsDescriptor: T) {
  const { groupName, location, subscriptionId, abortSignal, ...rest } = optionsDescriptor;
  return {
    options: { groupName, location, subscriptionId, abortSignal } as AppServiceToolsOptions,
    descriptor: rest,
  };
}

type HostingEnvironmentProfileDescriptor = Pick<HostingEnvironmentProfile, "id">;

interface AppServicePlanDescriptor extends Omit<
  AppServicePlan,
  | "id"
  | "name"
  | "location"
  | "type"
  | "status"
  | "subscription"
  | "maximumNumberOfWorkers"
  | "numberOfWorkers"
  | "geoRegion"
  | "numberOfSites"
  | "resourceGroup"
  | "provisioningState"
  | "hostingEnvironmentProfile"
> {
  hostingEnvironmentProfile?: HostingEnvironmentProfileDescriptor;
}

function applyAppServicePlan(target: AppServicePlan, descriptor: AppServicePlanDescriptor, context?: ApplyContext) {
  let appliedChanges = false;

  if (
    applySourceToTargetObjectWithTemplate(
      target,
      descriptor,
      {
        sku: {
          capabilities: createKeyedArrayPropApplyFn("name", applySourceToTargetObject, true, true),
        },
      },
      context,
    )
  ) {
    appliedChanges = true;
  }

  return appliedChanges;
}

type ManagedServiceIdentityDescriptor = Pick<ManagedServiceIdentity, "type" | "userAssignedIdentities">;

interface SiteConfigDescriptor extends Omit<SiteConfig, "machineKey"> {
  linuxFxVersionDefault?: SiteConfigDescriptor["linuxFxVersion"];
  windowsFxVersionDefault?: SiteConfigDescriptor["windowsFxVersion"];
}

function applySiteConfig(target: SiteConfig, descriptor: SiteConfigDescriptor, context?: ApplyContext) {
  let appliedChanges = false;

  if ((target.linuxFxVersion == null || target.linuxFxVersion === "") && descriptor.linuxFxVersionDefault != null) {
    target.linuxFxVersion = descriptor.linuxFxVersionDefault;
  }

  if (
    (target.windowsFxVersion == null || target.windowsFxVersion === "") &&
    descriptor.windowsFxVersionDefault != null
  ) {
    target.windowsFxVersion = descriptor.windowsFxVersionDefault;
  }

  if (
    applySourceToTargetObjectWithTemplate(
      target,
      descriptor,
      {
        appSettings: createKeyedArrayPropApplyFn("name", applySourceToTargetObject, true, true),
        azureStorageAccounts: wrapPropObjectApply(applySiteConfigAzureStorageInfo),
        connectionStrings: createKeyedArrayPropApplyFn("name", applySourceToTargetObject, true, true),
        ipSecurityRestrictions: createKeyedArrayPropApplyFn("name", applySourceToTargetObject, true, true),
        metadata: createKeyedArrayPropApplyFn("name", applySourceToTargetObject, true, true),
        scmIpSecurityRestrictions: createKeyedArrayPropApplyFn("name", applySourceToTargetObject, true, true),
      },
      context,
    )
  ) {
    appliedChanges = true;
  }

  return appliedChanges;
}

type AzureStorageInfoValueDescriptor = Omit<AzureStorageInfoValue, "state">;

function applySiteConfigAzureStorageInfo<
  TTarget extends { [propertyName: string]: AzureStorageInfoValue },
  TSource extends { [propertyName: string]: AzureStorageInfoValueDescriptor },
>(target: TTarget, source: TSource, context?: ApplyContext) {
  return applyObjectKeyProperties(
    target,
    source,
    (k, t, s) => {
      if (t[k as keyof TTarget] == null) {
        t[k as keyof TTarget] = {} as TTarget[keyof TTarget];
      }

      return applySourceToTargetObject(t[k as keyof TTarget], s[k], context);
    },
    true,
    (k, t, s) => applySourceToTargetObject(t[k], s[k], context),
  );
}

function applyKeyedStrings(
  target: object & { [propertyName: string]: string },
  source: object & { [propertyName: string]: string },
) {
  return applyObjectKeyProperties(
    target,
    source,
    (k, t, s) => {
      t[k] = s[k];
    },
    true,
    (k, t, s) => {
      if (t[k] === s[k]) {
        return false;
      }

      t[k] = s[k];
      return true;
    },
  );
}

interface SiteDescriptor extends Omit<
  Site,
  | "id"
  | "name"
  | "location"
  | "type"
  | "state"
  | "hostNames"
  | "repositorySiteName"
  | "usageState"
  | "enabledHostNames"
  | "availabilityState"
  | "lastModifiedTimeUtc"
  | "trafficManagerHostNames"
  | "targetSwapSlot"
  | "outboundIpAddresses"
  | "possibleOutboundIpAddresses"
  | "suspendedTill"
  | "maxNumberOfWorkers"
  | "resourceGroup"
  | "isDefaultContainer"
  | "defaultHostName"
  | "slotSwapStatus"
  | "inProgressOperationId"
  | "sku"
  | "identity"
  | "dnsConfiguration"
  | "siteConfig"
  | "hostingEnvironmentProfile"
> {
  dnsConfiguration?: Omit<SiteDnsConfig, "dnsLegacySortOrder">;
  hostingEnvironmentProfile?: HostingEnvironmentProfileDescriptor;
  identity?: ManagedServiceIdentityDescriptor;
  siteConfig?: SiteConfigDescriptor;
}

function applySite(target: Site, descriptor: SiteDescriptor, context?: ApplyContext) {
  return applySourceToTargetObjectWithTemplate(
    target,
    descriptor,
    {
      cloningInfo: {
        appSettingsOverrides: wrapPropObjectApply(applyKeyedStrings),
      },
      hostNameSslStates: createKeyedArrayPropApplyFn("name", applySourceToTargetObject, true, true),
      identity: wrapPropObjectApply(applyManagedServiceIdentity),
      siteConfig: wrapPropObjectApply(applySiteConfig),
    },
    context,
  );
}

export class AppServiceTools {
  #managementClientFactory: ManagementClientFactory;
  #options: AppServiceToolsOptions;

  constructor(
    dependencies: {
      managementClientFactory: ManagementClientFactory;
    },
    options: AppServiceToolsOptions,
  ) {
    this.#managementClientFactory = dependencies.managementClientFactory;
    this.#options = shallowCloneDefinedValues(options);
  }

  async planGet(name: string, options?: AppServiceToolsOptions): Promise<AppServicePlan | null> {
    const { groupName, subscriptionId, abortSignal } = this.#buildMergedOptions(options);

    if (groupName == null) {
      throw new Error("A group name is required to perform operations.");
    }

    const client = this.getClient(subscriptionId);
    return await handleGet(client.appServicePlans.get(groupName, name, { abortSignal }));
  }

  async planUpsert(
    name: string,
    optionsDescriptor: AppServicePlanDescriptor & AppServiceToolsOptions,
  ): Promise<AppServicePlan> {
    const { options, descriptor } = splitAppServiceOptionsAndDescriptor(optionsDescriptor);
    const { location, groupName, subscriptionId, abortSignal } = this.#buildMergedOptions(options);

    if (groupName == null) {
      throw new Error("A group name is required to perform operations.");
    }

    let upsertRequired = false;

    const client = this.getClient(subscriptionId);

    let plan = await handleGet(client.appServicePlans.get(groupName, name, { abortSignal }));
    if (plan) {
      if (location != null && plan.location != null && !locationNameOrCodeEquals(location, plan.location)) {
        throw new Error(`Specified location ${location} conflicts with existing ${plan.location}.`);
      }
    } else {
      if (location == null) {
        throw new Error("A location is required");
      }

      upsertRequired = true;
      plan = { location };
    }

    if (applyAppServicePlan(plan, descriptor)) {
      upsertRequired = true;
    }

    if (upsertRequired) {
      plan = await client.appServicePlans.beginCreateOrUpdateAndWait(groupName, name, plan, {
        abortSignal: abortSignal,
      });
    }

    return plan;
  }

  async webAppGet(name: string, options?: AppServiceToolsOptions): Promise<Site | null> {
    const { groupName, subscriptionId, abortSignal } = this.#buildMergedOptions(options);

    if (groupName == null) {
      throw new Error("A group name is required to perform operations.");
    }

    const client = this.getClient(subscriptionId);
    return await handleGet(client.webApps.get(groupName, name, { abortSignal }));
  }

  async webAppUpsert(name: string, optionsDescriptor: SiteDescriptor & AppServiceToolsOptions): Promise<Site> {
    const { options, descriptor } = splitAppServiceOptionsAndDescriptor(optionsDescriptor);
    const { location, groupName, subscriptionId, abortSignal } = this.#buildMergedOptions(options);

    if (groupName == null) {
      throw new Error("A group name is required to perform operations.");
    }

    let upsertRequired = false;

    const client = this.getClient(subscriptionId);

    let site = await handleGet(client.webApps.get(groupName, name, { abortSignal }));
    if (site) {
      if (location != null && site.location != null && !locationNameOrCodeEquals(location, site.location)) {
        throw new Error(`Specified location ${location} conflicts with existing ${site.location}.`);
      }
    } else {
      if (location == null) {
        throw new Error("A location is required");
      }

      upsertRequired = true;
      site = { location };
    }

    if (applySite(site, descriptor)) {
      upsertRequired = true;
    }

    if (upsertRequired) {
      site = await client.webApps.beginCreateOrUpdateAndWait(groupName, name, site, {
        abortSignal: abortSignal,
      });
    }

    return site;
  }

  getClient(
    subscriptionId?: SubscriptionId | null,
    options?: WebSiteManagementClientOptionalParams,
  ): WebSiteManagementClient {
    return this.#managementClientFactory.get(
      WebSiteManagementClient,
      (subscriptionId ?? this.#options.subscriptionId) as SubscriptionId,
      options,
    );
  }

  #buildMergedOptions(options?: AppServiceToolsOptions | null) {
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
