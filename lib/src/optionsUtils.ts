import { isPrimitiveValue } from "./tsUtils.js";

export function shallowCloneDefinedValues<T extends object>(obj: T) {
  return Object.entries(obj).reduce((acc: T, [key, value]) => {
    if (value !== undefined) {
      acc[key as keyof T] = value;
    }

    return acc;
  }, {} as T);
}

export function shallowMergeDefinedValues<TPrev extends object, TNext extends object>(
  prev: TPrev,
  next: TNext,
): TPrev & TNext {
  return Object.entries(next).reduce(
    (acc, [key, value]) => {
      if (value !== undefined) {
        acc[key as keyof TPrev] = value;
      }

      return acc;
    },
    shallowCloneDefinedValues(prev) as TPrev & TNext,
  );
}

export function applyOptionsDifferencesShallow<TTarget extends TSource, TSource extends object>(
  target: TTarget,
  source: TSource,
): boolean {
  let changesApplied = false;
  for (const key of Object.keys(source) as [keyof TSource]) {
    const value = source[key];
    if (value !== undefined && value !== target[key]) {
      (target as TSource)[key] = value;
      changesApplied = true;
    }
  }

  return changesApplied;
}

export function applyOptionsDifferencesDeep<TTarget extends TSource, TSource extends object>(
  target: TTarget,
  source: TSource,
): boolean {
  let changesApplied = false;

  for (const key of Object.keys(source) as (keyof TSource)[]) {
    const value = source[key];
    if (value === undefined) {
      continue;
    }

    if (Array.isArray(value)) {
      changesApplied = true;
      (target as TSource)[key] = value;
    } else if (value != null && typeof value === "object" && target[key] != null) {
      if (applyOptionsDifferencesDeep(target[key], value)) {
        changesApplied = true;
      }
    } else if (value !== target[key]) {
      changesApplied = true;
      (target as TSource)[key] = value;
    }
  }

  return changesApplied;
}

export function applyArrayKeyedDescriptor<TTarget extends TSource, TSource extends object>(
  targets: TTarget[],
  sources: TSource[],
  match: keyof TSource | ((t: TTarget, s: TSource) => boolean),
  apply: (t: TTarget, s: TSource) => boolean,
  create: (s: TSource) => TTarget,
  options?: {
    deleteUnmatchedTargets?: boolean;
  },
): boolean {
  const unmatchedTargets = [...targets];
  const unmatchedSources = [...sources];
  const matchFn =
    typeof match === "string"
      ? (t: TTarget, s: TSource) => t[match] == s[match]
      : (match as (t: TTarget, s: TSource) => boolean);
  let appliedChanges = false;

  for (let sourceIndex = 0; sourceIndex < unmatchedSources.length; ) {
    const source = unmatchedSources[sourceIndex];
    const targetIndex = unmatchedTargets.findIndex(t => matchFn(t, source));
    if (targetIndex >= 0) {
      const target = unmatchedTargets[targetIndex];
      unmatchedSources.splice(sourceIndex, 1);
      unmatchedTargets.splice(targetIndex, 1);
      if (apply(target, source)) {
        appliedChanges = true;
      }
    } else {
      sourceIndex++;
    }
  }

  if (unmatchedTargets.length > 0 && options?.deleteUnmatchedTargets === true) {
    for (const toDelete of unmatchedTargets) {
      const index = targets.findIndex(t => t === toDelete);
      if (index >= 0) {
        targets.splice(index, 1);
        appliedChanges = true;
      }
    }
  }

  if (unmatchedSources.length > 0) {
    targets.push(...unmatchedSources.map(create));
    appliedChanges = true;
  }

  return appliedChanges;
}

export function applyArrayIdDescriptors<T extends { id?: string }>(
  targets: T[],
  sources: { id?: string }[],
  options?: {
    deleteUnmatchedTargets?: boolean;
  },
): boolean {
  return applyArrayKeyedDescriptor(
    targets,
    sources,
    "id",
    () => false,
    s => ({ id: s.id }) as T,
    options,
  );
}

