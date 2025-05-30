import path from "node:path";
import fs from "node:fs/promises";

interface MyEnv {
  code: string,
  subscriptionId: string,
  tenantId: string
}

interface MyConfig {
  envs: MyEnv[]
}

export async function loadMyConfig() {
  const configPath = path.join(import.meta.dirname, "myConfig.json");
  const myConfig: MyConfig = <MyConfig>JSON.parse(await fs.readFile(configPath, "utf8"));
  if (!myConfig) {
    throw new Error("Config not valid");
  }

  return myConfig;
}
