import { validate as uuidValidate } from 'uuid';
import type { Resource } from "@azure/arm-resources";
import type { Subscription } from "@azure/arm-resources-subscriptions";
import type { VirtualNetwork, PublicIPAddress, NetworkInterface, NetworkSecurityGroup } from "@azure/arm-network";

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

export function isNamedLocationDescriptor(resource?: any): resource is { name: string, location: string } {
  return resource != null && typeof resource.name === "string" && typeof resource.location === "string";
}

export type VirtualNetworkCreateResult = {
  newVNet: VirtualNetwork
};

export type PublicIPAddressCreateResult = {
  publicIp: PublicIPAddress
};

export type NetworkInterfaceCreateResult = {
  NewNIC: NetworkInterface
};

export type NetworkSecurityGroupCreateResult = {
  NewNSG: NetworkSecurityGroup
}
