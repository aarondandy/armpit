import path from "node:path";
import * as fs from "fs/promises";
import { az, toCliArgPairs, NameHash } from "armpit";
import { $ } from "execa";
import mssql from "mssql";
import type { PrivateEndpoint } from "@azure/arm-network";
import type { Server as SqlServer, Database as SqlDatabase } from "@azure/arm-sql";
import { loadMyEnvironment } from "./utils/state.js";
import { zipFolder } from "./utils/helpers.js";

// --------------------------
// Environment & Subscription
// --------------------------

const tags = { env: "samples", script: import.meta.url.split("/").pop()! } as const;
const targetEnvironment = await loadMyEnvironment("samples");
const targetLocation = targetEnvironment.defaultLocation ?? "centralus";
await az.account.setOrLogin(targetEnvironment);

const myIp = fetch("https://api.ipify.org/").then(r => r.text());
let myUser = az.account.showSignedInUser();

const rg = await az.group(`samples-${targetLocation}`, targetLocation, { tags });
const resourceHash = new NameHash(targetEnvironment.subscriptionId, rg.name, { defaultLength: 6 });

// -----
// Build
// -----

const build = (async () => {
  const srcDir = path.join(import.meta.dirname, "db-app");
  const outDir = path.join(srcDir, "dist");
  const appZipFile = path.join(outDir, "app.zip");

  console.log(`[build] building application to ${outDir}`);

  await $`dotnet build ${srcDir} -o ${outDir}`;

  console.log(`[build] creating deployable zip from ${outDir}`);

  await fs.rm(appZipFile, { force: true });
  await zipFolder(outDir, appZipFile);

  console.log(`[build] ready for deployment: ${appZipFile}`);

  return appZipFile;
})();

// -------
// Network
// -------

const network = (async () => {
  const zonePlDb = rg.network.privateZoneUpsert("privatelink.database.windows.net", { tags });
  zonePlDb.then(zone => console.log(`[net] dns ${zone.name}`));

  const vnet = await rg.network.vnetUpsert(`vnet-sample-${rg.location}`, {
    addressPrefix: "10.10.0.0/16",
    subnets: [
      {
        name: "db",
        addressPrefix: "10.10.20.0/24",
      },
      {
        name: "web",
        addressPrefix: "10.10.31.0/24",
        delegations: "Microsoft.Web/serverFarms",
      },
    ],
    tags,
  });
  console.log(`[net] vnet ${vnet.name} ${vnet.addressSpace?.addressPrefixes?.[0]}`);

  const link = await rg.network.privateZoneVnetLinkUpsert((await zonePlDb).name!, `pdlink-sampledb-${rg.location}`, {
    virtualNetwork: vnet,
    registrationEnabled: false,
    tags,
  });
  console.log(`[net] dns link ${link.name} ready`);

  return { vnet, zonePlDb: await zonePlDb };
})();

// --------
// Database
// --------

