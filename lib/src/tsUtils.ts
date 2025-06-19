export abstract class CallableClassBase {
  constructor() {
    const closure = function(...args: any[]) {
      return (closure as any as CallableClassBase).fnImpl(...args);
    }
    return Object.setPrototypeOf(closure, new.target.prototype);
  }

  protected abstract fnImpl(...args: any[]): any;
}
