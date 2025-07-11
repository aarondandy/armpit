import { az, ExistingGroupLocationConflictError, GroupNotEmptyError } from "armpit";
import { loadMyEnvironment } from "./utils/state.js";

// An active account and default subscription are needed to get started.
const targetEnvironment = await loadMyEnvironment("samples");
const account = await az.account.setOrLogin(targetEnvironment);

console.log(`Logged in to ${account?.name}`);

// This example is all about creating resource groups and doing work within them.
// Calling group on the global az object ensures a resource group exists and then
// also generates a derived CLI invoker that has its defaults bound to that group's
// resource group name and location. This means that when using the specialized
// CLI invoker that is returned from the group function, there is no need to
// redundantly specify --location or --resource-group arguments. Additionally, the
// invoker also has some properties set on it like "id", "name", and "location"
// which describe the resource group the defaults are bound to.
const rg = await az.group("group-testing", "centralus");

// Lets take a peek at that:
console.log(`group ${rg.name} exists in ${rg.location}:`);

// For example purposes lets make a network security group or NSG within our
// resource group. The command to do that is "az network nsg rule create" and it
// has required arguments of -g/--resource-group and -n/--name. The required "-g"
// argument is omitted on the command invocation below because it is already set
// as a default when called from our "rg" instance. While it would be awkward to
// do so, it is still possible to override or redundantly specify a resource
// group name explicitly using --resource-group or -g on most commands.
//
// In addition to the default group name, take note that the az prefix is not
// added on to the command. The invokers add that automatically before invoking
// the Azure CLI command.
await rg`network nsg create -n foo`;

// The same applies to a show command on the rg instance too:
let nsg : { name: string };
nsg = await rg`network nsg show -n foo`;
console.log("NSG from rg:", nsg.name);

// Calling it from the global instance however requires specifying the group:
try {
  // First, attempt to show the NSG in a global context without a group name.
  nsg = await az`network nsg show -n foo`;

  throw new Error("This should be unreachable because of the incorrect command above");
} catch (err: any) {
  if (typeof err.message === "string" && err.message.includes("--resource-group")) {
    console.log("Oops! The resource group needs to be specified as an argument");
    // That didn't work! Add the group name on there and try again.
    nsg = await az`network nsg show -n foo -g ${rg.name}`;
  } else {
    throw err;
  }
}

console.log("NSG from az:", nsg.name);

// The group function is effectively idempotent, meaning calling it multiple times
// with the same arguments should be totally safe and without surprises.
await az.group("group-testing", "centralus"); // it's still there

// If there is a conflicting location it will throw for safety.
try {
  await az.group("group-testing", "eastus");

  throw new Error("This should be unreachable because of the incorrect group location above");
} catch (err: any) {
  if (err instanceof ExistingGroupLocationConflictError) {
    console.log(`Oops! The group ${err.groupName} already exists in ${err.actualLocation} so referencing it in ${err.expectedLocation} failed`);
  } else {
    throw err;
  }
}

// There is a delete function for cleaning up a group. Before invoking a delete
// it will query resources to ensure the group is empty first.
try {
  await az.group.delete("group-testing");

  throw new Error("This should be unreachable as the above should fail because the group contains resources");
} catch (err: any) {
  if (err instanceof GroupNotEmptyError) {
    console.log(`Oops! Failed to delete ${err.groupName} because it's full of: ${err.resources?.map(r => r.name)}`);
  } else {
    throw err;
  }
}

// Deleting this resource should make the group empty again
console.log(`Deleting NSG ${nsg.name} ...`);
await rg<void>`network nsg delete -n ${nsg.name}`;
console.log(`Was NSG ${nsg.name} deleted? ${!await rg.lax`network nsg show -n ${nsg.name}`}`);

// Now try that delete again
console.log(`Deleting group...`);
await az.group.delete("group-testing");
console.log(`Was group deleted? ${!await az.group.exists("group-testing")}`)
