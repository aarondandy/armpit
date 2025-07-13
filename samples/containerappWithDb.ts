import { az, NameHash } from "armpit";
import mssql from "mssql";
import type { PrivateEndpoint } from "@azure/arm-network";
import type { PrivateZone, VirtualNetworkLink } from "@azure/arm-privatedns";
import type { ManagedEnvironment, ContainerApp } from "@azure/arm-appcontainers";
import type { Server as SqlServer, Database as SqlDatabase } from "@azure/arm-sql";
import { loadMyEnvironment } from "./utils/state.js";

// --------------------------
// Environment & Subscription
// --------------------------

const targetEnvironment = await loadMyEnvironment("samples");
const targetLocation = targetEnvironment.defaultLocation ?? "centralus";
await az.account.setOrLogin(targetEnvironment);

const myIp = fetch("https://api.ipify.org/").then(r => r.text());
const myUser = await az.account.showSignedInUser();

const rg = await az.group(`samples-${targetLocation}`, targetLocation);
const resourceHash = new NameHash(targetEnvironment.subscriptionId, { defaultLength: 6 }).concat(rg.name);

// -------
// Network
// -------

const vnet = rg.network.vnetUpsert(`vnet-sample-${rg.location}`, {
  addressPrefix: "10.10.0.0/16",
  subnets: [
    {
      name: "db",
      addressPrefix: "10.10.20.0/24",
    },
    {
      name: "app",
      addressPrefix: "10.10.30.0/24",
      delegations: "Microsoft.App/environments",
    },
  ]
});
vnet.then(vnet => console.log(`[net] vnet ${vnet.name} ${vnet.addressSpace?.addressPrefixes?.[0]}`));
const getSubnet = async (name: string) => (await vnet).subnets!.find(s => s.name === name)!;

const dbDnsZone = (async () => {
  const zoneName = "privatelink.database.windows.net";
  // TODO: an API helper may work better here
  const dns = await rg.lax<PrivateZone>`network private-dns zone show --name ${zoneName}`
    ?? await rg<PrivateZone>`network private-dns zone create --name ${zoneName}`;
  console.log(`[net] dns ${dns.name}`);
  return dns;
})();

(async () => {
  const linkName = `pdlink-sampledb-${rg.location}`;
  const { name: zoneName } = await dbDnsZone;
  // TODO: an API helper may work better here
  let link = await rg.lax<VirtualNetworkLink>`network private-dns link vnet show --name ${linkName} --zone-name ${zoneName}`
  // TODO: check to make sure the vnet matches correctly
  link ??= await rg<VirtualNetworkLink>`network private-dns link vnet create --name ${linkName} --zone-name ${zoneName}
    --virtual-network ${(await vnet).id} --registration-enabled false`;
  console.log(`[net] dns link ${link.name} ready`);
})();

// ----
// Data
// ----

const dbServer = rg<SqlServer>`sql server create -n db-sample-${resourceHash}-${rg.location}
  --enable-ad-only-auth --external-admin-principal-type User
  --external-admin-name ${myUser.userPrincipalName} --external-admin-sid ${myUser.id}`;
dbServer.then(s => console.log(`[db] server created ${s.fullyQualifiedDomainName}`));

const db = (async () => {
  const db = await rg<SqlDatabase>`sql db create
    --name sample --server ${(await dbServer).name}
    --tier Basic`;
  console.log(`[db] database ${db.name} created`);
  return db;
})();

const runOnDb = async (action: (pool: mssql.ConnectionPool) => Promise<void>) => {
  const pool = new mssql.ConnectionPool({
    server: `${(await dbServer).name}.database.windows.net`,
    database: (await db).name,
    authentication: { type: "token-credential", options: { credential: rg.getCredential() } }
  });
  try {
    await pool.connect();
    await action(pool);
  }
  finally {
    await pool.close();
  }
};
runOnDb(async (pool) => {
  const statements = [
    "IF OBJECT_ID('NumberSearch', 'U') IS NULL CREATE TABLE NumberSearch ([Value] BIGINT NOT NULL);",
    "IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_NumberSearch_Value' AND object_id = OBJECT_ID('NumberSearch')) CREATE CLUSTERED INDEX IX_NumberSearch_Value ON NumberSearch ([Value]);"
  ];
  await pool.request().query(statements.join("\n"));
});

(async () => {
  const address = await myIp;
  await rg`sql server firewall-rule create -n MyRule --server ${(await dbServer).name}
    --start-ip-address ${address} --end-ip-address ${address}`;
  console.log(`[db] access allowed through firewall for ${address}`);
})();

(async () => {
  const name = `pe-sampledb-${rg.location}`;
  const privateEndpoint = await rg<PrivateEndpoint>`network private-endpoint create
    --name ${name} --connection-name ${name} --nic-name ${name}
    --group-id sqlServer --private-connection-resource-id ${(await dbServer).id}
    --vnet-name ${(await vnet).name} --subnet ${(await getSubnet("db")).name}`;
  const { name: zoneName, id: zoneId } = await dbDnsZone;
  await rg`network private-endpoint dns-zone-group create
    --name ${name} --endpoint-name ${privateEndpoint.name}
    --private-dns-zone ${zoneId} --zone-name ${zoneName}`;
  console.log(`[db] private endpoint ${privateEndpoint.name} ready`);
})();

// --------
// Services
// --------

const containerAppEnv = rg<ManagedEnvironment>`containerapp env create
  --name appenv-sample-${resourceHash}-${rg.location}
  --enable-workload-profiles true --logs-destination none
  --infrastructure-subnet-resource-id ${(await getSubnet("app")).id}`;
containerAppEnv.then(appEnv => console.log(`[app] app environment ${appEnv.name} ready via ${appEnv.staticIp}`));

// TODO: reduce the line breaks that come from containerapp commands. Likely due to a progress spinner.

const app = (async() => {
  const appName = `app-sample-${resourceHash}-${rg.location}`;
  const sqlConnectionString = `Server=${(await dbServer).name}.database.windows.net;Database=${(await db).name};Authentication=Active Directory Managed Identity;`;
  const envVars = [
    `ConnectionStrings__MyDatabase=${sqlConnectionString}`,
    "FOO=BAR",
  ];

  await runOnDb(async (pool) => {
    const username = appName;
    const statements = [
      `IF NOT EXISTS (SELECT 1 FROM sys.sysusers WHERE [name] = '${username}') CREATE USER [${username}] FROM EXTERNAL PROVIDER;`,
      ...["db_datareader", "db_datawriter", "db_ddladmin"].map(role => `EXEC sp_addrolemember [${role}],[${username}];`),
    ];
    await pool.request().query(statements.join("\n"));
  });
  console.log(`[app] pre-permissioned ${appName} to database`);

  // Remaking the app each time causes issues. An upsert would work much better.
  const app = await rg<ContainerApp>`containerapp create
    --name ${appName} --environment ${(await containerAppEnv).id}
    --image ${"aarondandy/numbers:latest"}
    --ingress external --target-port 8080
    --env-vars ${envVars}
    --system-assigned`;
  console.log(`[app] ${app.name} recreated`);

  await rg`containerapp update --name ${app.name} --replace-env-vars ${envVars}`;
  console.log("[app] Set env vars");

  return app;
})();

console.log(`[app] app revision ready ${"https://" + (await app).latestRevisionFqdn}`);
