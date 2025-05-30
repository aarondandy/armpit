import { loadMyConfig } from "./myConfig";
import yargs from "yargs";
import { az } from "armpit";
import type { ResourceGroup } from "@azure/arm-resources";

const myEnvironments = (await loadMyConfig()).envs;

// Use CLI arguments or defaults to select an environment
const argv = await yargs(process.argv.slice(2)).option({
  env: { type: "string", demandOption: false },
}).parseAsync();
const targetEnvironment = argv.env ? myEnvironments.find(e => e.code == argv.env) : myEnvironments[0];
if (!targetEnvironment) throw new Error("Target environment not supported");

console.log(`Selected environment: ${targetEnvironment.code}`);

// Set the account to access the environment with
const targetAccount = await az.account.setOrLogin(targetEnvironment.subscriptionId, targetEnvironment.tenantId);
if (!targetAccount) throw new Error(`Failed to log in for ${targetEnvironment.code}`);

console.log("Active account:", targetAccount);

for (const group of await az<ResourceGroup[]>`group list`) {
  console.log(`${group.name} in ${group.location}`);
}
