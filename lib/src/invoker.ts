import { $ as Execa$ } from "execa";
import type {
  ExecaError,
  Result as ExecaResult,
  SyncResult as ExecaSyncResult,
  TemplateExpression as ExecaTemplateExpression
} from "execa";

type AzTemplateExpressionItem =
  | undefined // Many properties on ARM types are optional, which is annoying
  | string
  | number
  | ExecaResult
  | ExecaSyncResult;
export type AzTemplateExpression = AzTemplateExpressionItem | readonly AzTemplateExpressionItem[]

interface InvokerOptions {
  env?: NodeJS.ProcessEnv,
  defaultLocation?: string,
  defaultResourceGroup?: string,
  forceAzCommandPrefix?: boolean,
}

function ensureAzPrefix(templates: TemplateStringsArray) {
  if (templates.length > 0 && !/^\s*az\s/i.test(templates[0])) {
    const [firstCookedTemplate, ...remainingCookedTemplates] = templates;
    const [firstRawTemplate, ...remainingRawTemplates] = templates.raw;
    templates = Object.assign([`az ${firstCookedTemplate}`, ...remainingCookedTemplates], {
      raw: [`az ${firstRawTemplate}`, ...remainingRawTemplates]
    });
  }

  return templates;
}

export interface CliInvokers {
  strict: <T>(templates: TemplateStringsArray, ...expressions: readonly AzTemplateExpression[]) => Promise<T>;
  lax: <T>(templates: TemplateStringsArray, ...expressions: readonly AzTemplateExpression[]) => Promise<T | null>;
}

interface CliInvokerFnFactoryOptions {
  laxResultHandling?: boolean
}

type InvokerFnFactory = <TOptions extends CliInvokerFnFactoryOptions>(options: TOptions) => <TResult>(templates: TemplateStringsArray, ...expressions: readonly AzTemplateExpression[]) => Promise<TOptions extends { laxParsing: true } ? (TResult | null) : TResult>;

export function execaAzCliInvokerFactory<TInvokerOptions extends InvokerOptions>(options: TInvokerOptions): CliInvokers {
  const env: NodeJS.ProcessEnv = {
    ...options.env,
    AZURE_CORE_OUTPUT: "json", // request json by default
    AZURE_CORE_ONLY_SHOW_ERRORS: "true", // the tools aren't always consistent so this is just simpler
    AZURE_CORE_NO_COLOR: "true", // hopefully this reduces some noise in stderr and stdout
    AZURE_CORE_LOGIN_EXPERIENCE_V2: "off", // these tools have their own way to select accounts
  };

  if (options.defaultResourceGroup != null) {
    env.AZURE_DEFAULTS_GROUP = options.defaultResourceGroup;
  }

  if (options.defaultLocation != null) {
    env.AZURE_DEFAULTS_LOCATION = options.defaultLocation;
  }

  const execaInvoker = Execa$({
    env,
  });

  const invokerFnBuilder: InvokerFnFactory = <TFnOptions extends CliInvokerFnFactoryOptions>(fnOptions: TFnOptions) => {
    return async (templates: TemplateStringsArray, ...expressions: readonly AzTemplateExpression[]) => {
      if (options.forceAzCommandPrefix) {
        templates = ensureAzPrefix(templates);
      }

      // TODO: coerce nullish expressions into "" to simplify usage ... but maybe only if it has lax arg handling configured

      let invocationResult;
      try {
        invocationResult = await execaInvoker(templates, ...(expressions as ExecaTemplateExpression[]));
      } catch (invocationError) {
        if (fnOptions.laxResultHandling) {
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
        return null; // even for lax rules because what else should be done with a blank response from delete for example.
      } else if (typeof stdout === "string") {
        return JSON.parse(stdout);
      } else if (Array.isArray(stdout)) {
        return JSON.parse((<string[]>stdout).join(""));
      } else {
        throw new Error("Failed to parse invocation result");
      }
    };
  };

  return {
    strict: invokerFnBuilder({ }),
    lax: invokerFnBuilder({ laxResultHandling: true }),
  }
}
