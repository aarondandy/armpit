import { az, NameHash, type VirtualNetworkCreateResult } from "armpit";
import type { Subnet } from "@azure/arm-network";
import { loadMyEnvironment } from "./myConfig.js";

const targetEnvironment = await loadMyEnvironment("samples");
const targetLocation = "westus2";
await az.account.setOrLogin(targetEnvironment);

const subHash = new NameHash(targetEnvironment.subscriptionId);

const rg = await az.group(`videogames-${targetLocation}`, targetLocation);
const rgHash = subHash.concat(rg.name);

const vnetPrefix = "10.64.0.0/16";
const vnet = await rg<VirtualNetworkCreateResult>`network vnet create
  -n vnet-videogames-${rg.location} --address-prefixes ${vnetPrefix}`
  .then(r => r.newVNet); // TODO: find a better way
console.log(`[vnet] vnet ${vnet.name} ${vnet.addressSpace?.addressPrefixes?.[0]}`);

async function buildSubnet(name: string, n: number) {
  const subnetPrefix = vnetPrefix.replace(/\d+\.\d+\/\d+$/, `${n}.0/24`);
  const subnet = await rg<Subnet>`network vnet subnet create
    -n ${name} --vnet-name ${vnet.name}
    --address-prefix ${subnetPrefix}`;
  console.log(`[vnet] subnet ${subnet.name} ${subnet.addressPrefix}`);
  return subnet;
}
const subnetDefault = buildSubnet("default", 0);
const subnetVms = buildSubnet("vms", 8);

const serverName = `factorio-${rgHash}`;
console.log("TODO: make server", serverName);

// TODO: pip
// TODO: nic
// TODO: vm

// TODO: Add tags to this example
