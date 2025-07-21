import path from "node:path";
import { az, NameHash } from "armpit";
import { loadMyEnvironment, loadState, saveState } from "./utils/state.js";
import type { ApplicationSecurityGroup, PublicIPAddress, NetworkInterface } from "@azure/arm-network";
import type { Disk, VirtualMachine, VirtualMachineExtension, RunCommandResult } from "@azure/arm-compute";

// --------------------------
// Environment & Subscription
// --------------------------

const targetEnvironment = await loadMyEnvironment("samples");
const targetLocation = targetEnvironment.defaultLocation ?? "centralus";
await az.account.setOrLogin(targetEnvironment);
const state = await loadState<{ serverName?: string }>();

const myIp = fetch("https://api.ipify.org/").then(r => r.text());
const myUser = await az.account.showSignedInUser();

// --------------
// Resource Group
// --------------

const rg = await az.group(`videogames-${targetLocation}`, targetLocation, targetEnvironment.subscriptionId);
const resourceHash = new NameHash(targetEnvironment.subscriptionId).concat(rg.name);

// -------
// Network
// -------

const asgs = {
  ssh: rg<ApplicationSecurityGroup>`network asg create -n asg-ssh`,
  factorio: rg<ApplicationSecurityGroup>`network asg create -n asg-factorio`,
};

const nsg = rg.network.nsgUpsert(`nsg-videogames-${rg.location}`, {
  rules: [
    {
      name: "FactoryMustGrow",
      direction: "Inbound",
      priority: 200,
      access: "Allow",
      protocol: "Udp",
      destinationApplicationSecurityGroups: [await asgs.factorio],
      destinationPortRange: "34197",
    },
    {
      name: "ManageFromWorkstation",
      direction: "Inbound",
      priority: 1000,
      access: "Allow",
      protocol: "Tcp",
      sourceAddressPrefix: await myIp,
      destinationApplicationSecurityGroups: [await asgs.ssh],
      destinationPortRange: "22",
    },
  ],
});
nsg.then(nsg => console.log(`[net] nsg ${nsg.name}`));

const vnet = (async () =>
  rg.network.vnetUpsert(`vnet-videogames-${rg.location}`, {
    addressPrefix: "10.64.0.0/16",
    subnets: [
      {
        name: "default",
        networkSecurityGroup: await nsg,
        addressPrefix: "10.64.0.0/24",
      },
      {
        name: "vms",
        networkSecurityGroup: await nsg,
        addressPrefix: "10.64.8.0/24",
      },
    ],
  }))();
vnet.then(vnet => console.log(`[net] vnet ${vnet.name} ${vnet.addressSpace?.addressPrefixes?.[0]}`));
const subnetVms = vnet.then(vnet => vnet.subnets!.find(s => s.name === "vms")!);

// -------------------
// Server and Services
// -------------------

if (!state.serverName) {
  state.serverName = `factorio-${resourceHash}`;
  await saveState(state);
}

const pip = rg<PublicIPAddress>`network public-ip create
  -n pip-${state.serverName} --dns-name ${state.serverName}
  --allocation-method static --sku standard`;
pip.then(pip => console.log(`[vm] public ip ${pip.dnsSettings?.fqdn} (${pip.ipAddress})`));

const nic = (async () => rg<NetworkInterface>`network nic create -n nic-${state.serverName}
  --subnet ${(await subnetVms).id} --public-ip-address ${(await pip).name}
  --network-security-group ${(await nsg).name} --asgs ${(await asgs.ssh).name} ${(await asgs.factorio).name}`)();
nic.then(nic => console.log(`[vm] nic ${nic.ipConfigurations?.[0]?.privateIPAddress}`));

const osDisk = rg<Disk>`disk create -n os-${state.serverName}
  --hyper-v-generation V2
  --os-type Linux --image-reference Canonical:ubuntu-24_04-lts:server:latest
  --sku Premium_LRS --size-gb 32`;
osDisk.then(d => console.log(`[vm] disk ${d.name}`));

let vm = (async () => {
  const name = `vm-${state.serverName}`;
  await rg`vm create
    -n ${name} --computer-name ${state.serverName}
    --size Standard_D2als_v6 --nics ${(await nic).id}
    --attach-os-disk ${(await osDisk).name} --os-type linux
    --assign-identity [system]`;
  return await rg<VirtualMachine>`vm show -n ${name}`;
})();
vm.then(vm => console.log(`[vm] server ${vm.name}`));

const vmAuth = (async () => {
  await az`role assignment create --assignee ${myUser.userPrincipalName} --role ${"Virtual Machine Administrator Login"} --scope ${(await vm).id}`;
  console.log(`[vm] admin ${myUser.userPrincipalName} added to ${(await vm).name}`);
})();
const vmExtensions = (async () => {
  await rg<VirtualMachineExtension>`vm extension set --vm-name ${(await vm).name} --name AADSSHLoginForLinux --publisher Microsoft.Azure.ActiveDirectory`;
  console.log("[vm] extension AADSSHLoginForLinux installed");
})();
const vmConfig = (async () => {
  const scriptPath = path.join(import.meta.dirname, "factorio.init.sh");
  const result =
    await rg<RunCommandResult>`vm run-command invoke --command-id RunShellScript -n ${(await vm).name} --scripts ${"@" + scriptPath}`;
  console.log(`[vm] init script status: ${result.value?.map(s => s.displayStatus)}`);
})();

await Promise.all([vmAuth, vmExtensions, vmConfig]);

console.log(`
The server is ready and the factory must grow.
Connect: ${(await pip).dnsSettings?.fqdn} (${(await pip).ipAddress})
Admin: az ssh vm -n ${(await vm).name} -g ${rg.name}
`);
