import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { NetworkManagementClient } from "@azure/arm-network";
import { PrivateDnsManagementClient } from "@azure/arm-privatedns";
import { constructId } from "./azureUtils.js";
import { ManagementClientFactory } from "./azureSdkUtils.js";
import { NetworkTools } from "./networkTools.js";

describe("upsert vnet", () => {
  const subscriptionId = "41a80a8e-6547-414a-9d34-ecfbc0f7728d";
  const groupName = "stuff";
  const location = "centralus";
  const vnetName = "vnet";
  const toolOptions = { groupName, location, subscriptionId };
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

  const sharedDependencies = {
    invoker: fakeInvoker,
    managementClientFactory: clientFactory,
  }

  it("can create when not found", async () => {
    const tools = new NetworkTools(sharedDependencies, toolOptions);
    vi.spyOn(networkClient.virtualNetworks, "get").mockResolvedValue(null!);
    vi.spyOn(networkClient.virtualNetworks, "beginCreateOrUpdateAndWait").mockImplementationOnce((groupName, name, vnet) => Promise.resolve({
      ...vnet,
      id: constructId(subscriptionId, groupName, "Microsoft.Network/virtualNetworks", name),
      name,
    }));

    const result = await tools.vnetUpsert(vnetName, {
      addressPrefix: "10.11.0.0/16",
    });

    expect(result).toBeTruthy();
    expect(result.name).toBe(vnetName);
    expect(result.location).toBe(location);
    expect(networkClient.virtualNetworks.beginCreateOrUpdateAndWait).toHaveBeenCalledExactlyOnceWith(
      groupName,
      vnetName,
      {
        name: vnetName,
        location,
        addressSpace: {
          addressPrefixes: ["10.11.0.0/16"],
        }
      },
      expect.anything()
    );
  });

  it("can update existing", async () => {
    const tools = new NetworkTools(sharedDependencies, toolOptions);
    vi.spyOn(networkClient.virtualNetworks, "get").mockResolvedValue({
      name: vnetName,
        location,
        addressSpace: {
          addressPrefixes: ["10.22.0.0/16"],
        }
    });
    vi.spyOn(networkClient.virtualNetworks, "beginCreateOrUpdateAndWait").mockImplementationOnce((groupName, name, vnet) => Promise.resolve({
      ...vnet,
      id: constructId(subscriptionId, groupName, "Microsoft.Network/virtualNetworks", name),
      name,
    }));

    const result = await tools.vnetUpsert(vnetName, {
      addressPrefix: "10.10.0.0/16",
    });

    expect(result).toBeTruthy();
    expect(result.name).toBe(vnetName);
    expect(result.location).toBe(location);
    expect(result.addressSpace?.addressPrefixes?.at(0)).toBe("10.10.0.0/16");
    expect(networkClient.virtualNetworks.beginCreateOrUpdateAndWait).toHaveBeenCalledExactlyOnceWith(
      groupName,
      vnetName,
      {
        name: vnetName,
        location,
        addressSpace: {
          addressPrefixes: ["10.10.0.0/16"],
        }
      },
      expect.anything()
    );
  });

  it("can create with subnet", async () => {
    const tools = new NetworkTools(sharedDependencies, toolOptions);
    vi.spyOn(networkClient.virtualNetworks, "get").mockResolvedValue(null!);
    vi.spyOn(networkClient.virtualNetworks, "beginCreateOrUpdateAndWait").mockImplementationOnce((groupName, name, vnet) => Promise.resolve({
      ...vnet,
      id: constructId(subscriptionId, groupName, "Microsoft.Network/virtualNetworks", name),
      name,
    }));

    const result = await tools.vnetUpsert(vnetName, {
      addressPrefix: "10.10.0.0/16",
      subnets: [
        {
          name: "stuff",
          addressPrefix: "10.10.10.0/24",
        }
      ]
    });

    expect(result).toBeTruthy();
    expect(result.name).toBe(vnetName);
    expect(result.location).toBe(location);
    expect(networkClient.virtualNetworks.beginCreateOrUpdateAndWait).toHaveBeenCalledExactlyOnceWith(
      groupName,
      vnetName,
      {
        name: vnetName,
        location,
        addressSpace: {
          addressPrefixes: ["10.10.0.0/16"],
        },
        subnets: [
          {
            name: "stuff",
            addressPrefix: "10.10.10.0/24",
          }
        ]
      },
      expect.anything()
    );
  });

  it("can update adding new subnet", async () => {
    const tools = new NetworkTools(sharedDependencies, toolOptions);
    vi.spyOn(networkClient.virtualNetworks, "get").mockResolvedValue({
      name: vnetName,
      location,
      addressSpace: {
        addressPrefixes: ["10.10.0.0/16"],
      },
      subnets: [],
    });
    vi.spyOn(networkClient.virtualNetworks, "beginCreateOrUpdateAndWait").mockImplementationOnce((groupName, name, vnet) => Promise.resolve({
      ...vnet,
      id: constructId(subscriptionId, groupName, "Microsoft.Network/virtualNetworks", name),
      name,
    }));

    const result = await tools.vnetUpsert(vnetName, {
      addressPrefix: "10.10.0.0/16",
      subnets: [
        {
          name: "stuff",
          addressPrefix: "10.10.10.0/24",
        }
      ]
    });

    expect(result).toBeTruthy();
    expect(result.name).toBe(vnetName);
    expect(result.location).toBe(location);
    expect(networkClient.virtualNetworks.beginCreateOrUpdateAndWait).toHaveBeenCalledExactlyOnceWith(
      groupName,
      vnetName,
      {
        name: vnetName,
        location,
        addressSpace: {
          addressPrefixes: ["10.10.0.0/16"],
        },
        subnets: [
          {
            name: "stuff",
            addressPrefix: "10.10.10.0/24",
          }
        ]
      },
      expect.anything()
    );
  });

  it("can add new subnet preserving existing", async () => {
    const tools = new NetworkTools(sharedDependencies, toolOptions);
    vi.spyOn(networkClient.virtualNetworks, "get").mockResolvedValue({
      name: vnetName,
      location,
      addressSpace: {
        addressPrefixes: ["10.10.0.0/16"],
      },
      subnets: [
        {
          name: "stuff",
          addressPrefix: "10.10.10.0/24",
        }
      ],
    });
    vi.spyOn(networkClient.virtualNetworks, "beginCreateOrUpdateAndWait").mockImplementationOnce((groupName, name, vnet) => Promise.resolve({
      ...vnet,
      id: constructId(subscriptionId, groupName, "Microsoft.Network/virtualNetworks", name),
      name,
    }));

    const result = await tools.vnetUpsert(vnetName, {
      addressPrefix: "10.10.0.0/16",
      subnets: [
        {
          name: "new-stuff",
          addressPrefix: "10.10.20.0/24",
        }
      ]
    });

    expect(result).toBeTruthy();
    expect(result.name).toBe(vnetName);
    expect(result.location).toBe(location);
    expect(networkClient.virtualNetworks.beginCreateOrUpdateAndWait).toHaveBeenCalledExactlyOnceWith(
      groupName,
      vnetName,
      {
        name: vnetName,
        location,
        addressSpace: {
          addressPrefixes: ["10.10.0.0/16"],
        },
        subnets: [
          {
            name: "stuff",
            addressPrefix: "10.10.10.0/24",
          },
          {
            name: "new-stuff",
            addressPrefix: "10.10.20.0/24",
          }
        ]
      },
      expect.anything()
    );
  });

  it("can add new subnet replacing existing", async () => {
    const tools = new NetworkTools(sharedDependencies, toolOptions);
    vi.spyOn(networkClient.virtualNetworks, "get").mockResolvedValue({
      name: vnetName,
      location,
      addressSpace: {
        addressPrefixes: ["10.10.0.0/16"],
      },
      subnets: [
        {
          name: "stuff",
          addressPrefix: "10.10.10.0/24",
        }
      ],
    });
    vi.spyOn(networkClient.virtualNetworks, "beginCreateOrUpdateAndWait").mockImplementationOnce((groupName, name, vnet) => Promise.resolve({
      ...vnet,
      id: constructId(subscriptionId, groupName, "Microsoft.Network/virtualNetworks", name),
      name,
    }));

    const result = await tools.vnetUpsert(vnetName, {
      addressPrefix: "10.10.0.0/16",
      subnets: [
        {
          name: "new-stuff",
          addressPrefix: "10.10.20.0/24",
        }
      ],
      deleteUnknownSubnets: true,
    });

    expect(result).toBeTruthy();
    expect(result.name).toBe(vnetName);
    expect(result.location).toBe(location);
    expect(networkClient.virtualNetworks.beginCreateOrUpdateAndWait).toHaveBeenCalledExactlyOnceWith(
      groupName,
      vnetName,
      {
        name: vnetName,
        location,
        addressSpace: {
          addressPrefixes: ["10.10.0.0/16"],
        },
        subnets: [
          {
            name: "new-stuff",
            addressPrefix: "10.10.20.0/24",
          }
        ]
      },
      expect.anything()
    );
  });

});

