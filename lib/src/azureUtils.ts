import { validate as uuidValidate } from 'uuid';
import type { Resource } from "@azure/arm-resources";
import type { Subscription } from "@azure/arm-resources-subscriptions";
import {
  isStringValueArrayEqual,
} from "./tsUtils.js";

export type Account = Pick<Subscription, "id" | "managedByTenants" | "state" | "tenantId"> & {
  readonly cloudName?: "AzureCloud" | (string & {}),
  readonly homeTenantId?: string,
  readonly isDefault: boolean,
  readonly name: string,
  readonly user?: {
    readonly name: string,
    readonly type: string
  }
}

export interface SimpleAdUser {
  id: string,
  userPrincipalName?: string,
  displayName?: string,
}

export type ResourceSummary = Pick<Resource, "id" | "name" | "type">;

export type SubscriptionId = string;
export function isSubscriptionId(value: unknown): value is SubscriptionId {
  return uuidValidate(value);
}

export type SubscriptionIdOrName = string;
export function isSubscriptionIdOrName(value: unknown): value is SubscriptionIdOrName {
  return typeof value === "string" && value.length > 0;
}

export type TenantId = string;
export function isTenantId(value: unknown): value is TenantId {
  return uuidValidate(value);
}

export interface NameWithLocationDescriptor {
  name: string,
  location: string,
}

export function isNameWithLocationDescriptor<T>(resource?: T): resource is T & NameWithLocationDescriptor {
  return resource != null
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    && typeof (resource as any).name === "string" && typeof (resource as any).location === "string";
}

// type VirtualMachineCreateResult = {
//   fqdns: string,
//   id: string,
//   location: string,
//   macAddress: string,
//   powerState: string,
//   privateIpAddress: string,
//   publicIpAddress: string,
//   resourceGroup: string,
//   zones: string
// };

export type ResourceId = string;

export function isResourceId(resourceId?: unknown): resourceId is ResourceId {
  return resourceId != null
    && typeof resourceId === "string"
    && /\/subscriptions\/([^/]+)\//i.test(resourceId);
}

export function extractSubscriptionFromId(resourceId?: string): string | null {
  if (!resourceId) {
    return null;
  }

  const match = resourceId.match(/\/subscriptions\/([^/]+)\//i);
  return (match && match[1]) ?? null;
}

export function constructId(
  subscriptionId?: SubscriptionId,
  resourceGroupName?: string,
  resourceType?: string,
  ...names: string[]
) {
  let result = "";

  if (subscriptionId != null) {
    result += `/subscriptions/${subscriptionId}`;
  }

  if (resourceGroupName != null) {
    result += `/resourceGroups/${resourceGroupName}`;
  }

  if (resourceType != null) {
    result += `/provider/${resourceType}`;
  }

  if (names && names.length > 0) {
    for (const name of names) {
      result += `/${name}`;
    }
  }

  return result;
}

export type Scope = string;
export function isScope(value: unknown): value is Scope {
  return typeof value === "string" && /^[0-9a-zA-Z-_.:/]+$/.test(value);
}

export interface AzCliAccessToken {
  accessToken: string,
  expiresOn: string,
  expires_on: number,
  subscription: SubscriptionIdOrName,
  tenant: TenantId,
  tokenType: string,
}

export function idsEquals(
  a: {id?: string | null}[] | null | undefined,
  b: {id?: string | null}[] | null | undefined,
  sort?: boolean) {
  if (a == null) {
    return b == null;
  }
  if (b == null) {
    return false;
  }

  return isStringValueArrayEqual(a.map(e => e.id), b.map(e => e.id), { sort });
}
