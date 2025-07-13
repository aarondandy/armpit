import { az, NameHash } from "armpit";
import mssql from "mssql";
import type { PrivateEndpoint } from "@azure/arm-network";
import type { PrivateZone, VirtualNetworkLink } from "@azure/arm-privatedns";
import type { ManagedEnvironment, ContainerApp, Resource as ContainerAppResource } from "@azure/arm-appcontainers";
import type { Server as SqlServer, Database as SqlDatabase } from "@azure/arm-sql";
import { loadMyEnvironment } from "./utils/state.js";

// --------------------------
// Environment & Subscription
// --------------------------

const targetEnvironment = await loadMyEnvironment("samples");
const targetLocation = targetEnvironment.defaultLocation ?? "centralus";
await az.account.setOrLogin(targetEnvironment);

const rg = await az.group(`samples-${targetLocation}`, targetLocation);
const resourceHash = new NameHash(targetEnvironment.subscriptionId, { defaultLength: 6 }).concat(rg.name);

type ManagedEnvironmentCreateResponse = ContainerAppResource & { properties: ManagedEnvironment };
const appEnv = (async() => {
// The response from the create command is a bit strange and must be reconstructed
const { properties, systemData, ...otherResults } = await rg<ManagedEnvironmentCreateResponse>`containerapp env create
  --name appenv-sample-${resourceHash}-${rg.location}
  --enable-workload-profiles true --logs-destination none`;
const appEnv = { ...otherResults, ...properties } as ManagedEnvironment; // put it all back together
console.log(`[app] app environment ${appEnv.name} ready via ${appEnv.staticIp}`);
return appEnv;
})();

// TODO: reduce the line breaks that come from containerapp commands. Likely due to a progress spinner.

const envVars = [
  "FOO=BAR",
];

// Remaking the app each time causes issues. An upsert would work much better.
type ContainerAppCreateResponse = ContainerAppResource & { properties: ContainerApp };
const { properties, systemData, ...otherResults } = await rg<ContainerAppCreateResponse>`containerapp create
  --name app-aspnetsample-${resourceHash}-${rg.location} --environment ${(await appEnv).id}
  --image ${"mcr.microsoft.com/dotnet/samples:aspnetapp"}
  --ingress external --target-port 8080
  --env-vars ${envVars}
  --system-assigned`;
const app = { ...otherResults, ...properties } as ContainerApp;
// const appIdentity = await rg<Identity>`containerapp identity assign --name ${app.name} --system-assigned`;
console.log(`[app] ${app.name} recreated`);

await rg`containerapp update --name ${app.name} --replace-env-vars ${envVars}`;
console.log("[app] Set env vars");

console.log(`[app] app revision ready ${"https://" + (await app).latestRevisionFqdn}`);
