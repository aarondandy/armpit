import path from "node:path";
import {
  az,
  NameHash,
  type VirtualNetworkCreateResult,
  type PublicIPAddressCreateResult,
  type NetworkInterfaceCreateResult,
  type NetworkSecurityGroupCreateResult,
} from "armpit";
import type {
  Subnet,
  VirtualNetwork,
  ApplicationSecurityGroup
} from "@azure/arm-network";
import type {
  VirtualMachinesCreateOrUpdateResponse,
  VirtualMachine,
  Disk,
  VirtualMachineExtension,
  InstanceViewStatus,
} from "@azure/arm-compute";
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

const asgs = {
  ssh: rg<ApplicationSecurityGroup>`network asg create -n asg-ssh`,
  factorio: rg<ApplicationSecurityGroup>`network asg create -n asg-factorio`
}

const nsg = (async () => {
  const myIp = fetch("https://api.ipify.org/").then(r => r.text());
  const nsg = await rg<NetworkSecurityGroupCreateResult>`network nsg create -n nsg-videogames-${rg.location}`
    .then(r => r.NewNSG); // TODO: find a better way than "then"

  console.log(`[net] nsg ${nsg.name}`);

  // TODO find a way that doesn't temporarily block things on re-create

  await rg`network nsg rule create
    -n FactoryMustGrow --nsg-name ${nsg.name} --priority 200
    --direction Inbound --access Allow
    --destination-asgs ${(await asgs.factorio).name} --destination-port-ranges 34197 --protocol Udp`

  await rg`network nsg rule create
    -n ManageFromWorkstation --nsg-name ${nsg.name} --priority 1000
    --direction Inbound --access Allow
    --source-address-prefixes ${await myIp}
    --destination-asgs ${(await asgs.ssh).name} --destination-port-ranges 22 --protocol Tcp`;
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

async function buildSubnet(name: string, octet: number) {
  const { name: vnetName, addressSpace } = await vnet;
  const subnetPrefix = addressSpace!.addressPrefixes![0].replace(/\d+\.\d+\/\d+$/, `${octet}.0/24`);
  const subnet = await rg<Subnet>`network vnet subnet create
    -n ${name} --vnet-name ${vnetName}
    --address-prefix ${subnetPrefix}
    --network-security-group ${(await nsg).id}`;
  console.log(`[net] subnet ${subnet.name} ${subnet.addressPrefix}`);
  return subnet;
}
const subnets = {
  default: buildSubnet("default", 0),
  vms: buildSubnet("vms", 8),
};

// Server
if (!state.serverName) {
  state.serverName = `factorio-${rgHash}`;
  await saveState(state);
}

const pip = rg<PublicIPAddressCreateResult>`network public-ip create
  -n pip-${state.serverName} --dns-name ${state.serverName}
  --allocation-method static --sku standard`
  .then(r => r.publicIp) // TODO: find a better way than "then"
  .then(pip => {
    console.log(`[vm] public ip ${pip.dnsSettings?.fqdn} (${pip.ipAddress})`);
    return pip;
  });
const nic = (async () => {
  const nic = await rg<NetworkInterfaceCreateResult>`network nic create
    -n nic-${state.serverName}
    --subnet ${(await subnets.vms).id} --public-ip-address ${(await pip).id}
    --network-security-group ${(await nsg).id}
    --asgs ${[(await asgs.ssh).name, (await asgs.factorio).name]}`
    .then(r => r.NewNIC); // TODO: find a better way than "then"
  console.log(`[vm] nic ${nic.ipConfigurations?.[0]?.privateIPAddress}`);
  return nic;
})();

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

const vmName = `vm-${state.serverName}`; // TODO: it would be better to get this from the vm variable
const vm = (async () => {
  const vm = await rg<VirtualMachineCreateResult>`vm create
    -n ${vmName} --computer-name ${state.serverName}
    --size Standard_D2als_v6
    --os-disk-size-gb 32 --storage-sku Premium_LRS --os-disk-name ${vmName}-os
    --image Canonical:ubuntu-24_04-lts:server:latest
    --nics ${(await nic).id}
    --assign-identity [system] --generate-ssh-keys`;
    // TODO: make sure to set patch mode to Manual because video games!
  console.log(`[vm] server ${vm.fqdns} ${vm.publicIpAddress}`);
  return vm;
})();

const vmExtensions = (async () => {
  await vm; // TODO: it would be better if we had a vm.name
  await rg<VirtualMachineExtension>`vm extension set --vm-name ${vmName} --name AADSSHLoginForLinux --publisher Microsoft.Azure.ActiveDirectory`;
  console.log(`[vm] extension AADSSHLoginForLinux installed to ${vmName}`);
})();
const vmAuth = (async () => {
  const { userPrincipalName } = await az<any>`ad signed-in-user show`; // TODO: move into az.account or something and/or get types for it
  await az`role assignment create --assignee ${userPrincipalName} --role ${"Virtual Machine Administrator Login"} --scope ${(await vm).id}`;
  console.log(`[vm] user ${userPrincipalName} added to ${vmName}`);
})();
const vmConfig = (async () => {
  await vm; // TODO: it would be better if we had a vm.name
  const result = await rg<InstanceViewStatus>`vm run-command invoke --command-id RunShellScript -n ${vmName} --scripts @samples\\factorio.init.sh`;
  console.log(`[vm] init script executed: ${result.displayStatus}`);
})();

await Promise.all([
  vmExtensions,
  vmAuth,
  vmConfig,
]);

// TODO: Add tags to this example
