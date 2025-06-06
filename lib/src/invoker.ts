import { $ as Execa$, type ExecaError, type TemplateExpression } from "execa";

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

interface Invokers {
  strict: <T>(templates: TemplateStringsArray, ...expressions: readonly TemplateExpression[]) => Promise<T>;
  lax: <T>(templates: TemplateStringsArray, ...expressions: readonly TemplateExpression[]) => Promise<T | null>;
}

interface InvokerFnFactoryOptions {
  laxParsing?: boolean
}

type InvokerFnFactory = <TOptions extends InvokerFnFactoryOptions>(options: TOptions) => <TResult>(templates: TemplateStringsArray, ...expressions: readonly TemplateExpression[]) => Promise<TOptions extends { laxParsing: true } ? (TResult | null) : TResult>;

export function execaAzCliInvokerFactory<TInvokerOptions extends InvokerOptions>(options: TInvokerOptions): Invokers {
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


  const invokerFnBuilder: InvokerFnFactory = <TFnOptions extends InvokerFnFactoryOptions>(fnOptions: TFnOptions) => {
    return async (templates: TemplateStringsArray, ...expressions: readonly TemplateExpression[]) => {
      if (options.forceAzCommandPrefix) {
        templates = ensureAzPrefix(templates);
      }

      let invocationResult;
      try {
        invocationResult = await execaInvoker(templates, ...expressions);
      } catch (invocationError) {
        if (fnOptions.laxParsing) {
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
        if (fnOptions.laxParsing) {
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
  };

  return {
    strict: invokerFnBuilder({ }),
    lax: invokerFnBuilder({ laxParsing: true }),
  }
}
