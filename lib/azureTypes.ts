import { validate as uuidValidate } from 'uuid';
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
