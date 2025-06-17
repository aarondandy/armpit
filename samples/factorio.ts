import path from "node:path";
import { az, NameHash } from "armpit";
import { loadMyEnvironment, loadState, saveState } from "./utils/state.js";
import type {
  Subnet,
  VirtualNetwork,
  ApplicationSecurityGroup,
  NetworkSecurityGroup,
  PublicIPAddress,
  NetworkInterface,
} from "@azure/arm-network";
import type {
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

const nsg = (async () => {
  const myIp = (await fetch("https://api.ipify.org/")).text();
  const nsg = await rg<NetworkSecurityGroup>`network nsg create -n nsg-videogames-${rg.location}`;
  console.log(`[net] nsg ${nsg.name}`);

  // TODO: Find a way that doesn't temporarily block things on re-create. Create clears rules.
  // TODO: Also, some solution that allows upserting behavior would be very nice.

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

const vnet = rg<VirtualNetwork>`network vnet create -n vnet-videogames-${rg.location} --address-prefixes 10.64.0.0/16`;
vnet.then(vnet => console.log(`[net] vnet ${vnet.name} ${vnet.addressSpace?.addressPrefixes?.[0]}`));

// TODO: subnets may be better as a sequential loop
const subnets = (async () => {
  const { id: nsgId } = await nsg;
  const { name: vnetName, addressSpace } = await vnet;
  async function buildSubnet(name: string, octet: number) {
    const subnetPrefix = addressSpace!.addressPrefixes![0].replace(/\d+\.\d+\/\d+$/, `${octet}.0/24`);
    const subnet = await rg<Subnet>`network vnet subnet create
      -n ${name} --vnet-name ${vnetName}
      --address-prefix ${subnetPrefix}
      --network-security-group ${nsgId}`;
      console.log(`[net] subnet ${subnet.name} ${subnet.addressPrefix}`);
    return subnet;
  };
  return {
    default: await buildSubnet("default", 0),
    vms: await buildSubnet("vms", 8),
  };
})();

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

const vmName = `vm-${state.serverName}`; // TODO: it would be better to get this from the vm variable after create
const vm = (async () => {
  // TODO: maybe the script should directly control the disk, so the VM can be recreated safely without data loss
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
  console.log(`[vm] admin ${userPrincipalName} added to ${vmName}`);
})();
const vmConfig = (async () => {
  await vm; // TODO: it would be better if we had a vm.name
  const scriptPath = path.join(import.meta.dirname, "factorio.init.sh");
  const result = await rg<RunCommandResult>`vm run-command invoke --command-id RunShellScript -n ${vmName} --scripts ${"@" + scriptPath}`;
  console.log(`[vm] init script status: ${result.value?.map(s => s.displayStatus)}`);
})();

await Promise.all([
  vmExtensions,
  vmAuth,
  vmConfig,
]);

console.log(`
The server is ready and the factory must grow.
Connect: ${(await pip).dnsSettings?.fqdn} (${(await pip).ipAddress})
Admin: az ssh vm -n ${vmName} -g ${rg.name}
`);

// TODO: Add tags to this example
