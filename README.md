# Armpit

Manage Azure cloud resources imperatively using TypeScript.

- Write automation scripts in TypeScript, a <abbr title="Domain Specific Language">DSL</abbr> designed for working with <abbr title="JavaScript Object Notation">JSON</abbr> data.
- Leverage the [Azure CLI](https://learn.microsoft.com/en-us/cli/azure/) with simple result serialization and easy argument passing via [Execa](https://github.com/sindresorhus/execa).
- Can be used along with the [Azure SDK](https://github.com/Azure/azure-sdk-for-js) too and with some specialized helpers!
- Run steps asynchronously for improved performance in more complex scripts.
- A powerful language for complex scenarios requiring [branching](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Statements/if...else) or [iteration](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Statements/for).

### Examples

A simple script to define a storage account:

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

More samples can be found in the [samples workspace](./samples/).
