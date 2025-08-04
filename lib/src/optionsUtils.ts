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

export function applyArrayKeyedDescriptor<
  TTarget extends { [K in keyof TSource]?: TTarget[K] },
  TSource extends object,
>(
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
      ? (t: TTarget, s: TSource) => t[match] == (s[match] as unknown)
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
  TTarget extends { [K in keyof TSource]?: TTarget[K] },
  TSource extends { [K in keyof TSource]?: TSource[K] },
  TKey extends keyof TSource,
> = (
  target: { [P in TKey]?: TTarget[P] },
  source: { [P in TKey]: TSource[P] },
  key: TKey,
  context?: ApplyContext,
) => ApplyOptionsResult;

type ApplyObjectFn<
  TTarget extends { [K in keyof TSource]?: TTarget[K] },
  TSource extends { [K in keyof TSource]?: TSource[K] },
> = (target: TTarget, source: TSource, context?: ApplyContext) => ApplyOptionsResult;

type ApplyObjectTemplate<
  TTarget extends { [K in keyof TSource]?: TTarget[K] },
  TSource extends { [K in keyof TSource]?: TSource[K] },
> = {
  [K in keyof TSource]?:
    | (TSource[K] extends object ? ApplyObjectTemplate<TTarget[K], TSource[K]> : never)
    | ApplyObjectPropFn<TTarget, TSource, K>
    | "ignore";
};

export interface ApplyContext {
  visitedSourceObjects?: unknown[];
}

export function createKeyedArrayPropApplyFn<
  TTargetItem extends { [K in keyof TSourceItem]?: TTargetItem[K] } & object,
  TSourceItem extends { [K in keyof TSourceItem]?: TSourceItem[K] } & object,
  TTarget extends { [P in TProp]?: TTargetItem[] },
  TSource extends { [P in TProp]?: TSourceItem[] },
  TProp extends keyof TSource,
>(
  match: keyof TSourceItem | ((t: TTargetItem, s: TSourceItem) => boolean),
  apply: ApplyObjectFn<TTargetItem, TSourceItem>,
  create?: boolean | ((s: TSourceItem, c?: ApplyContext) => TTargetItem),
  remove?: boolean | ((t: TTargetItem[], d: TTargetItem[]) => boolean),
): ApplyObjectPropFn<TTarget, TSource, TProp> {
  const matchFn =
    typeof match === "function"
      ? match
      : (t: TTargetItem, s: TSourceItem) => {
          const sourceValue = s[match];
          return sourceValue != null && t[match] === sourceValue;
        };

  const createFn =
    typeof create === "function"
      ? create
      : create == null || create === true
        ? (s: TSourceItem, c?: ApplyContext) => {
            const t = {} as TTargetItem;
            apply(t, s, c);
            return t;
          }
        : null;

  const removeFn =
    typeof remove === "function"
      ? remove
      : remove === true
        ? (t: TTargetItem[], d: TTargetItem[]) => {
            let removed = 0;
            if (d != null && d.length > 0) {
              for (const toDelete of d) {
                const index = t.indexOf(toDelete);
                if (index >= 0) {
                  t.splice(index, 1);
                  removed++;
                }
              }
            }

            return removed > 0;
          }
        : null;

  return ((targetObj: TTarget, sourceObj: TSource, prop: TProp, context?: ApplyContext) => {
    let appliedChanges = false;

    const sourceItems = sourceObj[prop] as TSourceItem[] | undefined;
    if (sourceItems == null) {
      if (sourceItems === null) {
        throw new Error("Null source item array is not supported");
      } else {
        return appliedChanges;
      }
    }

    let targetItems = targetObj[prop] as TTargetItem[] | undefined;

    if (targetItems == null) {
      targetItems = [];
      targetObj[prop] = targetItems as TTarget[TProp];
    }

    const unmatchedTargets = [...targetItems];

    const matchedSources: TSourceItem[] = [];

    sourceItems.forEach(sourceItem => {
      const targetIndex = unmatchedTargets.findIndex(t => matchFn(t, sourceItem));
      if (targetIndex >= 0) {
        const targetItem = unmatchedTargets[targetIndex];
        unmatchedTargets.splice(targetIndex, 1);

        matchedSources.push(sourceItem);

        if (apply(targetItem, sourceItem, context)) {
          appliedChanges = true;
        }
      }
    });

    if (unmatchedTargets.length > 0 && removeFn != null) {
      if (removeFn(targetItems, unmatchedTargets)) {
        appliedChanges = true;
      }
    }

    if (createFn != null) {
      const unmatchedSources = sourceItems.filter(s => !matchedSources.includes(s));
      if (unmatchedSources.length > 0) {
        targetItems.push(...unmatchedSources.map(s => createFn(s, context)));
        appliedChanges = true;
      }
    }

    return appliedChanges;
  }) as ApplyObjectPropFn<TTarget, TSource, TProp>;
}

export function applySourceToTargetObject<
  TTarget extends { [K in keyof TSource]?: TTarget[K] },
  TSource extends { [K in keyof TSource]?: TSource[K] },
>(target: TTarget, source: TSource, context?: ApplyContext): ApplyOptionsResult {
  return applySourceToTargetObjectWithTemplate(target, source, undefined, context);
}

export function applySourceToTargetObjectWithTemplate<
  TTarget extends { [K in keyof TSource]?: TTarget[K] },
  TSource extends { [K in keyof TSource]?: TSource[K] },
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

        if (applySourceToTargetObject(target[key], sourceValue, context)) {
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

      if (applySourceToTargetObjectWithTemplate(target[key], sourceValue, templateValue, context)) {
        hasBeenUpdated = true;
      }
    } else {
      throw new Error("Template item is unexpected");
    }
  }

  return hasBeenUpdated;
}

