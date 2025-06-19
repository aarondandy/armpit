import { validate as uuidValidate } from 'uuid';
import type { Resource } from "@azure/arm-resources";
import type { Subscription } from "@azure/arm-resources-subscriptions";

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

export function isNamedLocationDescriptor<T extends any>(resource?: T): resource is T & { name: string, location: string } {
  return resource != null
    && typeof (resource as any).name === "string"
    && typeof (resource as any).location === "string";
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

export function extractSubscriptionId(resourceId?: string) {
  if (!resourceId) {
    return null;
  }

  const match = resourceId.match(/\/subscriptions\/([^/]+)\//i);
  return (match && match[1]) ?? null;
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