export function applyObjectKeyProperties<TTarget extends TSource, TSource extends object>(
  target: TTarget,
  source: TSource,
  onAdd?: (key: keyof TSource, target: TTarget, source: TSource) => boolean | void,
  onRemove?: boolean | ((key: keyof TSource, target: TTarget) => boolean | void),
  onMatch?: (key: keyof TSource, target: TTarget, source: TSource) => boolean | void,
) {
  let updated = false;
  const sourceKeys = Object.keys(source) as (keyof TSource)[];
  const targetKeys = Object.keys(target) as (keyof TSource)[];

  if (onRemove != null && onRemove !== false) {
    const removeFn: (key: keyof TSource) => void =
      onRemove === true
        ? k => {
            delete target[k];
            updated = true;
          }
        : k => {
            if (onRemove(k, target) !== false) {
              updated = true;
            }
          };
    targetKeys.filter(k => !sourceKeys.includes(k)).forEach(removeFn);
  }

  if (onAdd != null) {
    sourceKeys
      .filter(k => !targetKeys.includes(k))
      .forEach(k => {
        if (onAdd(k, target, source) !== false) {
          updated = true;
        }
      });
  }

  if (onMatch != null) {
    sourceKeys
      .filter(k => targetKeys.includes(k))
      .forEach(k => {
        if (onMatch(k, target, source) !== false) {
          updated = true;
        }
      });
  }

  return updated;
}

type ApplyOptionsResult = boolean;

type ApplyObjectPropFn<
  TTarget extends { [K in keyof TSource]?: unknown },
  TSource extends { [K in keyof TSource]?: unknown },
  TKey extends keyof TSource,
> = (target: { [P in TKey]?: TTarget[P] }, source: { [P in TKey]: TSource[P] }, key: TKey) => ApplyOptionsResult;

type ApplyObjectTemplate<
  TTarget extends { [K in keyof TSource]?: unknown },
  TSource extends { [K in keyof TSource]?: unknown },
> = {
  [K in keyof TSource]?:
    | (TSource[K] extends object ? ApplyObjectTemplate<TTarget[K], TSource[K]> : never)
    | ApplyObjectPropFn<TTarget, TSource, K>
    | "ignore";
};

interface ApplyContext {
  visitedSourceObjects?: unknown[];
}

export function applySourceToTargetObject<
  TTarget extends { [K in keyof TSource]?: unknown },
  TSource extends { [K in keyof TSource]?: unknown },
  TTemplate extends ApplyObjectTemplate<TTarget, TSource>,
>(target: TTarget, source: TSource, template?: TTemplate, context?: ApplyContext): ApplyOptionsResult {
  let hasBeenUpdated = false;

  if (context == null) {
    context = {};
  }

  if (context.visitedSourceObjects == null) {
    context.visitedSourceObjects = [source];
  } else {
    if (context.visitedSourceObjects.includes(source)) {
      throw new Error("Source object contains cyclical references");
    }

    context.visitedSourceObjects.push(source);
  }

  for (const [key, sourceValue] of Object.entries(source) as [[keyof TSource, TSource[keyof TSource]]]) {
    if (sourceValue == null && sourceValue !== null) {
      continue; // skip undefined values
    }

    const templateValue = template?.[key];
    if (templateValue === null) {
      throw new Error("Null template handler not implemented");
    } else if (templateValue == null) {
      if (sourceValue === null || isPrimitiveValue(sourceValue)) {
        // TODO: extract basic equality to its own reusable function that can be explicitly specified in a template
        if (target[key] !== (sourceValue as unknown)) {
          target[key] = sourceValue as unknown as TTarget[keyof TSource];
          hasBeenUpdated = true;
        }
      } else if (Array.isArray(sourceValue)) {
        throw new Error("Array assignment not supported");
      } else if (typeof sourceValue === "object") {
        if (target[key] == null) {
          target[key] = {} as TTarget[keyof TSource];
        }

        if (applySourceToTargetObject(target[key], sourceValue, templateValue as undefined, context)) {
          hasBeenUpdated = true;
        }
      } else {
        throw new Error("Source value not supported");
      }
    } else if (templateValue === "ignore") {
      // Do nothing
    } else if (typeof templateValue === "function") {
      if ((templateValue as ApplyObjectPropFn<TTarget, TSource, keyof TSource>)(target, source, key)) {
        hasBeenUpdated = true;
      }
    } else if (Array.isArray(templateValue)) {
      throw new Error("Template array item is not supported");
    } else if (typeof templateValue === "object") {
      if (target[key] == null) {
        target[key] = {} as TTarget[keyof TSource];
      }

      if (applySourceToTargetObject(target[key], sourceValue, templateValue, context)) {
        hasBeenUpdated = true;
      }
    } else {
      throw new Error("Template item is unexpected");
    }
  }

  return hasBeenUpdated;
}
