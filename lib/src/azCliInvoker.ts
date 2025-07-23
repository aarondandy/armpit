import { Stringy } from "./tsUtils.js";

export type AzTemplateExpressionItem =
  | undefined // Many properties on ARM types are optional, which is annoying
  | null
  | string
  | number
  | Stringy; // TODO: Get some boolean added to here
export type AzTemplateExpression = AzTemplateExpressionItem | readonly AzTemplateExpressionItem[];

export interface AzCliInvocationOptions {
  env?: NodeJS.ProcessEnv;
  defaultLocation?: string;
  defaultResourceGroup?: string;
  forceAzCommandPrefix?: boolean;
  abortSignal?: AbortSignal;
}

export interface AzCliParsingOptions {
  allowBlanks?: boolean;
  unwrapResults?: boolean;
  simplifyContainerAppResults?: boolean;
}

export type AzCliOptions = AzCliInvocationOptions & AzCliParsingOptions;

export interface AzCliTemplateFn<TBlankResult extends null | never> {
  <TResult>(
    templates: TemplateStringsArray,
    ...expressions: readonly AzTemplateExpression[]
  ): Promise<TResult | TBlankResult>;
}

interface AzCliSpawnFn {
  <TOptions extends AzCliOptions>(
    options: TOptions,
  ): AzCliTemplateFn<TOptions extends { allowBlanks: true } ? null : never>;
}

export interface AzCliInvoker extends AzCliTemplateFn<never>, AzCliSpawnFn {}

export function ensureAzPrefix(templates: TemplateStringsArray) {
  if (templates.length > 0 && !/^\s*az\s/i.test(templates[0])) {
    const [firstCookedTemplate, ...remainingCookedTemplates] = templates;
    const [firstRawTemplate, ...remainingRawTemplates] = templates.raw;
    templates = Object.assign([`az ${firstCookedTemplate}`, ...remainingCookedTemplates], {
      raw: [`az ${firstRawTemplate}`, ...remainingRawTemplates],
    });
  }

  return templates;
}

function extractSinglePropertyNameOrNull(obj: object): string | null {
  let propName: string | null = null;
  for (const key in obj) {
    if (Object.hasOwn(obj, key)) {
      if (propName == null) {
        propName = key;
      } else {
        // If there are multiple properties then it doesn't fit the shape of a wrapped response
        return null;
      }
    }
  }

  return propName;
}

function findWrappedResultPropertyName(response: object): string | null {
  const propName = extractSinglePropertyNameOrNull(response);
  if (propName) {
    if (propName === "publicIp") {
      return propName;
    }

    // Some create responses have {NewX:{}} or {newX:{}} wrappers
    // around the actual response. This will detect if the
    if (/^[Nn]ew[A-Za-z0-9]+$/.test(propName)) {
      return propName;
    }
  }

  return null;
}

function hasTypeProperty<T>(obj: T): obj is T & { type: string } {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return typeof (obj as any).type === "string";
}

function hasPropertiesProperty<T>(obj: T): obj is T & { properties: object } {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const properties = (obj as any)?.properties;
  return properties != null && typeof properties === "object";
}

function isContainerAppResultWithProperties<T extends object>(
  result: T,
): result is T & { type: string; properties: object } {
  return hasPropertiesProperty(result) && hasTypeProperty(result) && /Microsoft.App\//i.test(result.type);
}

export function adjustCliResultObject(results: object, opt: AzCliParsingOptions): object {
  if (opt.unwrapResults) {
    const wrapperPropertyName = findWrappedResultPropertyName(results);
    if (wrapperPropertyName != null) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (results as any)[wrapperPropertyName];
    }
  }

  if (opt.simplifyContainerAppResults && isContainerAppResultWithProperties(results)) {
    const { properties, ...rest } = results;
    return { ...rest, ...properties };
  }

  return results;
}
