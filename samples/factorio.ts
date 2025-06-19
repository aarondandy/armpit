import path from "node:path";
import { az, NameHash } from "armpit";
import { loadMyEnvironment, loadState, saveState } from "./utils/state.js";
import type {
  Subnet,
  VirtualNetwork,
  ApplicationSecurityGroup,
  PublicIPAddress,
  NetworkInterface,
} from "@azure/arm-network";
import type {
  Disk,
  VirtualMachine,
  VirtualMachineExtension,
  RunCommandResult,
} from "@azure/arm-compute";

// --------------------------
// Environment & Subscription
// --------------------------

const targetEnvironment = await loadMyEnvironment("samples");
const targetLocation = targetEnvironment.defaultLocation ?? "centralus";
await az.account.setOrLogin(targetEnvironment);
const state = await loadState<{serverName?: string}>();

const myIp = fetch("https://api.ipify.org/").then(r => r.text());

// --------------
// Resource Group
// --------------

const rg = await az.group(`videogames-${targetLocation}`, targetLocation);
const resourceHash = new NameHash(targetEnvironment.subscriptionId).concat(rg.name);

// -------
// Network
// -------

const asgs = {
  ssh: rg<ApplicationSecurityGroup>`network asg create -n asg-ssh`,
  factorio: rg<ApplicationSecurityGroup>`network asg create -n asg-factorio`
}

const nsg = (async () => await rg.nsg(`nsg-videogames-${rg.location}`, {
  rules: [
    {
      name: "FactoryMustGrow",
      direction: "Inbound", priority: 200,
      access: "Allow", protocol: "Udp",
      destinationApplicationSecurityGroups: [await asgs.factorio],
      destinationPortRange: "34197",
    },
    {
      name: "ManageFromWorkstation",
      direction: "Inbound", priority: 1000,
      access: "Allow", protocol: "Tcp",
      sourceAddressPrefix: await myIp,
      destinationApplicationSecurityGroups: [await asgs.ssh],
      destinationPortRange: "22",
    }
  ]
}))();
nsg.then(nsg => console.log(`[net] nsg ${nsg.name}`));

const vnet = rg<VirtualNetwork>`network vnet create -n vnet-videogames-${rg.location} --address-prefixes 10.64.0.0/16`;
vnet.then(vnet => console.log(`[net] vnet ${vnet.name} ${vnet.addressSpace?.addressPrefixes?.[0]}`));

const subnets = (async () => {
  const { id: nsgId } = await nsg;
  const { name: vnetName, addressSpace } = await vnet;
  const getPrefix = (octet: number) => addressSpace!.addressPrefixes![0].replace(/\d+\.\d+\/\d+$/, `${octet}.0/24`);
  const buildSubnet = (name: string, octet: number) => rg<Subnet>`network vnet subnet create
    -n ${name} --address-prefix ${getPrefix(octet)}
    --vnet-name ${vnetName} --network-security-group ${nsgId}`;
  // Subnets must be defined in sequence, not in parallel
  return {
    default: await buildSubnet("default", 0),
    vms: await buildSubnet("vms", 8),
  };
})();
subnets.then(subnets => console.log(`[net] subnets ${Object.keys(subnets)}`));

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

const nic = rg<NetworkInterface>`network nic create -n nic-${state.serverName}
  --subnet ${(await subnets).vms.id} --public-ip-address ${(await pip).id}
  --network-security-group ${(await nsg).id} --asgs ${(await Promise.all([asgs.ssh, asgs.factorio])).map(asg => asg.name)}`;
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
  const { userPrincipalName } = await az<any>`ad signed-in-user show`; // TODO: move into az.account or something and/or get types for it
  await az`role assignment create --assignee ${userPrincipalName} --role ${"Virtual Machine Administrator Login"} --scope ${(await vm).id}`;
  console.log(`[vm] admin ${userPrincipalName} added to ${(await vm).name}`);
})();
const vmExtensions = (async () => {
  await rg<VirtualMachineExtension>`vm extension set --vm-name ${(await vm).name} --name AADSSHLoginForLinux --publisher Microsoft.Azure.ActiveDirectory`;
  console.log("[vm] extension AADSSHLoginForLinux installed");
})();
const vmConfig = (async () => {
  const scriptPath = path.join(import.meta.dirname, "factorio.init.sh");
  const result = await rg<RunCommandResult>`vm run-command invoke --command-id RunShellScript -n ${(await vm).name} --scripts ${"@" + scriptPath}`;
  console.log(`[vm] init script status: ${result.value?.map(s => s.displayStatus)}`);
})();

await Promise.all([
  vmAuth,
  vmExtensions,
  vmConfig,
]);

console.log(`
The server is ready and the factory must grow.
Connect: ${(await pip).dnsSettings?.fqdn} (${(await pip).ipAddress})
Admin: az ssh vm -n ${(await vm).name} -g ${rg.name}
`);
