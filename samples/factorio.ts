import path from "node:path";
import { az, toCliArgPairs, helpers, NameHash, type VirtualMachineCreateResult } from "armpit";
import { loadMyEnvironment, loadState, saveState } from "./utils/state.js";
import type { NetworkInterface } from "@azure/arm-network";
import type { Disk, VirtualMachineExtension, RunCommandResult } from "@azure/arm-compute";

// --------------------------
// Environment & Subscription
// --------------------------

const tags = { env: "samples", script: import.meta.url.split("/").pop()! } as const;
const targetEnvironment = await loadMyEnvironment("samples");
const targetLocation = targetEnvironment.defaultLocation ?? "centralus";
await az.account.setOrLogin(targetEnvironment);
const state = await loadState<{ serverName?: string }>();

const myIp = fetch("https://api.ipify.org/").then(r => r.text());
const myUser = az.account.showSignedInUser();

// --------------
// Resource Group
// --------------

const rg = await az.group(`videogames-${targetLocation}`, targetLocation, {
  subscriptionId: targetEnvironment.subscriptionId,
  tags,
});
const resourceHash = new NameHash(targetEnvironment.subscriptionId).concat(rg.name);

if (!state.serverName) {
  state.serverName = `factorio-${resourceHash}`;
  await saveState(state);
}

// -------
// Network
// -------

const network = (async () => {
  const asgs = await rg.network.asgMultiUpsert(
    {
      ssh: "asg-ssh",
      factorio: "asg-factorio",
    },
    { tags },
  );

  const nsg = await rg.network.nsgUpsert(`nsg-videogames-${rg.location}`, {
    securityRules: [
      {
        name: "FactoryMustGrow",
        direction: "Inbound",
        priority: 200,
        access: "Allow",
        protocol: "Udp",
        destinationApplicationSecurityGroups: [asgs.factorio],
        destinationPortRange: "34197",
      },
      {
        name: "ManageFromWorkstation",
        direction: "Inbound",
        priority: 1000,
        access: "Allow",
        protocol: "Tcp",
        sourceAddressPrefix: await myIp,
        destinationApplicationSecurityGroups: [asgs.ssh],
        destinationPortRange: "22",
      },
    ],
    tags,
  });
  console.log(`[net] nsg ${nsg.name}`);

  const vnet = await rg.network.vnetUpsert(`vnet-videogames-${rg.location}`, {
    addressPrefix: "10.64.0.0/16",
    subnets: [
      {
        name: "default",
        networkSecurityGroup: nsg,
        addressPrefix: "10.64.0.0/24",
      },
      {
        name: "vms",
        networkSecurityGroup: nsg,
        addressPrefix: "10.64.8.0/24",
      },
    ],
    tags,
  });
  console.log(`[net] vnet ${vnet.name} ${vnet.addressSpace?.addressPrefixes?.[0]}`);

  return { asgs, nsg, vnet };
})();

// ------
// Server
// ------

const { vm } = await (async () => {
  const osDisk = rg<Disk>`disk create -n vm-${state.serverName}-os
    --hyper-v-generation V2
    --os-type Linux --image-reference Canonical:ubuntu-24_04-lts:server:latest
    --sku Premium_LRS --size-gb 32
    --tags ${toCliArgPairs(tags)}`;
  osDisk.then(d => console.log(`[vm] disk ${d.name}`));

  const pip = await rg.network.pipUpsert(`pip-${state.serverName}`, {
    dnsSettings: { domainNameLabel: state.serverName },
    publicIPAllocationMethod: "Static",
    sku: "Basic",
    tags,
  });
  console.log(`[vm] public ip ${pip.dnsSettings?.fqdn} (${pip.ipAddress})`);

  const { vnet, nsg, asgs } = await network;

  const nic = await rg<NetworkInterface>`network nic create -n vm-${state.serverName}-nic
    --subnet ${vnet.subnets?.find(s => s.name === "vms")?.id} --public-ip-address ${pip.name}
    --network-security-group ${nsg.name}
    --asgs ${helpers.pickValues(asgs, "ssh", "factorio").map(a => a.name)}
    --tags ${toCliArgPairs(tags)}`;
  console.log(`[vm] nic ${nic.ipConfigurations?.[0]?.privateIPAddress}`);

  const vmName = `vm-${state.serverName}`;
  const vmResult = await rg<VirtualMachineCreateResult>`vm create
    -n ${vmName} --computer-name ${state.serverName}
    --size Standard_D2als_v6 --nics ${nic.id}
    --attach-os-disk ${(await osDisk).name} --os-type linux
    --assign-identity [system]
    --tags ${toCliArgPairs(tags)}`;
  const vm = { name: vmName, ...vmResult };
  console.log(`[vm] server ${vm.name}`);

  return { vm, nic, pip };
})();

// ----------------
// Install Services
// ----------------

await Promise.all([
  (async () => {
    const { userPrincipalName } = await myUser;
    await rg<VirtualMachineExtension>`vm extension set --vm-name ${vm.name} --name AADSSHLoginForLinux --publisher Microsoft.Azure.ActiveDirectory`;
    await az`role assignment create --assignee ${userPrincipalName} --role ${"Virtual Machine Administrator Login"} --scope ${vm.id}`;
    console.log(`[vm] user ${userPrincipalName} can SSH into ${vm.name}`);
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
