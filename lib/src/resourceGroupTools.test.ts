import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { ResourceManagementClient, type ResourceGroup } from "@azure/arm-resources";
import { constructId } from "./azureUtils.js";
import { ManagementClientFactory } from "./azureSdkUtils.js";
import { ResourceGroupTools } from "./resourceGroupTools.js";

describe("upsert group", () => {

  const subscriptionId = "41a80a8e-6547-414a-9d34-ecfbc0f7728d";
  const resourceClient = new ResourceManagementClient(null!, subscriptionId);
  const clientFactory = new ManagementClientFactory(null!);

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(clientFactory, "get").mockImplementation(() => resourceClient);
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

  const sharedDependencies = {
    invoker: fakeInvoker,
    credentialFactory: null!,
    managementClientFactory: clientFactory,
  }

  it("can create group via CLI without set subscription", async () => {
    const tools  = new ResourceGroupTools(sharedDependencies, { });
    laxMock.mockResolvedValueOnce(null); // the get
    strictMock.mockResolvedValueOnce({
      id: constructId(subscriptionId, "stuff"),
      name: "stuff",
      location: "centralus",
    } as ResourceGroup); // the create

    const result = await tools("stuff", "centralus");

    expect(result).toBeTruthy();
    expect(result.name).toBe("stuff");
    expect(result.location).toBe("centralus");
    expect(result.subscriptionId).toBe(subscriptionId);
    expect(laxMock).toHaveBeenCalledExactlyOnceWith`group show --name ${"stuff"}`;
    expect(strictMock).toHaveBeenCalledExactlyOnceWith`group create --name ${"stuff"} --location ${"centralus"}`;
  });

  it("can no-op via CLI without set subscription", async () => {
    const tools  = new ResourceGroupTools(sharedDependencies, { });
    laxMock.mockResolvedValueOnce({
      id: constructId(subscriptionId, "stuff"),
      name: "stuff",
      location: "centralus",
    } as ResourceGroup); // the get

    const result = await tools("stuff", "centralus");

    expect(result).toBeTruthy();
    expect(result.name).toBe("stuff");
    expect(result.location).toBe("centralus");
    expect(result.subscriptionId).toBe(subscriptionId);
    expect(laxMock).toHaveBeenCalledExactlyOnceWith`group show --name ${"stuff"}`;
    expect(strictMock).not.toHaveBeenCalled();
  });

  it("can create via SDK when subscription is known", async () => {
    vi.spyOn(resourceClient.resourceGroups, "get").mockResolvedValue(null!);
    vi.spyOn(resourceClient.resourceGroups, "createOrUpdate").mockResolvedValue({
      id: constructId(subscriptionId, "stuff"),
      name: "stuff",
      location: "centralus",
    });
    const tools = new ResourceGroupTools(sharedDependencies, { });

    const result = await tools("stuff", "centralus", subscriptionId);

    expect(result).toBeTruthy();
    expect(result.name).toBe("stuff");
    expect(result.location).toBe("centralus");
    expect(result.subscriptionId).toBe(subscriptionId);
    expect(resourceClient.resourceGroups.get).toHaveBeenCalledExactlyOnceWith(
      "stuff",
      expect.anything()
    );
    expect(resourceClient.resourceGroups.createOrUpdate).toHaveBeenCalledOnce()
  });

  it("can no-op via SDK when subscription is known and group exists", async () => {
    vi.spyOn(resourceClient.resourceGroups, "get").mockResolvedValue({
      id: constructId(subscriptionId, "stuff"),
      name: "stuff",
      location: "centralus",
    });
    vi.spyOn(resourceClient.resourceGroups, "createOrUpdate");
    const tools = new ResourceGroupTools(sharedDependencies, { });

    const result = await tools("stuff", "centralus", subscriptionId);

    expect(result).toBeTruthy();
    expect(result.name).toBe("stuff");
    expect(result.location).toBe("centralus");
    expect(result.subscriptionId).toBe(subscriptionId);
    expect(resourceClient.resourceGroups.get).toHaveBeenCalledExactlyOnceWith(
      "stuff",
      expect.anything()
    );
    expect(resourceClient.resourceGroups.createOrUpdate).not.toHaveBeenCalled()
  });

  it("location conflict throws", async () => {
    vi.spyOn(resourceClient.resourceGroups, "get").mockResolvedValue({
      id: constructId(subscriptionId, "stuff"),
      name: "stuff",
      location: "centralus",
    });
    vi.spyOn(resourceClient.resourceGroups, "createOrUpdate");
    const tools = new ResourceGroupTools(sharedDependencies, { });

    await expect(() => tools("stuff", "eastus", subscriptionId)).rejects.toThrow(/conflicts with expected location/);

    expect(resourceClient.resourceGroups.get).toHaveBeenCalledExactlyOnceWith(
      "stuff",
      expect.anything()
    );
    expect(resourceClient.resourceGroups.createOrUpdate).not.toHaveBeenCalled()
  });
});
