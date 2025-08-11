import path from "node:path";
import { az, NameHash, type VirtualMachineCreateResult } from "armpit";
import { loadMyEnvironment, loadState, saveState } from "./utils/state.js";
import type { NetworkInterface } from "@azure/arm-network";
import type { Disk, VirtualMachineExtension, RunCommandResult } from "@azure/arm-compute";

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

const asgs = rg.network.asgMultiUpsert({
  ssh: "asg-ssh",
  factorio: "asg-factorio",
});

const nsg = (async () =>
  rg.network.nsgUpsert(`nsg-videogames-${rg.location}`, {
    securityRules: [
      {
        name: "FactoryMustGrow",
        direction: "Inbound",
        priority: 200,
        access: "Allow",
        protocol: "Udp",
        destinationApplicationSecurityGroups: [(await asgs).factorio],
        destinationPortRange: "34197",
      },
      {
        name: "ManageFromWorkstation",
        direction: "Inbound",
        priority: 1000,
        access: "Allow",
        protocol: "Tcp",
        sourceAddressPrefix: await myIp,
        destinationApplicationSecurityGroups: [(await asgs).ssh],
        destinationPortRange: "22",
      },
    ],
  }))();
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

const pip = rg.network.pipUpsert(`pip-${state.serverName}`, {
  dnsSettings: { domainNameLabel: state.serverName },
  publicIPAllocationMethod: "Static",
  sku: "Basic",
});
pip.then(pip => console.log(`[vm] public ip ${pip.dnsSettings?.fqdn} (${pip.ipAddress})`));

const nic = (async () => {
  const nicAsgNames = Object.entries(await asgs).flatMap(x => (["ssh", "factorio"].includes(x[0]) ? [x[1].name] : []));
  return rg<NetworkInterface>`network nic create -n vm-${state.serverName}-nic
  --subnet ${(await subnetVms).id} --public-ip-address ${(await pip).name}
  --network-security-group ${(await nsg).name} --asgs ${nicAsgNames}`;
})();
nic.then(nic => console.log(`[vm] nic ${nic.ipConfigurations?.[0]?.privateIPAddress}`));

const osDisk = rg<Disk>`disk create -n vm-${state.serverName}-os
  --hyper-v-generation V2
  --os-type Linux --image-reference Canonical:ubuntu-24_04-lts:server:latest
  --sku Premium_LRS --size-gb 32`;
osDisk.then(d => console.log(`[vm] disk ${d.name}`));

const vm = await (async () => {
  const name = `vm-${state.serverName}`;
  const vmResult = await rg<VirtualMachineCreateResult>`vm create
    -n ${name} --computer-name ${state.serverName}
    --size Standard_D2als_v6 --nics ${(await nic).id}
    --attach-os-disk ${(await osDisk).name} --os-type linux
    --assign-identity [system]`;
  console.log(`[vm] server ${name}`);
  return { name, ...vmResult };
})();

await Promise.all([
  (async () => {
    await rg<VirtualMachineExtension>`vm extension set --vm-name ${vm.name} --name AADSSHLoginForLinux --publisher Microsoft.Azure.ActiveDirectory`;
    await az`role assignment create --assignee ${myUser.userPrincipalName} --role ${"Virtual Machine Administrator Login"} --scope ${vm.id}`;
    console.log(`[vm] user ${myUser.userPrincipalName} can SSH into ${vm.name}`);
  })(),
  (async () => {
    const scriptPath = path.join(import.meta.dirname, "factorio.init.sh");
    const result =
      await rg<RunCommandResult>`vm run-command invoke --command-id RunShellScript -n ${vm.name} --scripts ${"@" + scriptPath}`;
    console.log(`[vm] init script status: ${result.value?.map(s => s.displayStatus)}`);
  })(),
]);

console.log(`
The server is ready and the factory must grow.
Connect: ${vm.fqdns} (${vm.publicIpAddress})
Admin: az ssh vm -n ${vm.name} -g ${vm.resourceGroup}
`);
