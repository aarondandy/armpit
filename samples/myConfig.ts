import path from "node:path";
import fs from "node:fs/promises";
import { isSubscriptionId, isTenantId } from "armpit";

// This file establishes different environments to operate in for the sample scripts.
// It is recommended that users create their own conventions and tools, but maybe this
// can act as inspiration.

interface MyEnv {
  code: string,
  subscriptionId: string,
  tenantId: string,
}

interface MyConfig {
  envs: MyEnv[]
}

async function writeConfigTemplate(configPath: string) {
  const configTemplate: MyConfig = {
    envs: [
      {
        code: "samples",
        subscriptionId: "<your-subscription-id>",
        tenantId: "<your-azure-tenant-id>",
      }
    ]
  }
  await fs.writeFile(configPath, JSON.stringify(configTemplate, null, 2));
}

export async function loadMyConfig() {
  const configPath = path.join(import.meta.dirname, "myConfig.json");

  try {
    const myConfig = <MyConfig>JSON.parse(await fs.readFile(configPath, "utf8"));
    if (!(myConfig.envs?.length > 0)) {
      throw new Error(`Config file requires some environments: ${configPath}`);
    }

    return myConfig;
  } catch (err) {
    if (err instanceof Error && "code" in err && err.code === "ENOENT" && "errno" in err && err.errno == -4058) {
      console.log(`Creating new config file: ${configPath}`);
      await writeConfigTemplate(configPath);
      throw new Error(`Configure with your details: ${configPath}`);
    }

    throw err;
  }
}

export async function loadMyEnvironment(code: string) {
  const config = await loadMyConfig();
  const env = config.envs?.find(e => e.code === code);
  if (!env) {
    throw new Error(`Environment ${code} not found in ${config.envs?.map(e => e.code)}`);
  }

  if (!env.subscriptionId) {
    throw new Error(`Environment ${env.code} requires a subscriptionId`);
  } else if (!isSubscriptionId(env.subscriptionId)) {
    throw new Error(`Environment ${env.code} has an invalid subscriptionId: ${env.subscriptionId}`);
  }

  if (env.tenantId && !isTenantId(env.tenantId)) {
    throw new Error(`Environment ${env.code} has an invalid tenantId: ${env.tenantId}`);
  }

  return env;
}
