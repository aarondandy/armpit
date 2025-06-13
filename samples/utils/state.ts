import path from "node:path";
import fs from "node:fs/promises";
import { isSubscriptionId, isTenantId } from "armpit";

// This file has utilities needed to maintain state and configuration for the sample scripts.
// It is recommended that users create their own conventions and tools that better meet their
// specific needs. Feel free to use this as inspiration though.

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

function getDataFolderPath() {
  return path.join(import.meta.dirname, "..", "data");
}

function findArgScriptName(): string | null {
  for (let i = 1; i < process.argv.length; i++) {
    const arg = process.argv[i];
    if (/^(.+)\.[jt]s$/i.test(arg)) {
      return arg;
    }
  }

  return null;
}

function getDefaultScriptName(): string {
  let name = findArgScriptName();

  if (name) {
    name = path.parse(name).name;
  }

  if (!name) {
    throw new Error("failed to extract state name from executing script file");
  }

  return name;
}

export async function loadMyConfig() {
  const configPath = path.join(getDataFolderPath(), "myConfig.json");

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

function getStatePath(name?: string) {
  name ??= getDefaultScriptName();
  return path.join(getDataFolderPath(), `${name}.state.json`);
}

export async function loadState<TState>(name?: string) {
  const stateFilePath = getStatePath(name);

  let state: TState;
  try {
    state = <TState>JSON.parse(await fs.readFile(stateFilePath, "utf8"));
  } catch (err) {
    if (err instanceof Error && "code" in err && err.code === "ENOENT" && "errno" in err && err.errno == -4058) {
      console.log(`Creating new state file: ${stateFilePath}`);
      state = { } as TState;
      await fs.writeFile(stateFilePath, JSON.stringify(state, null, 2));
    } else {
      throw err;
    }
  }

  return state;
}

export async function saveState<TState>(state: TState, name?: string) {
  const stateFilePath = getStatePath(name);
  await fs.writeFile(stateFilePath, JSON.stringify(state, null, 2));
}
