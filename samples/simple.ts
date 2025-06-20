import type { SkuName, StorageAccount } from "@azure/arm-storage";
import az from "armpit";

const sku: SkuName = "Standard_LRS";
const name = "garbagefile";

await az.account.ensureActiveAccount();
const rg = await az.group("samples", "centralus");
const sa = await rg<StorageAccount>`storage account create -n ${name} --sku ${sku} --kind StorageV2`;
console.log(`Storage account ready: ${sa.name}`);
