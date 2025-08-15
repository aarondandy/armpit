import { type RoleAssignment, type RoleDefinition } from "@azure/arm-authorization";
import az from "armpit";

import { inspect } from "util";

// This script looks for role assignments which may unintentionally give */read access based on
// https://www.token.security/blog/azures-role-roulette-how-over-privileged-roles-and-api-vulnerabilities-expose-enterprise-networks

const account = (await az.account.show()) ?? (await az.account.login());
if (account == null) {
  throw new Error("Login failure");
}

const fullReadAction = "*/read";
const allRoles = await az<RoleDefinition[]>`role definition list`;
const fullReadRoles = allRoles.filter(r => r.permissions?.some(p => p.actions?.includes(fullReadAction)));
const implicitReadRoles = fullReadRoles.filter(r => !(r.roleType === "BuiltInRole" && r.roleName === "Reader"));
const implicitReadRoleDefinitionIds = implicitReadRoles.map(r => r.id);

console.log(`The following role definitions have '${fullReadAction}' access:`);

console.log(inspect(implicitReadRoles, { depth: null, colors: true }));

console.log(implicitReadRoles.map(r => r.roleName));

const assignments = await az<RoleAssignment[]>`role assignment list --all`;
const uhOh = assignments.filter(a => implicitReadRoleDefinitionIds.includes(a.roleDefinitionId));

if (uhOh && uhOh.length > 0) {
  console.log(`The following role assignments may give unintended '${fullReadAction}' access:`);
  console.log(uhOh);
} else {
  console.log("Nothing found");
}
