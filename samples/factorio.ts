import {
  az,
  NameHash,
  type VirtualNetworkCreateResult,
  type PublicIPAddressCreateResult,
  type NetworkInterfaceCreateResult,
  type NetworkSecurityGroupCreateResult,
} from "armpit";
import type { Subnet, VirtualNetwork, ApplicationSecurityGroup } from "@azure/arm-network";
import type {
  VirtualMachinesCreateOrUpdateResponse,
  VirtualMachine,
  Disk,
  VirtualMachineExtension } from "@azure/arm-compute";
import { loadMyEnvironment, loadState, saveState } from "./utils/state.js";

// Environment & Subscription
const targetEnvironment = await loadMyEnvironment("samples");
const targetLocation = "westus2";
await az.account.setOrLogin(targetEnvironment);
const subHash = new NameHash(targetEnvironment.subscriptionId);
const state = await loadState<{serverName: string | null | undefined}>();

// Resource Group
const rg = await az.group(`videogames-${targetLocation}`, targetLocation);
const rgHash = subHash.concat(rg.name);

// Network
const asgFactorio = rg<ApplicationSecurityGroup>`network asg create -n asg-factorio`
  .then(asg => {
    console.log(`[net] asg ${asg.name}`);
    return asg;
  });
const asgSsh = rg<ApplicationSecurityGroup>`network asg create -n asg-ssh`
  .then(asg => {
    console.log(`[net] asg ${asg.name}`);
    return asg;
  });
const asgRdp = rg<ApplicationSecurityGroup>`network asg create -n asg-rdp`
  .then(asg => {
    console.log(`[net] asg ${asg.name}`);
    return asg;
  });
const nsg = (async () => {
  // TODO: this causes the rules to get reset
  const nsg = await rg<NetworkSecurityGroupCreateResult>`network nsg create -n nsg-videogames-${rg.location}`
    .then(r => r.NewNSG); // TODO: find a better way than "then"
  console.log(`[net] nsg ${nsg.name}`);
  return nsg;
})();

let vnet = rg<VirtualNetworkCreateResult>`network vnet create
  -n vnet-videogames-${rg.location}
  --address-prefixes 10.64.0.0/16`
  .then(r => r.newVNet) // TODO: find a better way than "then"
  .then(vnet => {
    console.log(`[net] vnet ${vnet.name} ${vnet.addressSpace?.addressPrefixes?.[0]}`);
    return vnet;
  });

async function buildSubnet(name: string, n: number, vnet: VirtualNetwork | Promise<VirtualNetwork>) {
  vnet = await vnet;
  const subnetPrefix = vnet.addressSpace!.addressPrefixes![0].replace(/\d+\.\d+\/\d+$/, `${n}.0/24`);
  const subnet = await rg<Subnet>`network vnet subnet create
    -n ${name} --vnet-name ${vnet.name}
    --address-prefix ${subnetPrefix}
    --network-security-group ${(await nsg).id}`;
  console.log(`[net] subnet ${subnet.name} ${subnet.addressPrefix}`);
  return subnet;
}
const subnetDefault = buildSubnet("default", 0, vnet);
const subnetVms = buildSubnet("vms", 8, vnet);

// Server
if (!state.serverName) {
  state.serverName = `factorio-${rgHash}`;
  await saveState(state);
}
const pip = await rg<PublicIPAddressCreateResult>`network public-ip create
  -n pip-${state.serverName} --dns-name ${state.serverName}
  --allocation-method static --sku standard`
  .then(r => r.publicIp); // TODO: find a better way than "then"
console.log(`[vm] public ip ${pip.dnsSettings?.fqdn} (${pip.ipAddress})`);

const nic = await rg<NetworkInterfaceCreateResult>`network nic create
  -n nic-${state.serverName}
  --subnet ${(await subnetVms).id} --public-ip-address ${pip.id}
  --network-security-group ${(await nsg).id}
  --asgs ${[(await asgSsh).name, (await asgRdp).name, (await asgFactorio).name]}`
  .then(r => r.NewNIC); // TODO: find a better way than "then"
console.log(`[vm] nic ${nic.ipConfigurations?.[0]?.privateIPAddress}`);

// TODO: Where the hell is this stuff defined? I don't see anything matching the shape in arm-compute.
type VirtualMachineCreateResult = {
  fqdns: string,
  id: string,
  location: string,
  macAddress: string,
  powerState: string,
  privateIpAddress: string,
  publicIpAddress: string,
  resourceGroup: string,
  zones: string
};

const osDisk = await rg<Disk>`disk create
  -n osdisk-${state.serverName}
  --hyper-v-generation V2
  --os-type Linux
  --image-reference Canonical:ubuntu-24_04-lts:server:latest
  --sku Premium_LRS --size-gb 64`;
console.log(`[vm] os disk ${osDisk.name}`);

const vmName = `vm-${state.serverName}`; // TODO: it would be better to get this from the vm variable
const vm = await rg<VirtualMachineCreateResult>`vm create
  -n ${vmName} --computer-name ${state.serverName}
  --size Standard_D2als_v6
  --nics ${nic.id}
  --attach-os-disk ${osDisk.name} --os-type Linux
  --assign-identity [system]`;
  // TOOD: osDisk
  // TODO: use new premium disks
  // TODO: base os image should be small
  // TODO: see if we can get a smaller disk size to save a buck
  // TODO: make sure we don't pave the machine on each invocation
  // TODO: use keyvault for the admin credentials (shit, that requires a keyvault)
  // TODO: make sure to set patch mode to Manual because video games!
  // TODO: can entra auth be configured instead? Default password user is .\azureuser
console.log(`[vm] server ${vm.fqdns} ${vm.publicIpAddress}`);

rg<VirtualMachineExtension>`vm extension set --vm-name ${vmName} --name AADSSHLoginForLinux --publisher Microsoft.Azure.ActiveDirectory`;

const me = await az`ad signed-in-user show`; // TODO: move into az.account or something and/or get types for it
await az`role assignment create --assignee ${me.userPrincipalName} --role ${"Virtual Machine User Login"} --scope ${vm.id}`;

// TODO: Add tags to this example
