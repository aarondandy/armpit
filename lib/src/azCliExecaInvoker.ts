import { $ as Execa$ } from "execa";
import type {
  ExecaError,
  Result as ExecaResult,
  SyncResult as ExecaSyncResult,
  TemplateExpression as ExecaTemplateExpression,
} from "execa";
import { CallableClassBase, isTemplateStringArray, isPromiseLike, isStringy as isStringy } from "./tsUtils.js";
import {
  AzCliInvoker,
  adjustCliResultObject,
  ensureAzPrefix,
  type AzTemplateExpression,
  type AzCliOptions,
  type AzCliInvocationOptions,
} from "./azCliInvoker.js";

function isExecaResult(value: unknown): value is ExecaResult | ExecaSyncResult {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return !!(value && ((value as any).command || (value as any).stdout || (value as any).stderr));
}

async function prepareExecaExpressionArg(e: AzTemplateExpression): Promise<ExecaTemplateExpression> {
  if (isPromiseLike(e)) {
    e = (await e) as AzTemplateExpression;
  }

  if (e == null) {
    return "";
  }

  switch (typeof e) {
    case "number":
    case "string":
      return e;
    case "boolean":
    case "symbol":
      return e.toString();
    case "bigint":
      return e.toString(10);
  }

  if (Array.isArray(e)) {
    return prepareExecaExpressionArgs(e) as Promise<ExecaTemplateExpression>;
  }

  if (isExecaResult(e)) {
    return e;
  }

  if (isStringy(e)) {
    return e.toString();
  }

  return e as ExecaTemplateExpression;
}

function prepareExecaExpressionArgs(
  azExpressions: readonly AzTemplateExpression[],
): Promise<ExecaTemplateExpression[]> {
  return Promise.all(azExpressions.map(prepareExecaExpressionArg));
}

// eslint-disable-next-line @typescript-eslint/no-unsafe-declaration-merging, @typescript-eslint/no-empty-object-type
export interface AzCliExecaInvoker extends AzCliInvoker {}

// eslint-disable-next-line @typescript-eslint/no-unsafe-declaration-merging
export class AzCliExecaInvoker extends CallableClassBase implements AzCliInvoker {
  #options: AzCliOptions;

  constructor(options?: AzCliInvocationOptions) {
    super();

    this.#options = {
      forceAzCommandPrefix: true,
      allowBlanks: false,
      unwrapResults: true,
      simplifyContainerAppResults: true,
      ...options,
    };
  }

  protected fnImpl(
    ...args:
      | [options: AzCliOptions]
      | [templates: TemplateStringsArray, ...expressions: readonly AzTemplateExpression[]]
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ): any {
    if (args.length > 0 && args[0] != null) {
      if (isTemplateStringArray(args[0])) {
        return this.#templateFn(
          ...(args as [templates: TemplateStringsArray, ...expressions: readonly AzTemplateExpression[]]),
        );
      }

      if (typeof args[0] === "object") {
        return this.#withOptions(args[0]);
      }
    }

    throw new Error("An option or template is required");
  }

  async #templateFn<TResult>(
    templates: TemplateStringsArray,
    ...expressions: readonly AzTemplateExpression[]
  ): Promise<TResult> {
    const execaEnv: NodeJS.ProcessEnv = {
      ...this.#options.env,
      AZURE_CORE_OUTPUT: "json", // request json by default
      AZURE_CORE_ONLY_SHOW_ERRORS: "true", // the tools aren't always consistent so this is just simpler
      AZURE_CORE_DISABLE_PROGRESS_BAR: "true", // avoid progress bars and spinners
      AZURE_CORE_NO_COLOR: "true", // hopefully this reduces some noise in stderr and stdout
      AZURE_CORE_LOGIN_EXPERIENCE_V2: "off", // these tools have their own way to select accounts
    };

    if (this.#options.defaultResourceGroup != null) {
      execaEnv.AZURE_DEFAULTS_GROUP = this.#options.defaultResourceGroup;
    }

    if (this.#options.defaultLocation != null) {
      execaEnv.AZURE_DEFAULTS_LOCATION = this.#options.defaultLocation;
    }

    const execaExpressions = await prepareExecaExpressionArgs(expressions); // TODO: fix the inputs!

    if (this.#options.forceAzCommandPrefix) {
      templates = ensureAzPrefix(templates);
    }

    const execaFn = Execa$({
      env: execaEnv,
      stdin: "inherit",
      stdout: "pipe",
      stderr: "pipe",
      cancelSignal: this.#options.abortSignal,
    });

    let invocationResult;
    try {
      invocationResult = await execaFn(templates, ...execaExpressions);
    } catch (invocationError) {
      if (this.#options.allowBlanks) {
        const stderr = (<ExecaError>invocationError)?.stderr;
        if (stderr && typeof stderr === "string" && /not\s*found/i.test(stderr)) {
          return null!;
        }
      }

      throw invocationError;
    }

    const { stdout, stderr } = invocationResult;

    if (stderr != null && stderr !== "") {
      console.warn(stderr);
    }

    if (stdout == null || stdout === "") {
      if (this.#options.allowBlanks) {
        return null!;
      } else {
        throw new Error("Result was blank");
      }
    } else if (typeof stdout === "string") {
      return this.#parseJsonResponse(stdout) as TResult;
    } else if (Array.isArray(stdout)) {
      return this.#parseJsonResponse((<string[]>stdout).join("")) as TResult;
    }

    throw new Error("Failed to parse invocation result");
  }

  #parseJsonResponse(value: string) {
    if (value == null || value === "") {
      return null;
    }

    return adjustCliResultObject(JSON.parse(value) as object, this.#options);
  }

  #withOptions(options: AzCliOptions) {
    return new AzCliExecaInvoker({
      ...this.#options,
      ...options,
    });
  }
}
