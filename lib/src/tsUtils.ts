export abstract class CallableClassBase {
  constructor() {
    const closure = function (...args: unknown[]) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (closure as any as CallableClassBase).fnImpl(...args);
    };
    return Object.setPrototypeOf(closure, new.target.prototype);
  }

  protected abstract fnImpl(...args: unknown[]): unknown;
}

export function isStringValueOrValueArrayEqual<T extends string | null | undefined>(
  a: T[] | T,
  b: T[] | T,
  opt?: {
    sort?: boolean | ((a?: T, b?: T) => number);
  },
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
    sort?: boolean | ((a?: T, b?: T) => number);
  },
) {
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
    } else if (aValue !== b[i]) {
      return false;
    }
  }

  return true;
}

export function isArrayEqual<T>(a: T[], b: T[], equals: (a: T, b: T) => boolean) {
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

export function isObjectShallowEqual<T extends object>(a: T, b: T) {
  if (a == null) {
    return b == null;
  } else if (b == null) {
    return false;
  }

  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  if (aKeys.length !== bKeys.length) {
    return false;
  }

  for (const key of aKeys as (keyof T)[]) {
    if (a[key] != b[key]) {
      return false;
    }
  }

  return true;
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

export function isTemplateStringArray(value: unknown): value is TemplateStringsArray {
  return value != null && Array.isArray(value);
}

export function isPromiseLike<T>(value: unknown): value is PromiseLike<T> {
  return (
    value != null &&
    (typeof value === "object" || typeof value === "function") &&
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    typeof (value as any).then === "function"
  );
}

export interface Stringy {
  toString(): string;
}

export function isStringy(value: unknown): value is Stringy {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return value != null && typeof (value as any).toString === "function";
}

export function isAbortSignal(value: unknown): value is AbortSignal {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return value != null && typeof (value as any).aborted === "boolean";
}

export function isThrowableAbortSignal(value: unknown): value is AbortSignal & { throwIfAborted(): void } {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return isAbortSignal(value) && typeof (value as any).throwIfAborted === "function";
}
