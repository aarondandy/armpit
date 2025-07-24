import { az, NameHash } from "armpit";
import type { ManagedEnvironment, ContainerApp } from "@azure/arm-appcontainers";
import { loadMyEnvironment } from "./utils/state.js";

// --------------------------
// Environment & Subscription
// --------------------------

const targetEnvironment = await loadMyEnvironment("samples");
const targetLocation = targetEnvironment.defaultLocation ?? "centralus";
await az.account.setOrLogin(targetEnvironment);

const rg = await az.group(`samples-${targetLocation}`, targetLocation, targetEnvironment.subscriptionId);
const resourceHash = new NameHash(targetEnvironment.subscriptionId, rg.name, { defaultLength: 6 });

// const appEnv = await rg<ManagedEnvironment>`containerapp env create
//   --name appenv-sample-${resourceHash}-${rg.location}
//   --enable-workload-profiles true --logs-destination none`;
const appEnv = await rg.containerApp.envUpsert(`appenv-sample-${resourceHash}-${rg.location}`, {
  appLogsConfiguration: { destination: "none" },
});
console.log(`[app] app environment ${appEnv.name} ready via ${appEnv.staticIp}`);

const envVars = ["FOO=BAR"];

// Remaking the app each time causes issues. An upsert would work much better.
const app = await rg<ContainerApp>`containerapp create
  --name app-aspnetsample-${resourceHash}-${rg.location} --environment ${appEnv.id}
  --image ${"mcr.microsoft.com/dotnet/samples:aspnetapp"}
  --ingress external --target-port 8080 --env-vars ${envVars} --system-assigned`;
console.log(`[app] ${app.name} recreated`);

await rg`containerapp update --name ${app.name} --replace-env-vars ${envVars}`;
console.log("[app] Set env vars");

console.log(`[app] app revision ready ${"https://" + app.latestRevisionFqdn}`);
