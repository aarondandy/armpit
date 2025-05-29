import { $ as Execa$ } from "execa";
import type { TemplateExpression, ExecaError, /*ExecaScriptMethod*/ } from "execa";
import type { Location } from "@azure/arm-resources-subscriptions";
//import type { ResourceGroup } from "@azure/arm-resources";
import type { Account } from "./azureTypes.js";

export type { Account };

interface AzureCliOptions {
  env?: NodeJS.ProcessEnv,
  subscription?: string,
  defaultLocation?: string,
  defaultResourceGroup?: string,
  laxParsing?: boolean,
  forceAzCommandPrefix?: boolean,
}

type TagTemplateParameters = readonly [TemplateStringsArray, ...readonly TemplateExpression[]];
type AzCliInvokerFactory = <TOptions extends AzureCliOptions>(options: TOptions) => <TResult>(...args: TagTemplateParameters) => Promise<TOptions extends { laxParsing: true } ? (TResult | null) : TResult>;

interface AzCliInvokable {
  <T>(templates: TemplateStringsArray, ...expressions: readonly TemplateExpression[]): Promise<T>;
  strict: <T>(templates: TemplateStringsArray, ...expressions: readonly TemplateExpression[]) => Promise<T>;
  lax: <T>(templates: TemplateStringsArray, ...expressions: readonly TemplateExpression[]) => Promise<T | null>;
}

const ensureAzPrefix = function(templates: TemplateStringsArray) {
  if (templates.length > 0 && !/^\s*az\s/i.test(templates[0])) {
    const [firstCookedTemplate, ...remainingCookedTemplates] = templates;
    const [firstRawTemplate, ...remainingRawTemplates] = templates.raw;
    templates = Object.assign([`az ${firstCookedTemplate}`, ...remainingCookedTemplates], {
      raw: [`az ${firstRawTemplate}`, ...remainingRawTemplates]
    });
  }

  return templates;
}

const execaAzCliInvokerFactory: AzCliInvokerFactory = function<TOptions extends AzureCliOptions>(options: TOptions) {
  const env: NodeJS.ProcessEnv = {
    ...options.env,
    // Force the CLI tools to give us parsable results
    AZURE_CORE_OUTPUT: "json",
    AZURE_CORE_ONLY_SHOW_ERRORS: "true",
    // Attempt to avoid CLI interactivity when we are running a script
    AZURE_CORE_LOGIN_EXPERIENCE_V2: "off",
  };

  if (options.defaultResourceGroup) {
    env["AZURE_DEFAULTS_GROUP"] = options.defaultResourceGroup;
  }

  if (options.defaultLocation) {
    env["AZURE_DEFAULTS_LOCATION"] = options.defaultLocation;
  }

  const execaInvoker = Execa$({
    env: {
      ...env
    },
  });

  return async (templates, ...expressions) => {
    if (options.forceAzCommandPrefix) {
      templates = ensureAzPrefix(templates);
    }
    let invocationResult;
    try {
      invocationResult = await execaInvoker(templates, ...expressions);
    } catch (invocationError) {
      if (options.laxParsing) {
        const stderr = (<ExecaError>invocationError)?.stderr;
        if (stderr && typeof stderr === "string" && /not\s*found/i.test(stderr)) {
          return null;
        }
      }

      throw invocationError;
    }

    const { stdout, stderr } = invocationResult;

    if (stderr != null && stderr !== "") {
      console.warn(stderr);
    }

    if (stdout == null || stdout === "") {
      if (options.laxParsing) {
        return null;
      } else {
        throw new Error("Resulting stream was empty");
      }
    } else if (typeof stdout === "string") {
      return JSON.parse(stdout);
    } else if (Array.isArray(stdout)) {
      return JSON.parse((<string[]>stdout).join(""));
    } else {
      throw new Error("Failed to parse invocation result");
    }
  };
}

class AzCliAccount {
  #azCli: AzCliInvokable;

  constructor(azCli: AzCliInvokable) {
    this.#azCli = azCli;
  }

  async show() {
    try {
      return await this.#azCli.lax<Account>`account show`;
    } catch (invocationError) {
      const stderr = (<ExecaError>invocationError)?.stderr;
      if (stderr && typeof stderr === "string" && (/az login|az account set/i).test(stderr)) {
        return null;
      }

      throw invocationError;
    }
  }

  async list() : Promise<Account[]> {
    return (await this.#azCli<Account[]>`account list`) ?? [];
  }

  async set(subscription: string) {
    await this.#azCli.lax<Account>`account set -s ${subscription}`;
  }

  async setOrLogin(subscription: string, tenantId?: string) {
    const testAccount = (account: Account | null) => account != null && (account.id === subscription || account.name === subscription);

    let account = await this.show();
    if (testAccount(account)) {
      return account;
    }

    // TODO: Consider refreshing and allowing a search of non-enabled accounts.
    //       That could come at a cost to performance though.
    let accounts = await this.list();
    account = accounts.find(testAccount) ?? null;
    if (account) {
      await this.set(subscription);
      return account;
    }

    console.debug("None of the logged in accounts match. Starting interactive login.");

    accounts = await this.login(tenantId) ?? [];
    account = accounts.find(testAccount) ?? null;

    if (!(account?.isDefault)) {
      await this.set(subscription);
      account = await this.show();
    }

    return account;
  }

  async login(tenantId?: string) : Promise<Account[] | null> {
    try {
      let loginAccounts : Account[] | null;
      if (tenantId) {
        loginAccounts = await this.#azCli<Account[]>`login --tenant ${tenantId}`;
      } else {
        loginAccounts = await this.#azCli<Account[]>`login`;
      }

      return loginAccounts;

    } catch (invocationError) {
      const stderr = (<ExecaError>invocationError)?.stderr;
      if (stderr && typeof stderr === "string" && (/User cancelled/i).test(stderr)) {
        return null;
      }

      throw invocationError;
    }
  }

  async listLocations(names?: string[]) {
    let results : Location[];
    if (names != null && names.length > 0) {
      const queryFilter = `[? contains([${names.map((n) => `'${n}'`).join(",")}],name)]`;
      results = await this.#azCli<Location[]>`account list-locations --query ${queryFilter}`;
    }
    else {
      results = await this.#azCli<Location[]>`account list-locations`;
    }

    return results ?? [];
  }
}

function buildAzCli() {
  const cliFnOptions = {
    forceAzCommandPrefix: true,
    laxParsing: false,
  };
  const strictFn = execaAzCliInvokerFactory(cliFnOptions);
  const laxFn = execaAzCliInvokerFactory({ ...cliFnOptions, laxParsing: true });
  const mainFn = strictFn; // TODO: there may be other overloads for this one

  const cliResult: AzCliInvokable = Object.assign(mainFn, {
    strict: strictFn,
    lax: laxFn
  });
  let result = Object.assign(cliResult, {
    account: new AzCliAccount(cliResult)
  });
  return result;
}

export const az = buildAzCli();

/*class AzCliGroup {
  #azCli: AzCli;

  constructor(azCli: AzCli) {
    this.#azCli = azCli;
  }

  list() {
    return this.#azCli<ResourceGroup[]>`group list`;
  }

  show(name: string) {
    return this.#azCli<ResourceGroup | null>`group show --name ${name}`;
  }
}*/
