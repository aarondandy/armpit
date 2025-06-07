import { type ResourceSummary } from "./azureTypes.js";

export class ExistingGroupLocationConflictError extends Error {
  groupName: string;
  expectedLocation: string;
  actualLocation: string;

  constructor(actual: {name?: string, location?: string}, expected: string);
  constructor(name: string, actual: string, expected: string);
  constructor(actualOrName: {name?: string, location?: string} | string, secondArg: any, thirdArg?: any) {
    let groupName: string = "unknown";
    let actualLocation: string = "unknown";
    let expectedLocation: string = "unknown";
    if (typeof actualOrName === "string") {
      groupName = actualOrName;
      actualLocation = typeof secondArg === "string" ? secondArg : "unknown";
      expectedLocation = typeof thirdArg == "string" ? thirdArg : "unknown";
    } else if ("name" in actualOrName && typeof actualOrName.name === "string") {
      groupName = actualOrName.name;
      actualLocation = typeof actualOrName.location === "string" ? actualOrName.location : "unknown";
      expectedLocation = typeof secondArg == "string" ? secondArg : "unknown";
    }

    super(`Existing group ${groupName} in ${actualLocation} conflicts with expected location ${expectedLocation}`);

    this.groupName = groupName;
    this.actualLocation = actualLocation;
    this.expectedLocation = expectedLocation;
  }
}

export class GroupNotEmptyError extends Error {
  private static buildMessage(name: string, resources?: ResourceSummary[]) {
    let message = `Group ${name ?? "unknown"} not empty.`
    if (resources && resources.length > 0) {
      message += " Contains resources: " + resources.map(r => r.name ?? r.id ?? "unknown").join(", ");
    }

    return message;
  }

  groupName: string;
  resources?: ResourceSummary[];

  constructor(name: string, resources?: ResourceSummary[]) {
    super(GroupNotEmptyError.buildMessage(name, resources));

    this.groupName = name;
    this.resources = resources;
  }
}
