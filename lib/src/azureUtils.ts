import { isStringValueArrayEqual } from "./tsUtils.js";
import { ApplyContext, applyObjectKeyProperties, applySourceToTargetObject } from "./optionsUtils.js";
import { isSubscriptionId } from "./azureTypes.js";
import type { ResourceId, SubscriptionId } from "./azureTypes.js";

export function hasNameAndLocation<T>(resource?: T): resource is T & { name: string; location: string } {
  return hasName(resource) && hasLocation(resource);
}

export function hasName<T>(resource?: T): resource is T & { name: string } {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return resource != null && typeof (resource as any).name === "string";
}

export function hasLocation<T>(resource?: T): resource is T & { location: string } {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return resource != null && typeof (resource as any).location === "string";
}

export function extractSubscriptionFromId(resourceId?: ResourceId | string): SubscriptionId | null {
  if (!resourceId) {
    return null;
  }

  const match = resourceId.match(/\/subscriptions\/([^/]+)\//i);
  const idValue = match && match[1];
  if (isSubscriptionId(idValue)) {
    return idValue;
  }

  return null;
}

export function constructId(
  subscriptionId?: SubscriptionId,
  resourceGroup?: string,
  provider?: string,
  ...names: readonly string[]
) {
  let result = "";

  if (subscriptionId != null) {
    result += `/subscriptions/${subscriptionId}`;
  }

  if (resourceGroup != null) {
    result += `/resourceGroups/${resourceGroup}`;
  }

  if (provider != null) {
    result += `/provider/${provider}`;
  }

  if (names && names.length > 0) {
    for (const name of names) {
      result += `/${name}`;
    }
  }

  return result;
}

export function idsEquals(
  a: readonly { id?: string | null }[] | null | undefined,
  b: readonly { id?: string | null }[] | null | undefined,
  sort?: boolean,
) {
  if (a == null) {
    return b == null;
  }
  if (b == null) {
    return false;
  }

  return isStringValueArrayEqual(
    a.map(e => e.id),
    b.map(e => e.id),
    { sort },
  );
}

export function locationNameOrCodeEquals(a: string, b: string) {
  return a.replace(/\s/g, "").localeCompare(b.replace(/\s/g, ""), undefined, { sensitivity: "base" }) === 0;
}

export function applyManagedServiceIdentity<
  TTarget extends { type?: string; userAssignedIdentities?: { [propertyName: string]: object } },
  TSource extends { type?: string; userAssignedIdentities?: { [propertyName: string]: object } },
>(target: TTarget, source: TSource, context?: ApplyContext) {
  let appliedChanges = false;
  const { userAssignedIdentities, ...rest } = source;

  if (userAssignedIdentities == null) {
    if (userAssignedIdentities === null && target.userAssignedIdentities != null) {
      delete target.userAssignedIdentities;
    }
  } else {
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
      appliedChanges = true;
    }
  }

  if (applySourceToTargetObject(target, rest, context)) {
    appliedChanges = true;
  }

  return appliedChanges;
}

export function toCliArgPairs<
  T extends {
    [propertyName: string]: string | number | boolean | null | undefined;
  },
>(tags: T): { [K in keyof T]: `${K & string}=${T[K]}` }[keyof T][];
export function toCliArgPairs<
  T extends {
    [propertyName: string]: string | number | boolean | null | undefined;
  },
  D extends string,
>(tags: T, delimiter: D): { [K in keyof T]: `${K & string}${D}${T[K]}` }[keyof T][];
export function toCliArgPairs<
  T extends {
    [propertyName: string]: string | number | boolean | null | undefined;
  },
  D extends string,
>(tags: T, delimiter: D = "=" as D) {
  return Object.entries(tags).map(
    ([k, v]) => `${k}${delimiter}${v}` as { [K in keyof T]: `${K & string}${D}${T[K]}` }[keyof T],
  );
}
