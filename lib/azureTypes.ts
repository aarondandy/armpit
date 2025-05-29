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
