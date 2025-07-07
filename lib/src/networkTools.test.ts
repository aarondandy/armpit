import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import {
  NetworkManagementClient,
  type NetworkSecurityGroup,
  type VirtualNetwork
} from "@azure/arm-network";
import { constructId } from "./azureUtils.js";
import { ManagementClientFactory } from "./azureSdkUtils.js";
import { NetworkTools } from "./networkTools.js";

describe("upsert nsg", () => {

  const subscriptionId = "41a80a8e-6547-414a-9d34-ecfbc0f7728d";
  const groupName = "stuff";
  const nsgName = "nsg";
  const networkClient = new NetworkManagementClient(null!, subscriptionId);
  const clientFactory = new ManagementClientFactory(null!);

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(clientFactory, "get").mockImplementation(() => networkClient);
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  const strictMock = vi.fn();
  const laxMock = vi.fn();
  const fakeInvoker = {
    strict: strictMock,
    lax: laxMock,
  };

  it("can create via SDK", async () => {
    const tools = new NetworkTools(fakeInvoker, clientFactory, { groupName, subscriptionId });
    vi.spyOn(networkClient.networkSecurityGroups, "get").mockResolvedValue(null!);
    vi.spyOn(networkClient.networkSecurityGroups, "beginCreateOrUpdateAndWait").mockResolvedValue({
      id: constructId(subscriptionId, groupName, "Microsoft.Network/networkSecurityGroups", nsgName),
      name: nsgName,
      location: "centralus",
    });

    const result = await tools.nsgUpsert("nsg");

    expect(result).toBeTruthy();
    expect(result.name).toBe(nsgName);
    expect(result.location).toBe("centralus");
    expect(networkClient.networkSecurityGroups.beginCreateOrUpdateAndWait).toHaveBeenCalledExactlyOnceWith(
      groupName,
      nsgName,
      {
        name: nsgName
      }
    );
  });

  it("can no-op via SDK", async () => {
    const tools = new NetworkTools(fakeInvoker, clientFactory, { groupName, subscriptionId });
    vi.spyOn(networkClient.networkSecurityGroups, "get").mockResolvedValue({
      id: constructId(subscriptionId, groupName, "Microsoft.Network/networkSecurityGroups", nsgName),
      name: nsgName,
      location: "centralus",
    });
    vi.spyOn(networkClient.networkSecurityGroups, "beginCreateOrUpdateAndWait");

    const result = await tools.nsgUpsert("nsg");

    expect(result).toBeTruthy();
    expect(result.name).toBe(nsgName);
    expect(result.location).toBe("centralus");
    expect(networkClient.networkSecurityGroups.get).toHaveBeenCalledExactlyOnceWith(groupName, nsgName);
    expect(networkClient.networkSecurityGroups.beginCreateOrUpdateAndWait).not.toBeCalled();
  });

});
