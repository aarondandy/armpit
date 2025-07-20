import { $ as Execa$ } from "execa";
import type {
  ExecaError,
  Result as ExecaResult,
  SyncResult as ExecaSyncResult,
  TemplateExpression as ExecaTemplateExpression,
} from "execa";

interface Stringable {
  toString(): string;
}

type AzTemplateExpressionItem =
  | undefined // Many properties on ARM types are optional, which is annoying
  | null
  | string
  | number
  | ExecaResult
  | ExecaSyncResult
  | Stringable;
export type AzTemplateExpression = AzTemplateExpressionItem | readonly AzTemplateExpressionItem[];

function isExecaResult(value: unknown): value is ExecaResult | ExecaSyncResult {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return !!(value && ((value as any).command || (value as any).stdout || (value as any).stderr));
}

interface InvokerOptions {
  env?: NodeJS.ProcessEnv;
  defaultLocation?: string;
  defaultResourceGroup?: string;
  forceAzCommandPrefix?: boolean;
  abortSignal?: AbortSignal;
}

function ensureAzPrefix(templates: TemplateStringsArray) {
  if (templates.length > 0 && !/^\s*az\s/i.test(templates[0])) {
    const [firstCookedTemplate, ...remainingCookedTemplates] = templates;
    const [firstRawTemplate, ...remainingRawTemplates] = templates.raw;
    templates = Object.assign([`az ${firstCookedTemplate}`, ...remainingCookedTemplates], {
      raw: [`az ${firstRawTemplate}`, ...remainingRawTemplates],
    });
  }

  return templates;
}

function extractWrappedResponsePropertyName(response: object): string | null {
  let propName: string | null = null;
  for (const key in response) {
    if (Object.hasOwn(response, key)) {
      if (propName == null) {
        propName = key;
      } else {
        // If there are multiple properties then it doesn't fit the shape of a wrapped response
        return null;
      }
    }
  }

  if (propName) {
    // Some create responses have {NewX:{}} or {newX:{}} wrappers
    // around the actual response. This will detect if the
    if (/^[Nn]ew[A-Za-z]+$/.test(propName)) {
      return propName;
    }

    if (propName === "publicIp") {
      return propName;
    }
  }

  return null;
}

function simplifyContainerAppResult(result: object) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if (result != null && (result as any).properties != null) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { properties, ...rest } = result as any;
    return { ...rest, ...properties };
  }

  return result;
}

export interface AzCliInvoker {
  strict: <T>(templates: TemplateStringsArray, ...expressions: readonly AzTemplateExpression[]) => Promise<T>;
  lax: <T>(templates: TemplateStringsArray, ...expressions: readonly AzTemplateExpression[]) => Promise<T | null>;
}

interface CliInvokerFnFactoryOptions {
  laxResultHandling?: boolean;
  unwrapNewResults?: boolean;
  simplifyContainerAppResults?: boolean;
}

type InvokerFnFactory = <TOptions extends CliInvokerFnFactoryOptions>(
  options: TOptions,
) => <TResult>(
  templates: TemplateStringsArray,
  ...expressions: readonly AzTemplateExpression[]
) => Promise<TOptions extends { laxParsing: true } ? TResult | null : TResult>;

export function execaAzCliInvokerFactory<TInvokerOptions extends InvokerOptions>(
  options: TInvokerOptions,
): AzCliInvoker {
  const env: NodeJS.ProcessEnv = {
    ...options.env,
    AZURE_CORE_OUTPUT: "json", // request json by default
    AZURE_CORE_ONLY_SHOW_ERRORS: "true", // the tools aren't always consistent so this is just simpler
    AZURE_CORE_DISABLE_PROGRESS_BAR: "true", // avoid progress bars and spinners
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
    stdin: "inherit",
    stdout: "pipe",
    stderr: "pipe",
    cancelSignal: options.abortSignal,
  });

  const invokerFnBuilder: InvokerFnFactory = <TFnOptions extends CliInvokerFnFactoryOptions>(fnOptions: TFnOptions) => {
    return async (templates: TemplateStringsArray, ...expressions: readonly AzTemplateExpression[]) => {
      if (options.forceAzCommandPrefix) {
        templates = ensureAzPrefix(templates);
      }

      // Expressions of nullish values are converted to Execa template expressions.
      // Expressions with toString are converted to strings when needed.
      function cleanExpression(e: AzTemplateExpression): ExecaTemplateExpression {
        if (e == null) {
          return "";
        }

        switch (typeof e) {
          case "number":
          case "string":
            return e;
          case "object":
          default:
            if (Array.isArray(e)) {
              return e.map(cleanExpression) as ExecaTemplateExpression;
            }

            if (isExecaResult(e)) {
              return e;
            }

            if (typeof e.toString === "function") {
              return e.toString();
            }

            return e as ExecaTemplateExpression;
        }
      }
      const execaExpressions = expressions.map(cleanExpression);

      let invocationResult;
      try {
        invocationResult = await execaInvoker(templates, ...execaExpressions);
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
        return parseJson(stdout);
      } else if (Array.isArray(stdout)) {
        return parseJson((<string[]>stdout).join(""));
      } else {
        throw new Error("Failed to parse invocation result");
      }

      function parseJson(value: string) {
        if (value == null || value === "") {
          return null; // empty result
        }

        let result = JSON.parse(value);

        if (fnOptions.unwrapNewResults) {
          const wrappedPropName = extractWrappedResponsePropertyName(result);
          if (wrappedPropName != null) {
            result = result[wrappedPropName];
          }
        }

        if (result.type != null && typeof result.type === "string") {
          if (fnOptions.simplifyContainerAppResults && /Microsoft.App\//i.test(result.type)) {
            result = simplifyContainerAppResult(result);
          }
        }

        return result;
      }
    };
  };

  const baseInvokerOptions = {
    unwrapNewResults: true,
    simplifyContainerAppResults: true,
  };

  return {
    strict: invokerFnBuilder({ ...baseInvokerOptions }),
    lax: invokerFnBuilder({ ...baseInvokerOptions, laxResultHandling: true }),
  };
}
