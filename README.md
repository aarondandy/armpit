# Armpit

Manage Azure cloud resources imperatively using TypeScript.

- Write automation scripts in TypeScript with the features the language offers.
- Leverage the [Azure CLI](https://learn.microsoft.com/en-us/cli/azure/) with simple result serialization and easy argument passing via [Execa](https://github.com/sindresorhus/execa).
- Use API based upsert and get helpers, or work directly against the [Azure SDK](https://github.com/Azure/azure-sdk-for-js).
- Run steps asynchronously for improved performance in more complex scripts using `async` and `Promise` features.
- Handle complex scenarios using TypeScript language features for [branching](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Statements/if...else) or [iteration](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Statements/for).

```typescript
import type { SkuName, StorageAccount } from "@azure/arm-storage";
import az from "armpit";

const sku: SkuName = "Standard_LRS";
const name = "garbagefile";

await az.account.ensureActiveAccount();
const rg = await az.group("samples", "centralus");
const sa = await rg<StorageAccount>`storage account create -n ${name} --sku ${sku} --kind StorageV2`;
console.log(`Storage account ready: ${sa.name}`);
```

For more samples, see the [samples workspace](./samples/).

## Prerequisites

- This project depends on the [Azure CLI](https://learn.microsoft.com/en-us/cli/azure/) to function. While it does use the SDK for some features, the core functionality and authentication is handled via the `az` command line tools.

## Quick Start

1. Start with a clean slate typescript module or use an existing typescript module. See the sample [tsconfig.json](./samples/tsconfig.json) and [package.json](./samples/package.json) for inspiration.
2. Install the package to use the tools: `npm i armpit`
3. Write your script.
4. Run your script. I like [tsx](https://www.npmjs.com/package/tsx) but it's your script, so do what works for you. Example: `npx tsx doTheThings.ts`
