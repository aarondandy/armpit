import yargs from "yargs";
import az, { type Account } from "armpit";

const argv = await yargs(process.argv.slice(2)).option({
  s: { type: "string", demandOption: false },
  t: { type: "string", demandOption: false },
}).parseAsync();

let currentAccount: Account | null;
if (argv.s) {
  // If a subscription is specified then try to set that as the active subscription
  currentAccount = await az.account.setOrLogin(argv.s, argv.t);
} else if (argv.t) {
  throw new Error("Specify a subscription corresponding to the tenant");
} else {
  currentAccount = await az.account.show();
  currentAccount ??= (await az.account.login())?.find(x => x.isDefault) ?? null;
}

console.log("*Hacker voice* I'm in:", currentAccount);
