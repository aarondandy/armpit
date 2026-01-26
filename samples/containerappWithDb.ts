import { az, toCliArgPairs, NameHash } from "armpit";
import mssql from "mssql";
import type { PrivateEndpoint } from "@azure/arm-network";
import type { Server as SqlServer, Database as SqlDatabase } from "@azure/arm-sql";
import { loadMyEnvironment } from "./utils/state.js";

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

// -------
// Network
// -------

const network = (async () => {
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
    ],
    tags,
  });
  vnet.then(vnet => console.log(`[net] vnet ${vnet.name} ${vnet.addressSpace?.addressPrefixes?.[0]}`));

  const zonePlDb = rg.network.privateZoneUpsert("privatelink.database.windows.net", { tags });
  zonePlDb.then(zone => console.log(`[net] private dns zone ${zone.name} ready`));

  await Promise.all([vnet, zonePlDb])
    .then(([vnet, zonePlDb]) =>
      rg.network.privateZoneVnetLinkUpsert(zonePlDb.name!, `pdlink-sampledb-${rg.location}`, {
        virtualNetwork: vnet,
        registrationEnabled: false,
        tags,
      }),
    )
    .then(link => console.log(`[net] dns link ${link.name} ready`));

  return {
    vnet: await vnet,
    zonePlDb: await zonePlDb,
  };
})();

// --------
// Database
// --------

const database = (async () => {
  const dbServer = rg<SqlServer>`sql server create -n db-sample-${resourceHash}-${rg.location}
    --enable-ad-only-auth --external-admin-principal-type User
    --external-admin-name ${(await myUser).userPrincipalName} --external-admin-sid ${(await myUser).id}
    --tags ${toCliArgPairs(tags)}`;
  dbServer.then(s => console.log(`[db] server created ${s.fullyQualifiedDomainName}`));

  const db = dbServer.then(
    dbServer =>
      rg<SqlDatabase>`sql db create --name sample --server ${dbServer.name} --tier Basic --tags ${toCliArgPairs(tags)}`,
  );
  db.then(db => console.log(`[db] database ${db.name} created`));

  const dbAccess = Promise.all([dbServer, myIp]).then(async ([dbServer, myIp]) => {
    await rg`sql server firewall-rule create -n MyRule --server ${dbServer.name} --start-ip-address ${myIp} --end-ip-address ${myIp}`;
    console.log(`[db] access allowed through firewall for ${myIp}`);
  });

  const runOnDb = async (action: (pool: mssql.ConnectionPool) => Promise<void>) => {
    await dbAccess; // wait for access before connecting
    const pool = new mssql.ConnectionPool({
      server: `${(await dbServer).name}.database.windows.net`,
      database: (await db).name,
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
      --private-connection-resource-id ${(await dbServer).id} --vnet-name ${vnet.name} --subnet ${"db"}
      --tags ${toCliArgPairs(tags)}`;

    await rg`network private-endpoint dns-zone-group create --name ${name}
      --endpoint-name ${privateEndpoint.name} --private-dns-zone ${zonePlDb.id} --zone-name ${zonePlDb.name}`;
    console.log(`[db] private endpoint ${privateEndpoint.name} ready`);
  })();

  return {
    dbServer: await dbServer,
    db: await db,
    runOnDb,
    sqlConnectionString: `Server=${(await dbServer).name}.database.windows.net;Database=${(await db).name};Authentication=Active Directory Managed Identity;`,
  };
})();

// -------------
// Container App
// -------------

const app = (async () => {
  const { vnet } = await network;

  const containerAppEnv = await rg.containerApp.envUpsert(`appenv-sample${resourceHash}-${rg.location}`, {
    vnetConfiguration: { infrastructureSubnetId: vnet.subnets?.find(s => s.name === "app")?.id },
    workloadProfiles: [{ name: "Consumption", workloadProfileType: "Consumption" }],
    tags,
  });
  console.log(`[app] app environment ${containerAppEnv.name} ready via ${containerAppEnv.staticIp}`);

  const { sqlConnectionString, runOnDb } = await database;

  // Prepare database for the application
  await runOnDb(async pool => {
    const statements = [
      "IF OBJECT_ID('NumberSearch', 'U') IS NULL CREATE TABLE NumberSearch ([Value] BIGINT NOT NULL);",
      "IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_NumberSearch_Value' AND object_id = OBJECT_ID('NumberSearch')) CREATE CLUSTERED INDEX IX_NumberSearch_Value ON NumberSearch ([Value]);",
    ];
    await pool.request().query(statements.join("\n"));
    console.log("[app] schema defined");
  });

  const containerApp = await rg.containerApp.appUpsert(`app-sample${resourceHash}`, {
    environmentId: containerAppEnv.id,
    workloadProfileName: "Consumption",
    template: {
      containers: [
        {
          name: "numbers-sample",
          image: "aarondandy/numbers:latest",
          env: [
            { name: "ConnectionStrings__MyDatabase", value: sqlConnectionString },
            { name: "FOO", value: "BAR" },
          ],
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
  console.log(`[app] ${containerApp.name} ready`);

  // permission app to DB
  await runOnDb(async pool => {
    const username = containerApp.name;
    const statements = [
      `IF NOT EXISTS (SELECT 1 FROM sys.sysusers WHERE [name] = '${username}') CREATE USER [${username}] FROM EXTERNAL PROVIDER;`,
      ...["db_datareader", "db_datawriter", "db_ddladmin"].map(
        role => `EXEC sp_addrolemember [${role}],[${username}];`,
      ),
    ];
    await pool.request().query(statements.join("\n"));
  });
  console.log(`[app] ${containerApp.name} database access granted`);

  return containerApp;
})();

console.log(`[app] app revision ready ${"https://" + (await app).configuration?.ingress?.fqdn}`);
