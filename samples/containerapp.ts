import { az, NameHash } from "armpit";
import { loadMyEnvironment } from "./utils/state.js";

// --------------------------
// Environment & Subscription
// --------------------------

const tags = { env: "samples", script: import.meta.url.split("/").pop()! } as const;
const targetEnvironment = await loadMyEnvironment("samples");
const targetLocation = targetEnvironment.defaultLocation ?? "centralus";
await az.account.setOrLogin(targetEnvironment);

const rg = await az.group(`samples-${targetLocation}`, targetLocation, { tags });
const resourceHash = new NameHash(targetEnvironment.subscriptionId, rg.name, { defaultLength: 6 });

// -------------
// Container App
// -------------

console.log(`[app] preparing contain app resources`);

const appEnv = await rg.containerApp.envUpsert(`appenv-sample-${resourceHash}-${rg.location}`, {
  workloadProfiles: [{ name: "Consumption", workloadProfileType: "Consumption" }],
  tags,
});

console.log(`[app] app environment ${appEnv.name} ready via ${appEnv.staticIp}`);

const app = await rg.containerApp.appUpsert(`app-aspnetsample-${resourceHash}-${rg.location}`, {
  environmentId: appEnv.id,
  workloadProfileName: "Consumption",
  template: {
    containers: [
      {
        name: "aspnetsample",
        image: "mcr.microsoft.com/dotnet/samples:aspnetapp",
        env: [{ name: "FOO", value: "BAR" }],
      },
    ],
  },
  configuration: {
    ingress: {
      external: true,
      targetPort: 8080,
    },
  },
  identity: { type: "SystemAssigned" },
  tags,
});

console.log(`[app] app revision ready ${"https://" + app.latestRevisionFqdn}`);