export function applyValueArrayUnordered<
  TValue extends string | number,
  TTarget extends { [P in TKey]?: TValue[] },
  TSource extends { [P in TKey]?: TValue[] },
  TKey extends keyof TSource,
>(target: TTarget, source: TSource, key: TKey) {
  let appliedChanges = false;

  const sourceValues = source[key] as TValue[] | undefined;
  if (sourceValues == null) {
    return appliedChanges;
  }

  let targetValues = target[key] as TValue[] | undefined;
  if (targetValues == null) {
    targetValues = [];
    target[key] = targetValues as TTarget[TKey];
  }

  const toRemove = targetValues.filter(t => !sourceValues.includes(t));
  if (toRemove.length > 0) {
    for (const r of toRemove) {
      const i = targetValues.indexOf(r);
      targetValues.splice(i, 1);
      appliedChanges = true;
    }
  }

  const toAdd = sourceValues.filter(s => !targetValues.includes(s));
  if (toAdd.length > 0) {
    targetValues.push(...toAdd);
    appliedChanges = true;
  }

  return appliedChanges;
}

export function applySubResourceProperty<
  TTarget extends { [P in TKey]?: { id?: string } },
  TSource extends { [P in TKey]?: { id?: string } },
  TKey extends keyof TSource,
>(target: TTarget, source: TSource, key: TKey) {
  let updated = false;
  const sourceProp = source[key];
  if (sourceProp == null) {
    if (sourceProp === null) {
      // TODO: should this set target[key] to null or delete it?
      throw new Error("Null SubResource assignment is not supported");
    } else {
      // If the whole object is undefined, then skip
      return updated;
    }
  }

  const sourceId = sourceProp?.id;
  if (sourceId == null) {
    throw new Error("SubResource assignment with invalid ID is not supported");
  }

  if (target[key]?.id !== sourceId) {
    target[key] = { id: sourceId } as TTarget[TKey];
    updated = true;
  }

  return updated;
}

export function applySubResourceListProperty<
  TTargetItem extends { id?: string },
  TSource extends { [P in TKey]?: { id?: string }[] },
  TKey extends keyof TSource,
>(target: { [P in TKey]?: TTargetItem[] }, source: { [P in TKey]?: { id?: string }[] }, key: TKey) {
  let updated = false;
  const sourceArray = source[key] as { id?: string }[] | undefined;
  if (sourceArray == null) {
    return updated;
  }

  let targetArray = target[key] as TTargetItem[] | undefined;
  if (targetArray == null) {
    targetArray = [];
    target[key] = targetArray;
  }

  const sourceIds = sourceArray.map(r => r?.id).filter(id => id) as string[];

  for (let i = 0; i < targetArray.length; ) {
    const targetId = targetArray[i]?.id;
    if (targetId != null && sourceIds.includes(targetId)) {
      i++;
    } else {
      targetArray.splice(i, 1);
      updated = true;
    }
  }

  const toAdd = sourceIds.filter(id => !targetArray.some(r => r?.id === id)).map(id => ({ id })) as TTargetItem[];
  if (toAdd.length > 0) {
    updated = true;
    targetArray.push(...toAdd);
  }

  return updated;
}
