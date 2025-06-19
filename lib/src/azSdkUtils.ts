import { isRestError } from "@azure/core-rest-pipeline";

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
