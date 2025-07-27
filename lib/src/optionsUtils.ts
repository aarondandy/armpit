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
