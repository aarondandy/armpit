import { describe, it, expect } from "vitest";
import {
  isSubscriptionId,
  isSubscriptionIdOrName,
  isTenantId,
  hasNameAndLocation,
  locationNameOrCodeEquals,
} from "./azureUtils.js";

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

describe("locationNameNormalization", () => {
  const rawData = [
    "East US (eastus)",
    "West US 2 (westus2)",
    "West US 3 (westus3)",
    "Australia East (australiaeast)",
    "Southeast Asia (southeastasia)",
    "North Europe (northeurope)",
    "Sweden Central (swedencentral)",
    "UK South (uksouth)",
    "West Europe (westeurope)",
    "Central US (centralus)",
    "South Africa North (southafricanorth)",
    "Central India (centralindia)",
    "East Asia (eastasia)",
    "Indonesia Central (indonesiacentral)",
    "Japan East (japaneast)",
    "Japan West (japanwest)",
    "Korea Central (koreacentral)",
    "Malaysia West (malaysiawest)",
    "New Zealand North (newzealandnorth)",
    "Canada Central (canadacentral)",
    "Austria East (austriaeast)",
    "France Central (francecentral)",
    "Germany West Central (germanywestcentral)",
    "Italy North (italynorth)",
    "Norway East (norwayeast)",
    "Poland Central (polandcentral)",
    "Spain Central (spaincentral)",
    "Switzerland North (switzerlandnorth)",
    "Mexico Central (mexicocentral)",
    "UAE North (uaenorth)",
    "Brazil South (brazilsouth)",
    "Chile Central (chilecentral)",
    "East US 2 EUAP (eastus2euap)",
    "Israel Central (israelcentral)",
    "Qatar Central (qatarcentral)",
    "East US 2 (eastus2)",
    "East US STG (eastusstg)",
    "South Central US (southcentralus)",
    "North Central US (northcentralus)",
    "West US (westus)",
    "East US STG (eastusstg)",
    "South Central US (southcentralus)",
    "North Central US (northcentralus)",
    "West US (westus)",
    "South Central US (southcentralus)",
    "North Central US (northcentralus)",
    "West US (westus)",
    "North Central US (northcentralus)",
    "West US (westus)",
    "West US (westus)",
    "Jio India West (jioindiawest)",
    "Jio India West (jioindiawest)",
    "Central US EUAP (centraluseuap)",
    "Central US EUAP (centraluseuap)",
    "South Central US STG (southcentralusstg)",
    "South Central US STG (southcentralusstg)",
    "West Central US (westcentralus)",
    "West Central US (westcentralus)",
    "South Africa West (southafricawest)",
    "South Africa West (southafricawest)",
    "Australia Central (australiacentral)",
    "Australia Central 2 (australiacentral2)",
    "Australia Southeast (australiasoutheast)",
    "Jio India Central (jioindiacentral)",
    "Korea South (koreasouth)",
    "South India (southindia)",
    "West India (westindia)",
    "Canada East (canadaeast)",
    "France South (francesouth)",
    "Germany North (germanynorth)",
    "Norway West (norwaywest)",
    "Switzerland West (switzerlandwest)",
    "UK West (ukwest)",
    "UAE Central (uaecentral)",
    "Brazil Southeast (brazilsoutheast)",
  ];
  const data = rawData.map(x => {
    const match = x.match(/(.+)\((.+)\)/);
    return { name: match![1], code: match![2] };
  });

  for (const a of data) {
    const name = a.name;
    const code = a.code;
    const others = data.filter(d => d.code != a.code);
    it(`name ${name} self matches code ${code}`, () => expect(locationNameOrCodeEquals(name, code)).toBeTruthy());
    it(`code ${code} self matches name ${name}`, () => expect(locationNameOrCodeEquals(code, name)).toBeTruthy());
    it(`name ${name} doesn't match others`, () =>
      expect(others.filter(x => locationNameOrCodeEquals(x.name, name))).toHaveLength(0));
    it(`code ${code} doesn't match others`, () =>
      expect(others.filter(x => locationNameOrCodeEquals(x.code, code))).toHaveLength(0));
  }
});
