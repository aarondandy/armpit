import path from "node:path";
import fs from "node:fs/promises";
import yargs from "yargs";
import { az } from "armpit";
import type { ResourceGroup } from "@azure/arm-resources";

interface MyConfig {
  envs: { code: string, subscriptionId: string, tenantId: string }[]
}
const myConfig: MyConfig = JSON.parse(await fs.readFile(path.join(import.meta.dirname, "my-config.json"), "utf8"));
const myEnvironments = myConfig.envs; // These are all of the environments this script may be run against.

// Use CLI arguments or defaults to select an environment
const argv = await yargs(process.argv.slice(2)).option({
  env: { type: "string", demandOption: false },
}).parseAsync();
const targetEnvironment = argv.env ? myEnvironments.find(e => e.code == argv.env) : myEnvironments[0];
if (!targetEnvironment) {
  throw new Error("Target environment not supported");
}

console.log(`Selected environment: ${targetEnvironment.code}`);

// Set the account to access the environment with
const targetAccount = await az.account.setOrLogin(targetEnvironment.subscriptionId, targetEnvironment.tenantId);
if (!targetAccount) {
  throw new Error(`Failed to log in for ${targetEnvironment.code}`)
}

console.log(`Active account: ${targetAccount.name}`)

for (const group of await az<ResourceGroup[]>`group list` ?? []) {
  console.log(`${group.name} in ${group.location}`);
}
