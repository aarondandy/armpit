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
  sources: readonly TSource[],
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
  sources: readonly { id?: string }[],
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

export function applyObjectKeyProperties<TTarget extends object, TSource extends object>(
  target: TTarget,
  source: TSource,
  onAdd?: (key: keyof TSource, target: TTarget, source: TSource) => boolean | void,
  onRemove?: boolean | ((key: keyof TTarget, target: TTarget) => boolean | void),
  onMatch?: (key: keyof TSource & keyof TTarget, target: TTarget, source: TSource) => boolean | void,
) {
  let updated = false;
  const sourceKeys = Object.keys(source) as (keyof TSource)[];
  const targetKeys = Object.keys(target) as (keyof TTarget)[];

  if (onRemove != null && onRemove !== false) {
    const removeFn: (key: keyof TTarget) => void =
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
    targetKeys.filter(k => !sourceKeys.includes(k as unknown as keyof TSource)).forEach(removeFn);
  }

  for (const sourceKey of sourceKeys) {
    if (targetKeys.includes(sourceKey as unknown as keyof TTarget)) {
      if (onMatch && onMatch(sourceKey as keyof TTarget & keyof TSource, target, source) !== false) {
        updated = true;
      }
    } else {
      if (onAdd && onAdd(sourceKey, target, source) !== false) {
        updated = true;
      }
    }
  }

  return updated;
}

type ApplyOptionsResult = boolean;

type ApplyObjectPropFn<
  TTarget extends { [P in TProp]?: TTarget[P] },
  TSource extends { [P in TProp]?: TSource[P] },
  TProp extends keyof TSource & keyof TTarget,
> = (
  target: { [P in TProp]?: TTarget[P] },
  source: { [P in TProp]: TSource[P] },
  propName: TProp,
  context?: ApplyContext,
) => ApplyOptionsResult;

type ApplyObjectFn<
  TTarget extends { [P in keyof TSource & keyof TTarget]?: TTarget[P] },
  TSource extends { [P in keyof TSource]?: TSource[P] },
> = (target: TTarget, source: TSource, context?: ApplyContext) => ApplyOptionsResult;

type ApplyObjectTemplate<
  TTarget extends { [P in keyof TTarget & keyof TSource]?: TTarget[P] },
  TSource extends { [P in keyof TSource]?: TSource[P] },
> = {
  [P in keyof TTarget & keyof TSource]?:
    | (TSource[P] extends object | undefined ? ApplyObjectTemplate<TTarget[P], TSource[P]> : never)
    | ApplyObjectPropFn<TTarget, TSource, P>
    | "ignore";
};

export interface ApplyContext {
  visitedSourceObjects?: unknown[];
}

export function wrapPropObjectApply<
  TTarget extends { [P in keyof TTarget & keyof TSource]?: TTarget[P] },
  TSource extends { [P in keyof TSource]?: TSource[P] },
  TTargetItem extends TTarget[TProp],
  TSourceItem extends TSource[TProp] | undefined,
  TProp extends keyof TTarget & keyof TSource,
>(
  applyFn: ApplyObjectFn<NonNullable<TTargetItem>, NonNullable<TSourceItem>>,
): ApplyObjectPropFn<TTarget, TSource, TProp> {
  return ((targetObj: TTarget, sourceObj: TSource, propName: TProp, context?: ApplyContext) => {
    let appliedChanges = false;
    const sourceValue = sourceObj[propName] as TSourceItem | undefined;
    if (sourceValue == null) {
      if (sourceValue === null) {
        throw new Error("Null source value is not supported");
      } else {
        return appliedChanges;
      }
    }

    let targetValue = targetObj[propName] as TTargetItem | undefined;
    if (targetValue == null) {
      targetValue = {} as TTargetItem;
      targetObj[propName] = targetValue as TTarget[TProp];
      appliedChanges = true;
    }

    if (applyFn(targetValue as NonNullable<TTargetItem>, sourceValue, context)) {
      appliedChanges = true;
    }

    return appliedChanges;
  }) as ApplyObjectPropFn<TTarget, TSource, TProp>;
}

export function createKeyedArrayPropApplyFn<
  TTargetItem extends { [P in keyof TSourceItem]?: TTargetItem[P] } & object,
  TSourceItem extends { [P in keyof TSourceItem]?: TSourceItem[P] } & object,
  TTarget extends { [P in TProp]?: TTargetItem[] },
  TSource extends { [P in TProp]?: readonly TSourceItem[] },
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
  TTarget extends { [P in keyof TSource]?: TTarget[P] },
  TSource extends { [P in keyof TSource]?: TSource[P] },
