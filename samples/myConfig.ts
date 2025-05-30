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

  try {
    const myConfig = <MyConfig>JSON.parse(await fs.readFile(configPath, "utf8"));
    if (!(myConfig.envs?.length > 0)) {
      throw new Error(`Config file requires environments: ${configPath}`);
    }

    return myConfig;
  } catch (err) {
    if (err instanceof Error && "code" in err && err.code === "ENOENT" && "errno" in err && err.errno == -4058) {
      console.log(`Creating new config file: ${configPath}`);
      await fs.writeFile(configPath, '{"envs":[{"code":"dev", "subscriptionId": "<todo>", "tenantId": "<todo>"}]}');
      throw new Error(`Complete config for ${configPath}`);
    }

    throw err;
  }
}