describe("upsert nsg", () => {
  const subscriptionId = "41a80a8e-6547-414a-9d34-ecfbc0f7728d";
  const groupName = "stuff";
  const location = "centralus";
  const nsgName = "nsg";
  const toolOptions = { groupName, location, subscriptionId };
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

  const sharedDependencies = {
    invoker: fakeInvoker,
    managementClientFactory: clientFactory,
  }

  it("can create via SDK", async () => {
    const tools = new NetworkTools(sharedDependencies, toolOptions);
    vi.spyOn(networkClient.networkSecurityGroups, "get").mockResolvedValue(null!);
    vi.spyOn(networkClient.networkSecurityGroups, "beginCreateOrUpdateAndWait").mockImplementationOnce((groupName, name, nsg) => Promise.resolve({
      ...nsg,
      id: constructId(subscriptionId, groupName, "Microsoft.Network/networkSecurityGroups", name),
      name,
    }));

    const result = await tools.nsgUpsert(nsgName);

    expect(result).toBeTruthy();
    expect(result.name).toBe(nsgName);
    expect(result.location).toBe(location);
    expect(networkClient.networkSecurityGroups.beginCreateOrUpdateAndWait).toHaveBeenCalledExactlyOnceWith(
      groupName,
      nsgName,
      {
        name: nsgName,
        location,
      },
      expect.anything()
    );
  });

  it("can no-op without rules via SDK", async () => {
    const tools = new NetworkTools(sharedDependencies, toolOptions);
    vi.spyOn(networkClient.networkSecurityGroups, "get").mockResolvedValue({
      id: constructId(subscriptionId, groupName, "Microsoft.Network/networkSecurityGroups", nsgName),
      name: nsgName,
      location,
      securityRules: [],
    });
    vi.spyOn(networkClient.networkSecurityGroups, "beginCreateOrUpdateAndWait");

    const result = await tools.nsgUpsert(nsgName);

    expect(result).toBeTruthy();
    expect(result.name).toBe(nsgName);
    expect(result.location).toBe(location);
    expect(networkClient.networkSecurityGroups.get).toHaveBeenCalledExactlyOnceWith(
      groupName,
      nsgName,
      expect.anything());
    expect(networkClient.networkSecurityGroups.beginCreateOrUpdateAndWait).not.toBeCalled();
  });

  it("can create with rule via SDK", async () => {
    const tools = new NetworkTools(sharedDependencies, toolOptions);
    vi.spyOn(networkClient.networkSecurityGroups, "get").mockResolvedValue(null!);
    vi.spyOn(networkClient.networkSecurityGroups, "beginCreateOrUpdateAndWait").mockImplementationOnce((groupName, name, nsg) => Promise.resolve({
      ...nsg,
      id: constructId(subscriptionId, groupName, "Microsoft.Network/networkSecurityGroups", name),
      name,
    }));

    const result = await tools.nsgUpsert(nsgName, {
      rules: [
        {
          name: "ssh",
          direction: "Inbound", priority: 1000,
          access: "Allow", protocol: "Tcp",
          destinationPortRange: "22",
        }
      ]
    });

    expect(result).toBeTruthy();
    expect(result.name).toBe(nsgName);
    expect(result.location).toBe(location);
    expect(networkClient.networkSecurityGroups.beginCreateOrUpdateAndWait).toHaveBeenCalledExactlyOnceWith(
      groupName,
      nsgName,
      {
        name: nsgName,
        location,
        securityRules: [
          {
            name: "ssh",
            direction: "Inbound", priority: 1000,
            access: "Allow", protocol: "Tcp",
            sourceAddressPrefix: "*", sourcePortRange: "*",
            destinationAddressPrefix: "*", destinationPortRange: "22",
          }
        ]
      },
      expect.anything()
    );
  });

  it("can no-op with no rule changes via SDK", async () => {
    const tools = new NetworkTools(sharedDependencies, toolOptions);
    vi.spyOn(networkClient.networkSecurityGroups, "get").mockResolvedValueOnce({
      id: constructId(subscriptionId, groupName, "Microsoft.Network/networkSecurityGroups", nsgName),
      name: nsgName,
      location: location,
      securityRules: [
        {
          name: "ssh",
          direction: "Inbound", priority: 1000,
          access: "Allow", protocol: "Tcp",
          sourceAddressPrefix: "*", sourcePortRange: "*",
          destinationAddressPrefix: "*", destinationPortRange: "22",
        }
      ]
    });
    vi.spyOn(networkClient.networkSecurityGroups, "beginCreateOrUpdateAndWait").mockRejectedValue(null!);

    const result = await tools.nsgUpsert(nsgName, {
      rules: [
        {
          name: "ssh",
          direction: "Inbound", priority: 1000,
          access: "Allow", protocol: "Tcp",
          destinationPortRange: "22",
        }
      ]
    });

    expect(result).toBeTruthy();
    expect(result.name).toBe(nsgName);
    expect(result.location).toBe(location);
    expect(result.securityRules).toHaveLength(1);
    expect(result.securityRules?.[0]?.name).toBe("ssh");
    expect(networkClient.networkSecurityGroups.beginCreateOrUpdateAndWait).not.toHaveBeenCalled();
  });

  it("can upsert new rule while preserving existing rule via SDK", async () => {
    const tools = new NetworkTools(sharedDependencies, toolOptions);
    vi.spyOn(networkClient.networkSecurityGroups, "get").mockResolvedValueOnce({
      id: constructId(subscriptionId, groupName, "Microsoft.Network/networkSecurityGroups", nsgName),
      name: nsgName,
      location: location,
      securityRules: [
        {
          name: "rdp",
          direction: "Inbound", priority: 1001,
          access: "Allow", protocol: "Tcp",
          sourceAddressPrefix: "*", sourcePortRange: "*",
          destinationAddressPrefix: "*", destinationPortRange: "3389",
        }
      ]
    });
    vi.spyOn(networkClient.networkSecurityGroups, "beginCreateOrUpdateAndWait").mockImplementationOnce((groupName, name, nsg) => Promise.resolve({
      ...nsg,
      id: constructId(subscriptionId, groupName, "Microsoft.Network/networkSecurityGroups", name),
      name,
    }));

    const result = await tools.nsgUpsert(nsgName, {
      rules: [
        {
          name: "ssh",
          direction: "Inbound", priority: 1000,
          access: "Allow", protocol: "Tcp",
          destinationPortRange: "22",
        }
      ],
    });

    expect(result).toBeTruthy();
    expect(result.name).toBe(nsgName);
    expect(result.location).toBe(location);
    expect(result.securityRules).toHaveLength(2);
    expect(networkClient.networkSecurityGroups.beginCreateOrUpdateAndWait).toHaveBeenCalledExactlyOnceWith(
      groupName,
      nsgName,
      {
        id: constructId(subscriptionId, groupName, "Microsoft.Network/networkSecurityGroups", nsgName),
        name: nsgName,
        location,
        securityRules: [
          {
            name: "rdp",
            direction: "Inbound", priority: 1001,
            access: "Allow", protocol: "Tcp",
            sourceAddressPrefix: "*", sourcePortRange: "*",
            destinationAddressPrefix: "*", destinationPortRange: "3389",
          },
          {
            name: "ssh",
            direction: "Inbound", priority: 1000,
            access: "Allow", protocol: "Tcp",
            sourceAddressPrefix: "*", sourcePortRange: "*",
            destinationAddressPrefix: "*", destinationPortRange: "22",
          }
        ]
      },
      expect.anything()
    );
  });

  it("can overwrite new rule and remove existing and unspecified rule via SDK", async () => {
    const tools = new NetworkTools(sharedDependencies, toolOptions);
    vi.spyOn(networkClient.networkSecurityGroups, "get").mockResolvedValueOnce({
      id: constructId(subscriptionId, groupName, "Microsoft.Network/networkSecurityGroups", nsgName),
      name: nsgName,
      location: location,
      securityRules: [
        {
          name: "rdp",
          direction: "Inbound", priority: 1001,
          access: "Allow", protocol: "Tcp",
          sourceAddressPrefix: "*", sourcePortRange: "*",
          destinationAddressPrefix: "*", destinationPortRange: "3389",
        }
      ]
    });
    vi.spyOn(networkClient.networkSecurityGroups, "beginCreateOrUpdateAndWait").mockImplementationOnce((groupName, name, nsg) => Promise.resolve({
      ...nsg,
      id: constructId(subscriptionId, groupName, "Microsoft.Network/networkSecurityGroups", name),
      name,
    }));

    const result = await tools.nsgUpsert(nsgName, {
      rules: [
        {
          name: "ssh",
          direction: "Inbound", priority: 1000,
          access: "Allow", protocol: "Tcp",
          destinationPortRange: "22",
        }
      ],
      deleteUnknownRules: true,
    });

    expect(result).toBeTruthy();
    expect(result.name).toBe(nsgName);
    expect(result.location).toBe(location);
    expect(result.securityRules).toHaveLength(1);
    expect(result.securityRules?.[0]?.name).toBe("ssh");
    expect(networkClient.networkSecurityGroups.beginCreateOrUpdateAndWait).toHaveBeenCalledExactlyOnceWith(
      groupName,
      nsgName,
      {
        id: constructId(subscriptionId, groupName, "Microsoft.Network/networkSecurityGroups", nsgName),
        name: nsgName,
        location,
        securityRules: [
          {
            name: "ssh",
            direction: "Inbound", priority: 1000,
            access: "Allow", protocol: "Tcp",
            sourceAddressPrefix: "*", sourcePortRange: "*",
            destinationAddressPrefix: "*", destinationPortRange: "22",
          }
        ]
      },
      expect.anything()
    );
  });

});

