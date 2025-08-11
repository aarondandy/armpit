import { az, NameHash } from "armpit";
import { loadMyEnvironment } from "./utils/state.js";

// --------------------------
// Environment & Subscription
// --------------------------

const targetEnvironment = await loadMyEnvironment("samples");
const targetLocation = targetEnvironment.defaultLocation ?? "centralus";
await az.account.setOrLogin(targetEnvironment);

const myIp = fetch("https://api.ipify.org/").then(r => r.text());

const rg = await az.group(`samples-${targetLocation}`, targetLocation);
const resourceHash = new NameHash(targetEnvironment.subscriptionId, rg.name, { defaultLength: 6 });

const asgJump = rg.network.asgUpsert(`asg-jump`);

const nsg = rg.network.nsgUpsert(`nsg-sample`, {
  securityRules: [
    {
      name: "WinRemoteDesktop",
      direction: "Inbound",
      priority: 1000,
      access: "Allow",
      protocol: "*",
      sourceAddressPrefix: await myIp,
      destinationApplicationSecurityGroups: [await asgJump],
      destinationPortRange: "3389",
    },
  ],
});

const natIp = rg.network.pipUpsert(`pip-natsample-${rg.location}`, {
  sku: "Standard",
  publicIPAllocationMethod: "Static",
});
natIp.then(x => console.log(`[net] nat ip ${x.ipAddress}`));

const nat = (async () =>
  rg.network.natGatewayUpsert(`nat-sample-${rg.location}`, {
    sku: "Standard",
    publicIpAddresses: [await natIp],
  }))();
nat.then(x => console.log(`[net] nat gateway ${x.name}`));

const vnet = (async () =>
  rg.network.vnetUpsert(`vnet-sample-${rg.location}`, {
    addressPrefix: "10.10.0.0/16",
    subnets: [
      {
        name: "jump",
        addressPrefix: "10.10.4.0/24",
        natGateway: await nat,
        networkSecurityGroup: await nsg,
      },
    ],
  }))();
vnet.then(x => console.log(`[net] vnet ${x.name}`));

const vmIp = rg.network.pipUpsert(`pip-jump-${rg.location}`, {
  sku: "Standard",
  publicIPAllocationMethod: "Static",
  dnsSettings: { domainNameLabel: `jump-sample-${resourceHash}` },
});
vmIp.then(x => console.log(`[vm] ip ${x.ipAddress}`));

const nic = (async () =>
  rg.network.nicUpsert(`vm-jump${rg.location}${resourceHash}-nic`, {
    nicType: "Standard",
    networkSecurityGroup: await nsg,
    ipConfigurations: [
      {
        name: "ipconfig-vm",
        primary: true,
        privateIPAddress: "10.10.4.10",
        privateIPAllocationMethod: "Static",
        publicIPAddress: await vmIp,
        subnet: (await vnet).subnets!.find(s => s.name === "jump")!,
        applicationSecurityGroups: [await asgJump],
      },
    ],
  }))();
nic.then(x => console.log(`[vm] nic created ${x.name}`));

const vm = await rg.compute.vmUpsert(`vm-jump${rg.location}${resourceHash}`, {
  hardwareProfile: { vmSize: "Standard_B2ls_v2" },
  networkProfile: { networkInterfaces: [await nic] },
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
});
console.log(`[vm] vm created ${vm.name}`);

console.log(`
VM and NAT Gateway are ready.
VM IP: ${(await vmIp).ipAddress}
Egress: ${(await natIp).ipAddress}
`);
