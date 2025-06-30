import { az, NameHash } from "armpit";
import { loadMyEnvironment } from "./utils/state.js";
import mssql from "mssql";
import type { Identity } from "@azure/arm-resources";
import type { Subnet, VirtualNetwork, PrivateEndpoint } from "@azure/arm-network";
import type { PrivateZone, VirtualNetworkLink } from "@azure/arm-privatedns";
import type { ManagedEnvironment, ContainerApp, Resource as ContainerAppResource } from "@azure/arm-appcontainers";
import type { Database as SqlDatabase } from "@azure/arm-sql";

import { Server as SqlServer } from "@azure/arm-sql";

// --------------------------
// Environment & Subscription
// --------------------------

const targetEnvironment = await loadMyEnvironment("samples");
const targetLocation = targetEnvironment.defaultLocation ?? "centralus";

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
  const buildSubnet = (name: string, octet: number, delegations?: string[]) => {
    const otherArgs = delegations && delegations.length > 0 ? ["--delegations", ...delegations] : []
    return rg<Subnet>`network vnet subnet create -n ${name} --address-prefix ${getPrefix(octet)} --vnet-name ${vnetName} ${otherArgs}`;
  }
  return {
    default: await buildSubnet("default", 0),
    database: await buildSubnet("db", 20),
    app: await buildSubnet("app", 30, ["Microsoft.App/environments"]),
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

// ----
// Data
// ----

const dbServer = rg<SqlServer>`sql server create -n db-sample-${resourceHash}-${rg.location}
  --enable-ad-only-auth --external-admin-principal-type User
  --external-admin-name ${userPrincipalName} --external-admin-sid ${userPrincipalId}`;
dbServer.then(s => console.log(`[db] server created ${s.fullyQualifiedDomainName}`));

const db = (async () => {
  const db = await rg<SqlDatabase>`sql db create
    --name sample --server ${(await dbServer).name}
    --tier Basic`;
  console.log(`[db] database ${db.name} created`);
  return db;
})();

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
    --vnet-name ${(await vnet).name} --subnet ${(await subnets).database.name}`;
  console.log(`[db] private endpoint ${privateEndpoint.name} ready`);
})();

// --------
// Services
// --------

const containerAppEnv = (async() => {
  type ManagedEnvironmentCreateResponse = ContainerAppResource & { properties: ManagedEnvironment };
  // The response from the create command is a bit strange and must be reconstructed
  const { properties, systemData, ...otherResults } = await rg<ManagedEnvironmentCreateResponse>`containerapp env create
    --name appenv-sample-${resourceHash}-${rg.location}
    --enable-workload-profiles true --logs-destination none
    --infrastructure-subnet-resource-id ${(await subnets).app.id}`;
  const appEnv = { ...otherResults, ...properties } as ManagedEnvironment; // put it all back together
  console.log(`[app] app environment ${appEnv.name} ready via ${appEnv.staticIp}`);
  return appEnv;
})();

// TODO: reduce the line breaks that come from containerapp commands. Likely due to a progress spinner.

const app = (async() => {
  const env = await containerAppEnv;
  type ContainerAppCreateResponse = ContainerAppResource & { properties: ContainerApp };
  // Remaking the app each time causes issues. An upsert would work much better.
  const { properties, systemData, ...otherResults } = await rg<ContainerAppCreateResponse>`containerapp create
    --name app-sample-${resourceHash}-${rg.location} --environment ${env.id}
    --image ${"atlassian/jira-software"}
    --ingress external --target-port 80`;
  // "orchardproject/orchardcore-cms-linux:latest"
  const app = { ...otherResults, ...properties } as ContainerApp;
  const appIdentity = await rg<Identity>`containerapp identity assign --name ${app.name} --system-assigned`;
  // TODO: permission the app to the database
  // TODO: configure the app via env vars

  // const sqlConnectionString = `Server=${(await dbServer).name}.database.windows.net;Database=${(await db).name};Tenant Id=${targetEnvironment.tenantId ?? account?.tenantId};Authentication=Active Directory Integrated;`;
  // const saConnectionString = ``;
  // const environmentVariables = [
  //   `OrchardCore__ConnectionString=${sqlConnectionString}`,
  //   "OrchardCore__DatabaseProvider=SqlConnection",
  // ];

  const pool = new mssql.ConnectionPool({
    server: `${(await dbServer).name}.database.windows.net`,
    database: (await db).name,
    authentication: { type: "token-credential", options: { credential: rg.getCredential() } }
  });
  try {
    await pool.connect();
    const username = app.name;
    const statements = [
      `IF NOT EXISTS (SELECT 1 FROM sys.sysusers WHERE [name] = '${username}') CREATE USER [${username}] FROM EXTERNAL PROVIDER;`,
      ...["db_datareader", "db_datawriter", "db_ddladmin"].map(role => `EXEC sp_addrolemember [${role}],[${username}];`),
    ];
    await pool.request().query(statements.join("\n"));
  } finally {
    await pool.close();
  }

  const sqlConnectionString = `jdbc:sqlserver://${(await dbServer).name}.database.windows.net:1433;databaseName=${(await db).name};authentication=ActiveDirectoryManagedIdentity;encrypt=true;trustServerCertificate=false;`;
  const environmentVariables = [
    `JDBC_URL=${sqlConnectionString}`,
    "JIRA_DB_TYPE=sqlserver",
    ""
  ]
  await rg`containerapp update --name ${app.name} --set-env-vars ${environmentVariables}`;

  return app;
})();

console.log(`[app] app ready ${"https://" + (await app).latestRevisionFqdn}`);
