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

export function applyDescriptorOptionsDeep<TTarget extends TSource, TSource extends object>(
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
      if (applyDescriptorOptionsDeep(target[key], value)) {
        changesApplied = true;
      }
    } else if (value !== target[key]) {
      changesApplied = true;
      (target as TSource)[key] = value;
    }
  }

  return changesApplied;
}
