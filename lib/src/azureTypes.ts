import { validate as uuidValidate } from "uuid";
import type { Resource } from "@azure/arm-resources";
import type { Subscription } from "@azure/arm-resources-subscriptions";
import type { Brand } from "./tsUtils.js";

export type Account = Pick<Subscription, "id" | "managedByTenants" | "state" | "tenantId"> & {
  readonly cloudName?: "AzureCloud" | (string & {});
  readonly homeTenantId?: string;
  readonly isDefault: boolean;
  readonly name: string;
  readonly user?: {
    readonly name: string;
    readonly type: string;
  };
};

export type ResourceSummary = Pick<Resource, "id" | "name" | "type">;

export type SubscriptionId = Brand<string, "SubscriptionId">;
export function isSubscriptionId(value: unknown): value is SubscriptionId {
  return uuidValidate(value);
}

export type SubscriptionName = Brand<string, "SubscriptionName">;
export function isSubscriptionName(value: unknown): value is SubscriptionName {
  return typeof value === "string" && value.length > 0;
}

export type SubscriptionIdOrName = SubscriptionName | SubscriptionId;
export function isSubscriptionIdOrName(value: unknown): value is SubscriptionIdOrName {
  return isSubscriptionName(value);
}

export type TenantId = Brand<string, "TenantId">;
export function isTenantId(value: unknown): value is TenantId {
  return uuidValidate(value);
}

export type ResourceId = Brand<string, "ResourceId">;
export function isResourceId(resourceId?: unknown): resourceId is ResourceId {
  return resourceId != null && typeof resourceId === "string" && /\/subscriptions\/([^/]+)\//i.test(resourceId);
}

export interface SimpleAdUser {
  id: string;
  userPrincipalName?: string;
  displayName?: string;
}

export interface AzCliAccessToken {
  accessToken: string;
  expiresOn: string;
  expires_on: number;
  subscription: SubscriptionIdOrName;
  tenant: TenantId;
  tokenType: string;
}

export type AccessTokenScope = Brand<string, "AccessTokenScope">;
export function isAccessTokenScope(value: unknown): value is AccessTokenScope {
  return typeof value === "string" && /^[0-9a-zA-Z-_.:/]+$/.test(value);
}

export interface VirtualMachineCreateResult {
  id: string;
  resourceGroup: string;
  powerState?: string;
  publicIpAddress?: string;
  fqdns?: string;
  privateIpAddress?: string;
  macAddress?: string;
  location?: string;
  identity?: { type?: string; userAssignedIdentities?: { [propertyName: string]: object } };
  zones?: string;
}