>(target: TTarget, source: TSource, context?: ApplyContext): ApplyOptionsResult {
  return applySourceToTargetObjectWithTemplate(target, source, undefined, context);
}

export function applySourceToTargetObjectWithTemplate<
  TTarget extends { [P in keyof TSource]?: TTarget[P] },
  TSource extends { [P in keyof TSource]?: TSource[P] },
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

  for (const [sourcePropName, sourceValue] of Object.entries(source) as [[keyof TSource, TSource[keyof TSource]]]) {
    if (sourceValue == null && sourceValue !== null) {
      continue; // skip undefined values
    }

    const templateValue = template?.[sourcePropName];
    if (templateValue === null) {
      throw new Error("Null template handler not implemented");
    } else if (templateValue == null) {
      if (sourceValue === null || isPrimitiveValue(sourceValue)) {
        // TODO: extract basic equality to its own reusable function that can be explicitly specified in a template
        if (target[sourcePropName] !== (sourceValue as unknown)) {
          target[sourcePropName] = sourceValue as unknown as TTarget[keyof TSource];
          hasBeenUpdated = true;
        }
      } else if (Array.isArray(sourceValue)) {
        if (target[sourcePropName] == null) {
          target[sourcePropName] = [] as TTarget[keyof TSource];
        }

        if (applyOrderedArray(target[sourcePropName] as unknown[], sourceValue)) {
          hasBeenUpdated = true;
        }
      } else if (typeof sourceValue === "object") {
        if (target[sourcePropName] == null) {
          target[sourcePropName] = {} as TTarget[keyof TSource];
        }

        if (applySourceToTargetObject(target[sourcePropName], sourceValue, context)) {
          hasBeenUpdated = true;
        }
      } else {
        throw new Error("Source value not supported");
      }
    } else if (templateValue === "ignore") {
      // Do nothing
    } else if (typeof templateValue === "function") {
      if ((templateValue as ApplyObjectPropFn<TTarget, TSource, keyof TSource>)(target, source, sourcePropName)) {
        hasBeenUpdated = true;
      }
    } else if (Array.isArray(templateValue)) {
      throw new Error("Template array item is not supported");
    } else if (typeof templateValue === "object") {
      if (target[sourcePropName] == null) {
        target[sourcePropName] = {} as TTarget[keyof TSource];
      }

      if (applySourceToTargetObjectWithTemplate(target[sourcePropName], sourceValue, templateValue, context)) {
        hasBeenUpdated = true;
      }
    } else {
      throw new Error("Template item is unexpected");
    }
  }

  return hasBeenUpdated;
}

function defaultEqualsTest(a: unknown, b: unknown): boolean {
  if (a === b) {
    return true;
  }

  if (a == null || b == null) {
    return false;
  }

  if (typeof a === "object" && typeof b === "object") {
    return JSON.stringify(a) === JSON.stringify(b);
  }

  return false;
}

export function applyUnorderedArray<TValue>(
  targetArray: TValue[],
  sourceArray: readonly TValue[],
  test?: (a: TValue, b: TValue) => boolean,
) {
  let appliedChanges = false;
  test ??= defaultEqualsTest;

  const unmatchedSourceItems = [...sourceArray];

  for (let targetIndex = 0; targetIndex < targetArray.length; ) {
    const targetItem = targetArray[targetIndex];
    const searchIndex = unmatchedSourceItems.findIndex(sourceItem => test(targetItem, sourceItem));
    if (searchIndex >= 0) {
      // TODO: handle matches and `appliedChanges = true;` if required
      unmatchedSourceItems.splice(searchIndex, 1);
      targetIndex++;
    } else {
      targetArray.splice(targetIndex, 1);
      appliedChanges = true;
    }
  }

  if (unmatchedSourceItems.length > 0) {
    targetArray.push(...unmatchedSourceItems);
    appliedChanges = true;
  }

  return appliedChanges;
}

export function applyUnorderedValueArrayProp<
  TValue extends string | number,
  TTarget extends { [P in TProp]?: TValue[] },
  TSource extends { [P in TProp]?: readonly TValue[] },
  TProp extends keyof TSource,
