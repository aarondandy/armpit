import { az, NameHash } from "armpit";
import { loadMyEnvironment } from "./utils/state.js";
import type { StorageAccount, BlobContainer } from "@azure/arm-storage";

const targetEnvironment = await loadMyEnvironment("samples");
const targetLocation = targetEnvironment.defaultLocation ?? "centralus";
await az.account.setOrLogin(targetEnvironment);
const rg = await az.group(`samples-${targetLocation}`, targetLocation);
const resourceHash = new NameHash(targetEnvironment.subscriptionId, { defaultLength: 6 }).concat(rg.name);

const sa = await rg<StorageAccount>`storage account create
  -n samples${resourceHash}
  --sku Standard_LRS --kind StorageV2
  --allow-blob-public-access true`;
console.log(`storage ready ${sa.name}`);

const { userPrincipalName } = await az<any>`ad signed-in-user show`; // TODO: move into az.account or something and/or get types for it
await az`role assignment create --assignee ${userPrincipalName} --role ${"Storage Account Contributor"} --scope ${sa.id}`

const stuff = await rg<BlobContainer>`storage container-rm create
  --name stuff --storage-account ${sa.name} --public-access blob`;
console.log(`container ${sa.primaryEndpoints?.blob}${stuff.name}`);

const filePath = "something";
const blob = await rg<any>`storage blob upload --name ${filePath}
  --account-name ${sa.name} --container-name ${stuff.name}
  --data ${`timestamp ${new Date()}`} --content-type text/plain
  --overwrite true`;
const blobUrl = `${sa.primaryEndpoints?.blob}${stuff.name}/${filePath}`;
console.log(`uploaded blob ${blobUrl} etag ${blob.etag}`);

console.log(`download result: ${await fetch(blobUrl).then(b => b.text())}`)

