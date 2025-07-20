import { describe, it, expect } from "vitest";
import { isSubscriptionId, isSubscriptionIdOrName, isTenantId, hasNameAndLocation } from "./azureUtils.js";

describe("isSubscriptionId", () => {
  it("undefined", () => expect(isSubscriptionId(undefined)).toBe(false));
  it("null", () => expect(isSubscriptionId(null)).toBe(false));
  it("empty", () => expect(isSubscriptionId("")).toBe(false));
  it("arbitrary text", () => expect(isSubscriptionId("Subscription Name")).toBe(false));
  it("uuid text", () => expect(isSubscriptionId("b485d697-af00-47ac-938d-56792f0af0c5")).toBe(true));
});

describe("isSubscriptionIdOrName", () => {
  it("undefined", () => expect(isSubscriptionIdOrName(undefined)).toBe(false));
  it("null", () => expect(isSubscriptionIdOrName(null)).toBe(false));
  it("empty", () => expect(isSubscriptionIdOrName("")).toBe(false));
  it("arbitrary text", () => expect(isSubscriptionIdOrName("Subscription Name")).toBe(true));
  it("uuid text", () => expect(isSubscriptionIdOrName("b485d697-af00-47ac-938d-56792f0af0c5")).toBe(true));
});

describe("isTenantId", () => {
  it("undefined", () => expect(isTenantId(undefined)).toBe(false));
  it("null", () => expect(isTenantId(null)).toBe(false));
  it("empty", () => expect(isTenantId("")).toBe(false));
  it("arbitrary text", () => expect(isTenantId("Subscription Name")).toBe(false));
  it("uuid text", () => expect(isTenantId("b485d697-af00-47ac-938d-56792f0af0c5")).toBe(true));
});

describe("isNameWithLocationDescriptor", () => {
  it("undefined", () => expect(hasNameAndLocation(undefined)).toBe(false));
  it("null", () => expect(hasNameAndLocation(null)).toBe(false));
  it("text", () => expect(hasNameAndLocation("centralus")).toBe(false));
  it("empty", () => expect(hasNameAndLocation({})).toBe(false));
  it("just name", () => expect(hasNameAndLocation({ name: "foo" })).toBe(false));
  it("just location", () => expect(hasNameAndLocation({ location: "eastus2" })).toBe(false));
  it("name and location", () => expect(hasNameAndLocation({ name: "foo", location: "eastus2" })).toBe(true));
});
