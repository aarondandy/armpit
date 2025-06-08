import { az, type VirtualNetworkCreateResult } from "armpit";
import type { Subnet } from "@azure/arm-network";
import { loadMyEnvironment } from "./myConfig.js";

const targetEnvironment = await loadMyEnvironment("samples");
const targetLocation = "westus2";
await az.account.setOrLogin(targetEnvironment);

const rg = await az.group(`videogames-${targetLocation}`, targetLocation);

const vnetPrefix = "10.64.0.0/16";
const { newVNet: vnet } = await rg<VirtualNetworkCreateResult>`network vnet create
  -n vnet-videogames-${rg.location}
  --address-prefixes ${vnetPrefix}`;
console.log(`[vnet] vnet ${vnet.name} ${vnet.addressSpace?.addressPrefixes?.[0]}`);

async function buildSubnet(name: string, n: number) {
  const subnetPrefix = vnetPrefix.replace(/\d+\.\d+\/\d+$/, `${n}.0/24`);
  const subnet = await rg<Subnet>`network vnet subnet create
    -n ${name} --vnet-name ${vnet.name}
    --address-prefix ${subnetPrefix}`;
  console.log(`[vnet] subnet ${subnet.name} ${subnet.addressPrefix}`);
  return subnet;
}

await Promise.all([
  buildSubnet("default", 1),
  buildSubnet("vms", 8)
]);

// TODO: Add tags to this example