>(target: TTarget, source: TSource, propName: TProp) {
  let appliedChanges = false;

  const sourceValues = source[propName] as TValue[] | undefined;
  if (sourceValues == null) {
    return appliedChanges;
  }

  let targetValues = target[propName] as TValue[] | undefined;
  if (targetValues == null) {
    targetValues = [];
    target[propName] = targetValues as TTarget[TProp];
    appliedChanges = true;
  }

  if (applyUnorderedArray(targetValues, sourceValues)) {
    appliedChanges = true;
  }

  return appliedChanges;
}

export function applyOrderedArray<TValue>(
  targetArray: TValue[],
  sourceArray: readonly TValue[],
  test?: (a: TValue, b: TValue) => boolean,
) {
  let appliedChanges = false;
  test ??= defaultEqualsTest;

  for (let sourceIndex = 0; sourceIndex < sourceArray.length; sourceIndex++) {
    const sourceItem = sourceArray[sourceIndex];
    const searchIndex = targetArray.findIndex(
      (targetItem, targetIndex) => targetIndex >= sourceIndex && test(targetItem, sourceItem),
    );
    if (searchIndex >= 0) {
      const searchItem = targetArray[searchIndex];
      if (searchIndex === sourceIndex) {
        // TODO: handle matches and `appliedChanges = true;` if required
      } else {
        // Swap items to preserve existing values or objects
        targetArray[searchIndex] = targetArray[sourceIndex];
        targetArray[sourceIndex] = searchItem;
        appliedChanges = true;
      }
    } else {
      if (sourceIndex === targetArray.length) {
        targetArray.push(sourceItem);
        appliedChanges = true;
      } else if (sourceIndex > targetArray.length) {
        throw new Error("Unexpected index");
      } else {
        targetArray.splice(sourceIndex, 0, sourceItem);
      }
    }
  }

  if (targetArray.length > sourceArray.length) {
    targetArray.splice(sourceArray.length, targetArray.length - sourceArray.length);
    appliedChanges = true;
  }

  return appliedChanges;
}

export function applyOrderedValueArrayProp<
  TValue extends string | number,
  TTarget extends { [P in TProp]?: TValue[] },
  TSource extends { [P in TProp]?: readonly TValue[] },
  TProp extends keyof TSource,
>(target: TTarget, source: TSource, propName: TProp) {
  let appliedChanges = false;

  const sourceValues = source[propName] as TValue[] | undefined;
  if (sourceValues == null) {
    return appliedChanges;
  }

  let targetValues = target[propName] as TValue[] | undefined;
  if (targetValues == null) {
    targetValues = [];
    target[propName] = targetValues as TTarget[TProp];
    appliedChanges = true;
  }

  if (applyOrderedArray(targetValues, sourceValues)) {
    appliedChanges = true;
  }

  return appliedChanges;
}

export function applyResourceRefProperty<
  TTarget extends { [P in TProp]?: { id?: string } },
  TSource extends { [P in TProp]?: { id?: string } | string },
  TProp extends keyof TSource,
>(target: TTarget, source: TSource, propName: TProp) {
  let updated = false;
  const sourceProp = source[propName];
  if (sourceProp == null) {
    if (sourceProp === null) {
      // TODO: should this set target[propName] to null or delete it?
      throw new Error("Null SubResource assignment is not supported");
    } else {
      // If the whole object is undefined, then skip
      return updated;
    }
  }

  const sourceId = typeof sourceProp === "string" ? sourceProp : sourceProp?.id;
  if (sourceId == null) {
    throw new Error("SubResource assignment with invalid ID is not supported");
  }

  if (target[propName]?.id !== sourceId) {
    target[propName] = { id: sourceId } as TTarget[TProp];
    updated = true;
  }

  return updated;
}

export function applyResourceRefListProperty<
  TTargetItem extends { id?: string },
  TSource extends { [P in TProp]?: readonly { id?: string }[] },
  TProp extends keyof TSource,
>(target: { [P in TProp]?: TTargetItem[] }, source: { [P in TProp]?: readonly { id?: string }[] }, propName: TProp) {
  let updated = false;
  const sourceArray = source[propName] as { id?: string }[] | undefined;
  if (sourceArray == null) {
    return updated;
  }

  let targetArray = target[propName] as TTargetItem[] | undefined;
  if (targetArray == null) {
    targetArray = [];
    target[propName] = targetArray;
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