const database = (async () => {
  const dbServer = await rg<SqlServer>`sql server create -n db-sample-${resourceHash}-${rg.location}
    --enable-ad-only-auth --external-admin-principal-type User
    --external-admin-name ${(await myUser).userPrincipalName} --external-admin-sid ${(await myUser).id}
    --tags ${toCliArgPairs(tags)}`;
  console.log(`[db] server created ${dbServer.fullyQualifiedDomainName}`);

  const db = await rg<SqlDatabase>`sql db create --name sample --server ${dbServer.name}
    --tier Basic --tags ${toCliArgPairs(tags)}`;
  console.log(`[db] database ${db.name} created`);

  const dbAccess = (async () => {
    const address = await myIp;
    await rg`sql server firewall-rule create -n MyRule --server ${dbServer.name} --start-ip-address ${address} --end-ip-address ${address}`;
    console.log(`[db] access allowed through firewall for ${address}`);
  })();

  const runOnDb = async (action: (pool: mssql.ConnectionPool) => Promise<void>) => {
    await dbAccess; // wait for access before connecting
    const pool = new mssql.ConnectionPool({
      server: `${dbServer.name}.database.windows.net`,
      database: db.name,
      authentication: { type: "token-credential", options: { credential: rg.getCredential() } },
    });
    try {
      await pool.connect();
      await action(pool);
    } finally {
      await pool.close();
    }
  };

  await (async () => {
    const name = `pe-sampledb-${rg.location}`;
    const { vnet, zonePlDb } = await network;
    const privateEndpoint = await rg<PrivateEndpoint>`network private-endpoint create --name ${name}
      --connection-name ${name} --nic-name ${name} --group-id sqlServer
      --private-connection-resource-id ${dbServer.id} --vnet-name ${vnet.name} --subnet ${"db"}
      --tags ${toCliArgPairs(tags)}`;

    await rg`network private-endpoint dns-zone-group create --name ${name}
      --endpoint-name ${privateEndpoint.name} --private-dns-zone ${zonePlDb.id} --zone-name ${zonePlDb.name}`;
    console.log(`[db] private endpoint ${privateEndpoint.name} ready`);
  })();

  return {
    dbServer,
    db,
    runOnDb,
    sqlConnectionString: `Server=${dbServer.name}.database.windows.net;Database=${db.name};Authentication=Active Directory Managed Identity;`,
  };
})();

// -------
// Web App
// -------

const webApp = (async () => {
  const plan = await rg.appService.planUpsert(`asp-sample${resourceHash}-${rg.location}`, {
    kind: "linux",
    reserved: true,
    sku: { name: "P0v3" },
    tags,
  });
  console.log(`[app] plan ${plan.name} ready`);

  const { vnet } = await network;
  const { sqlConnectionString, runOnDb } = await database;

  const app = await rg.appService.webAppUpsert(`app-samplezip${resourceHash}-${rg.location}`, {
    serverFarmId: plan.id,
    kind: "app,linux,container",
    identity: { type: "SystemAssigned" },
    virtualNetworkSubnetId: vnet.subnets?.find(s => s.name === "web")?.id,
    siteConfig: {
      linuxFxVersionDefault: "DOTNETCORE|10.0",
      appSettings: [
        { name: "WEBSITE_VNET_ROUTE_ALL", value: "1" },
        { name: "ConnectionStrings__MyDatabase", value: sqlConnectionString },
        { name: "FOO", value: "BAR" },
      ],
    },
    tags,
  });
  console.log(`[app] app ${app.name} ready`);

  await runOnDb(async pool => {
    const username = app.name;
    const statements = [
      `IF NOT EXISTS (SELECT 1 FROM sys.sysusers WHERE [name] = '${username}') CREATE USER [${username}] FROM EXTERNAL PROVIDER;`,
      ...["db_datareader", "db_datawriter", "db_ddladmin"].map(
        role => `EXEC sp_addrolemember [${role}],[${username}];`,
      ),
    ];
    await pool.request().query(statements.join("\n"));
  });
  console.log(`[app] ${app.name} database access granted`);

  return { app, plan };
})();

// ----------
// Deployment
// ----------

const { runOnDb } = await database;
await runOnDb(async pool => {
  // Prepare database for the application
  const statements = [
    "IF OBJECT_ID('NumberSearch', 'U') IS NULL CREATE TABLE NumberSearch ([Value] BIGINT NOT NULL);",
    "IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_NumberSearch_Value' AND object_id = OBJECT_ID('NumberSearch')) CREATE CLUSTERED INDEX IX_NumberSearch_Value ON NumberSearch ([Value]);",
  ];
  await pool.request().query(statements.join("\n"));
  console.log("[deploy] schema defined");
});

const deployableSourcePath = await build;
const { app: deployTaget } = await webApp;
console.log(`[deploy] deploying ${deployableSourcePath} to ${deployTaget.name}`);
await rg`webapp deploy --src-path ${deployableSourcePath} -n ${deployTaget.name}`;

console.log(`
app ready ${"https://" + deployTaget.hostNames?.[0]}
`);
