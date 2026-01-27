import { az, NameHash } from "armpit";
import { loadMyEnvironment } from "./utils/state.js";

// --------------------------
// Environment & Subscription
// --------------------------

const tags = { env: "samples", script: import.meta.url.split("/").pop()! } as const;
const targetEnvironment = await loadMyEnvironment("samples");
const targetLocation = targetEnvironment.defaultLocation ?? "centralus";
await az.account.setOrLogin(targetEnvironment);

const myIp = fetch("https://api.ipify.org/").then(r => r.text());

const rg = await az.group(`samples-${targetLocation}`, targetLocation, { tags });
const resourceHash = new NameHash(targetEnvironment.subscriptionId, rg.name, { defaultLength: 6 });

// -------
// Network
// -------

const network = (async () => {
  const natIp = rg.network.pipUpsert(`pip-natsample-${rg.location}`, {
    sku: "Standard",
    publicIPAllocationMethod: "Static",
    tags,
  });
  natIp.then(x => console.log(`[net] nat ip ${x.ipAddress}`));

  const nat = natIp.then(natIp =>
    rg.network.natGatewayUpsert(`nat-sample-${rg.location}`, {
      sku: "Standard",
      publicIpAddresses: [natIp],
      tags,
    }),
  );
  nat.then(x => console.log(`[net] nat gateway ${x.name}`));

  const asgJump = await rg.network.asgUpsert(`asg-jump`, { tags });

  const nsg = await rg.network.nsgUpsert(`nsg-sample`, {
    securityRules: [
      {
        name: "WinRemoteDesktop",
        direction: "Inbound",
        priority: 1000,
        access: "Allow",
        protocol: "*",
        sourceAddressPrefix: await myIp,
        destinationApplicationSecurityGroups: [asgJump],
        destinationPortRange: "3389",
      },
    ],
    tags,
  });

  const vnet = await rg.network.vnetUpsert(`vnet-sample-${rg.location}`, {
    addressPrefix: "10.10.0.0/16",
    subnets: [
      {
        name: "jump",
        addressPrefix: "10.10.4.0/24",
        natGateway: await nat,
        networkSecurityGroup: nsg,
      },
    ],
    tags,
  });
  console.log(`[net] vnet ${vnet.name}`);

  return { vnet, natIp: await natIp, nsg, asgJump };
})();

// ---------------
// Virtual Machine
// ---------------

const { vmIp } = await (async () => {
  const vmIp = await rg.network.pipUpsert(`pip-jump-${rg.location}`, {
    sku: "Standard",
    publicIPAllocationMethod: "Static",
    dnsSettings: { domainNameLabel: `jump-sample-${resourceHash}` },
    tags,
  });
  console.log(`[vm] ip ${vmIp.ipAddress}`);

  const { vnet, nsg, asgJump } = await network;

  const nic = await rg.network.nicUpsert(`vm-jump${rg.location}${resourceHash}-nic`, {
    nicType: "Standard",
    networkSecurityGroup: nsg,
    ipConfigurations: [
      {
        name: "ipconfig-vm",
        primary: true,
        privateIPAddress: "10.10.4.10",
        privateIPAllocationMethod: "Static",
        publicIPAddress: vmIp,
        subnet: vnet.subnets?.find(s => s.name === "jump"),
        applicationSecurityGroups: [asgJump],
      },
    ],
    tags,
  });
  console.log(`[vm] nic created ${nic.name}`);

  const vm = await rg.compute.vmUpsert(`vm-jump${rg.location}${resourceHash}`, {
    hardwareProfile: { vmSize: "Standard_B2ls_v2" },
    networkProfile: { networkInterfaces: [nic] },
    osProfile: {
      computerName: `jump${rg.location}`,
      adminUsername: "human",
      adminPassword: "Passw0rd",
      windowsConfiguration: { patchSettings: { patchMode: "AutomaticByPlatform" } },
    },
    storageProfile: {
      imageReference: {
        publisher: "MicrosoftWindowsServer",
        offer: "WindowsServer",
        sku: "2025-datacenter-azure-edition-smalldisk",
        version: "latest",
      },
      osDisk: { name: `vm-jump${rg.location}${resourceHash}-os`, createOption: "FromImage", diskSizeGB: 32 },
    },
    tags,
  });
  console.log(`[vm] vm created ${vm.name}`);
  return { vm, vmIp };
})();

console.log(`
VM and NAT Gateway are ready.
VM IP: ${vmIp.ipAddress}
Egress: ${(await network).natIp.ipAddress}
`);
