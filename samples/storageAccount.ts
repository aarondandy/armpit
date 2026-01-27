import { az, toCliArgPairs, NameHash } from "armpit";
import { loadMyEnvironment } from "./utils/state.js";
import type { SkuName, StorageAccount, BlobContainer } from "@azure/arm-storage";

// --------------------------
// Environment & Subscription
// --------------------------

const tags = { env: "samples", script: import.meta.url.split("/").pop()! } as const;
const targetEnvironment = await loadMyEnvironment("samples");
const targetLocation = targetEnvironment.defaultLocation ?? "centralus";
await az.account.setOrLogin(targetEnvironment);

const rg = await az.group(`samples-${targetLocation}`, targetLocation, { tags });
const resourceHash = new NameHash(targetEnvironment.subscriptionId, { defaultLength: 6 }).concat(rg.name);

// -----------------
// Storage Resources
// -----------------

// Ensure the storage account is setup
const sku: SkuName = "Standard_LRS";
const sa = await rg<StorageAccount>`storage account create
  -n sample${resourceHash} --sku ${sku} --kind StorageV2
  --allow-blob-public-access true --https-only true
  --tags ${toCliArgPairs(tags)}`;
console.log(`storage ready ${sa.name}`);

// Give ourselves access
const user = await az.account.showSignedInUser();
await az`role assignment create --assignee ${user.userPrincipalName} --role ${"Storage Account Contributor"} --scope ${sa.id}`;

// ---------------
// Storage Testing
// ---------------

// Ensure storage containers exist and upload content to each in parallel
const sampleContainers = [
  { container: "stuff", file: "something" },
  { container: "things", file: "timestamp" },
];
const allUrls = await Promise.all(
  sampleContainers.map(async ({ container: containerName, file: blobFilePath }) => {
    // Ensure the container exists
    const container = await rg<BlobContainer>`storage container-rm create
    --name ${containerName} --storage-account ${sa.name} --public-access blob`;
    console.log(`container ${sa.primaryEndpoints?.blob}${container.name} created`);

    // Upload a blob
    const blobUrl = `${sa.primaryEndpoints?.blob}${container.name}/${blobFilePath}`;
    const blob = await rg<any>`storage blob upload
    --name ${blobFilePath} --container-name ${container.name} --account-name ${sa.name}
    --data ${`timestamp ${new Date()}`} --content-type text/plain --overwrite true`;
    console.log(`uploaded blob ${blobUrl}: etag ${blob.etag}`);

    // Download the content
    console.log(`download blob ${blobUrl}: ${await fetch(blobUrl).then(b => b.text())}`);
    return blobUrl;
  }),
);

console.log("All blob URLs:", allUrls);
