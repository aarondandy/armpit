import { isRestError } from "@azure/core-rest-pipeline";

export function extractSubscriptionId(resourceId?: string) {
  if (!resourceId) {
    return null;
  }

  const match = resourceId.match(/\/subscriptions\/([^/]+)\//i);
  return (match && match[1]) ?? null;
}

export async function handleGet<T>(promise: Promise<T>) : Promise<T | null> {
  try {
    return await promise;
  } catch (error) {
    if (isRestError(error) && error.statusCode === 404) {
      return null;
    }

    throw error;
  }
}
