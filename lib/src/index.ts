import { filterProperties, pickValues } from "./tsUtils.js";
import { az } from "./az.js";

const helpers = {
  filterProperties,
  pickValues,
} as const;

export default az;
export { az, helpers };
export {
  isSubscriptionId,
  isSubscriptionName,
  isSubscriptionIdOrName,
  isTenantId,
  isResourceId,
  isAccessTokenScope,
} from "./azureTypes.js";
export { extractSubscriptionFromId } from "./azureUtils.js";
export * from "./nameHash.js";
export * from "./errors.js";

export type * from "./azureTypes.js";
