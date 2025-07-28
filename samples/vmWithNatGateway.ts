import { az, NameHash } from "armpit";
import { loadMyEnvironment } from "./utils/state.js";

// --------------------------
// Environment & Subscription
// --------------------------

const targetEnvironment = await loadMyEnvironment("samples");
const targetLocation = targetEnvironment.defaultLocation ?? "centralus";
await az.account.setOrLogin(targetEnvironment);

const myIp = fetch("https://api.ipify.org/").then(r => r.text());
let myUser = await az.account.showSignedInUser();

const rg = await az.group(`samples-${targetLocation}`, targetLocation);
const resourceHash = new NameHash(targetEnvironment.subscriptionId, rg.name, { defaultLength: 6 });

// -------
// Network
// -------

const natIp = rg.network.pipUpsert(`pip-natsample-${rg.location}`, {
  sku: "Standard",
  publicIPAllocationMethod: "Static",
});
natIp.then(x => console.log(`[net] nat ip ${x.ipAddress}`));

const nat = (async () =>
  rg.network.natGatewayUpsert(`nat-sample-${rg.location}`, {
    sku: "Standard",
    publicIpAddresses: [await natIp],
  }))();
nat.then(x => console.log(`[net] nat gateway ${x.name}`));

const vnet = (async () =>
  rg.network.vnetUpsert(`vnet-sample-${rg.location}`, {
    addressPrefix: "10.10.0.0/16",
    subnets: [
      {
        name: "jump",
        addressPrefix: "10.10.4.0/24",
        natGateway: await nat,
      },
    ],
  }))();
vnet.then(x => console.log(`[net] vnet ${x.name}`));
