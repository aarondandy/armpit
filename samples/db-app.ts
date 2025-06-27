import { az, NameHash } from "armpit";
import { loadMyEnvironment } from "./utils/state.js";
import type { Subnet, VirtualNetwork, PrivateEndpoint } from "@azure/arm-network";
import type { PrivateZone, VirtualNetworkLink } from "@azure/arm-privatedns";

import { Server as SqlServer } from "@azure/arm-sql";

// --------------------------
// Environment & Subscription
// --------------------------

const targetEnvironment = await loadMyEnvironment("samples");
const targetLocation = targetEnvironment.defaultLocation ?? "centralus";
await az.account.setOrLogin(targetEnvironment);

const myIp = fetch("https://api.ipify.org/").then(r => r.text());
const { userPrincipalName, id: userPrincipalId } = await az<any>`ad signed-in-user show`; // TODO: move into az.account or something and/or get types for it

const rg = await az.group(`samples-${targetLocation}`, targetLocation);
const resourceHash = new NameHash(targetEnvironment.subscriptionId, { defaultLength: 6 }).concat(rg.name);

// -------
// Network
// -------

const vnet = rg<VirtualNetwork>`network vnet create -n vnet-sample-${rg.location} --address-prefixes 10.10.0.0/16`;
vnet.then(vnet => console.log(`[net] vnet ${vnet.name} ${vnet.addressSpace?.addressPrefixes?.[0]}`));

const subnets = (async () => {
  const { name: vnetName, addressSpace } = await vnet;
  const getPrefix = (octet: number) => addressSpace!.addressPrefixes![0].replace(/\d+\.\d+\/\d+$/, `${octet}.0/24`);
  const buildSubnet = (name: string, octet: number) => rg<Subnet>`network vnet subnet create
    -n ${name} --address-prefix ${getPrefix(octet)} --vnet-name ${vnetName}`;
  return {
    default: await buildSubnet("default", 0),
    database: await buildSubnet("db", 20),
    app: await buildSubnet("app", 30),
  };
})();
subnets.then(subnets => console.log(`[net] subnets ${Object.keys(subnets)}`));

const dns = (async () => {
  const zoneName = "privatelink.database.windows.net";
  // TODO: an API helper may work better here
  const dns = await rg.lax<PrivateZone>`network private-dns zone show --name ${zoneName}`
    ?? await rg<PrivateZone>`network private-dns zone create --name ${zoneName}`;
  console.log(`[net] dns ${dns.name}`);
  return dns;
})();

(async () => {
  const linkName = `pdlink-sampledb-${rg.location}`;
  const { name: zoneName } = await dns;
  // TODO: an API helper may work better here
  let link = await rg.lax<VirtualNetworkLink>`network private-dns link vnet show --name ${linkName} --zone-name ${zoneName}`
  // TODO: check to make sure the vnet matches correctly
  link ??= await rg<VirtualNetworkLink>`network private-dns link vnet create --name ${linkName} --zone-name ${zoneName}
    --virtual-network ${(await vnet).id} --registration-enabled false`;
  console.log(`[net] dns link ${link.name} ready`);
})();

// --------
// Database
// --------

const dbServer = rg<SqlServer>`sql server create -n db-sample-${resourceHash}
  --enable-ad-only-auth --external-admin-principal-type User
  --external-admin-name ${userPrincipalName} --external-admin-sid ${userPrincipalId}`;
dbServer.then(s => console.log(`[db] server created ${s.fullyQualifiedDomainName}`));

(async () => {
  const address = await myIp;
  await rg`sql server firewall-rule create -n MyRule --server ${(await dbServer).name}
    --start-ip-address ${address} --end-ip-address ${address}`;
  console.log(`[db] address allowed: ${address}`);
})();

(async () => {
  const name = `pe-sampledb-${rg.location}`;
  const privateEndpoint = await rg<PrivateEndpoint>`network private-endpoint create
    --name ${name} --connection-name ${name} --group-id sqlServer
    --private-connection-resource-id ${(await dbServer).id}
    --vnet-name ${(await vnet).name} --subnet ${(await subnets).database.name}`;
  console.log(`[db] private endpoint ${privateEndpoint.name} ready`);
})();

// --------
// Services
// --------