describe("upsert private zone", () => {
  const subscriptionId = "41a80a8e-6547-414a-9d34-ecfbc0f7728d";
  const groupName = "stuff";
  const zoneName = "zone";
  const toolOptions = { groupName, subscriptionId };
  const privateDnsClient = new PrivateDnsManagementClient(null!, subscriptionId);
  const clientFactory = new ManagementClientFactory(null!);

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(clientFactory, "get").mockImplementation(() => privateDnsClient);
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
    managementClientFactory: clientFactory,
  }

  it("can create via SDK", async () => {
    const tools = new NetworkTools(sharedDependencies, toolOptions);
    vi.spyOn(privateDnsClient.privateZones, "get").mockResolvedValue(null!);
    vi.spyOn(privateDnsClient.privateZones, "beginCreateOrUpdateAndWait").mockImplementationOnce((groupName, name, zone) => Promise.resolve({
      ...zone,
      id: constructId(subscriptionId, groupName, "Microsoft.Network/privateDnsZones", name),
      location: "Global",
      name,
    }));

    const result = await tools.privateZoneUpsert(zoneName);

    expect(result).toBeTruthy();
    expect(result.name).toBe(zoneName);
    expect(result.location).toBe("Global");
    expect(privateDnsClient.privateZones.beginCreateOrUpdateAndWait).toHaveBeenCalledExactlyOnceWith(
      groupName,
      zoneName,
      {
        location: "Global",
      },
      expect.anything()
    );
  });

  it("can no-op existing via SDK", async () => {
    const tools = new NetworkTools(sharedDependencies, toolOptions);
    vi.spyOn(privateDnsClient.privateZones, "get").mockResolvedValue({
      id: constructId(subscriptionId, groupName, "Microsoft.Network/privateDnsZones", zoneName),
      location: "Global",
      name: zoneName,
    });
    vi.spyOn(privateDnsClient.privateZones, "beginCreateOrUpdateAndWait");

    const result = await tools.privateZoneUpsert(zoneName);

    expect(result).toBeTruthy();
    expect(result.name).toBe(zoneName);
    expect(result.location).toBe("Global");
    expect(privateDnsClient.privateZones.get).toHaveBeenCalledExactlyOnceWith(
      groupName,
      zoneName,
      expect.anything());
    expect(privateDnsClient.privateZones.beginCreateOrUpdateAndWait).not.toBeCalled();
  });

});
