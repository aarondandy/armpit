export abstract class CallableClassBase {
  constructor() {
    const closure = function(...args: any[]) {
      return (closure as any as CallableClassBase).fnImpl(...args);
    }
    return Object.setPrototypeOf(closure, new.target.prototype);
  }

  protected abstract fnImpl(...args: any[]): any;
}

export function isStringValueOrValueArrayEqual<T extends string | null | undefined>(
  a: T[] | T,
  b: T[] | T,
  opt?: {
    sort?: boolean | ((a?: T, b?: T) => number),
  }
) {
  if (a == null) {
    return b == null;
  }

  if (b == null) {
    return false;
  }

  if (typeof a === "string") {
    if (typeof b === "string") {
      return a === b;
    }

    a = [a];
  } else {
    if (typeof b === "string") {
      b = [b];
    }
  }

  return isStringValueArrayEqual(a, b, opt);
}

export function isStringValueArrayEqual<T extends string | null | undefined>(
  a: T[],
  b: T[],
  opt?: {
    sort?: boolean | ((a?: T, b?: T) => number),
  }
)  {

  if (a.length !== b.length) {
    return false;
  }

  if (opt?.sort) {
    a = [...a];
    b = [...b];
    if (opt.sort === true) {
      a.sort();
      b.sort();
    } else {
      a.sort(opt.sort);
      b.sort(opt.sort);
    }
  }

  for (let i = 0; i < a.length; i++) {
    const aValue = a[i];
    if (aValue == null) {
      if (b[i] != null) {
        return false;
      }
    }
    else if (aValue !== b[i]) {
      return false;
    }
  }

  return true;
}

export function isArrayEqual<T>(a: T[], b: T[], equals: (a: T,b: T) => boolean) {
  if (a.length !== b.length) {
    return false;
  }

  for (let i = 0; i < a.length; i++) {
    if (!equals(a[i], b[i])) {
      return false;
    }
  }

  return true;
}

export function isArrayEqualUnordered<T>(a: T[], b: T[], equals: (a: T, b: T) => boolean) {
  if (a.length !== b.length) {
    return false;
  }

  if (a.length === 0) {
    return true;
  }

  const aSearch = [...a];
  const bSearch = [...b];

  for (let aIndex = 0; aIndex < aSearch.length; ) {
    const aItem = aSearch[aIndex];
    const bIndex = bSearch.findIndex(bItem => equals(aItem, bItem));
    if (bIndex >= 0) {
      aSearch.splice(aIndex, 1);
      bSearch.splice(bIndex, 1);
    } else {
      return false; // unmatched item
    }
  }

  return aSearch.length === 0 && bSearch.length === 0;
}

export function mergeAbortSignals(...args: (AbortSignal | undefined | null)[]): AbortSignal | null {
  const signals = args.filter(s => s != null);
  if (signals.length === 1) {
    return signals[0];
  } else if (signals.length > 1) {
    return AbortSignal.any(signals);
  } else {
    return null;
  }
}
