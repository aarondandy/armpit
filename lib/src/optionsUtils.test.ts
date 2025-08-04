import { describe, it, expect } from "vitest";
import {
  applySourceToTargetObject,
  applySourceToTargetObjectWithTemplate,
  createKeyedArrayPropApplyFn,
  applyResourceRefListProperty,
} from "./optionsUtils.js";

describe("apply options without template", () => {
  it("apply nothing with empty source", () => {
    const target = {};
    const result = applySourceToTargetObject(target, {});
    expect(result).toBe(false);
    expect(target).toStrictEqual({});
  });

  it("apply simple value", () => {
    const target = {};
    const result = applySourceToTargetObject(target, { a: 1 });
    expect(result).toBe(true);
    expect(target).toStrictEqual({ a: 1 });
  });

  it("apply simple nested value", () => {
    const target = {};
    const result = applySourceToTargetObject(target, { a: { b: 2 } });
    expect(result).toBe(true);
    expect(target).toStrictEqual({ a: { b: 2 } });
  });

  it("apply only updates what is in the source", () => {
    const target = { a: 1, b: 2, c: 3 };
    const result = applySourceToTargetObject(target, { a: 10, c: 30 });
    expect(result).toBe(true);
    expect(target).toStrictEqual({ a: 10, b: 2, c: 30 });
  });

  it("apply only updates what is in the source", () => {
    const target = { a: 1, b: { c: 2, d: 3 }, e: 4 };
    const result = applySourceToTargetObject(target, { b: { c: 20 }, e: 40 });
    expect(result).toBe(true);
    expect(target).toStrictEqual({ a: 1, b: { c: 20, d: 3 }, e: 40 });
  });

  it("cyclical references are blocked", () => {
    const target = {};
    const a: { b?: unknown } = {};
    const b = { a: a };
    a.b = b;

    expect(() => applySourceToTargetObject(target, a)).toThrow(/cyclical/);
    expect(target).toStrictEqual({ b: { a: {} } });
  });
});

describe("apply options with template functions", () => {
  it("applied function updates target from source", () => {
    const target = { a: 1 };
    const result = applySourceToTargetObjectWithTemplate(
      target,
      { a: 2 },
      {
        a: (t, s, k) => {
          t[k] = s[k] + 3;
          return true;
        },
      },
    );
    expect(result).toBe(true);
    expect(target).toStrictEqual({ a: 5 });
  });

  it("applied nested function updates target from source", () => {
    const target = { a: { b: 1 } };
    const result = applySourceToTargetObjectWithTemplate(
      target,
      { a: { b: 2 } },
      {
        a: {
          b: (t, s, k) => {
            t[k] = s[k] + 3;
            return true;
          },
        },
      },
    );
    expect(result).toBe(true);
    expect(target).toStrictEqual({ a: { b: 5 } });
  });

  it("unapplied function does nothing", () => {
    const target = { a: 1 };
    const result = applySourceToTargetObjectWithTemplate(target, { a: 2 }, { a: () => false });
    expect(result).toBe(false);
    expect(target).toStrictEqual({ a: 1 });
  });
});

describe("keyed array prop application", () => {
  it("apply to matching items", () => {
    const target = {
      items: [
        { n: "a", v: 1 },
        { n: "b", v: 2 },
      ],
    };
    const result = applySourceToTargetObjectWithTemplate(
      target,
      {
        items: [
          { n: "b", v: 3 },
          { n: "a", v: 4 },
        ],
      },
      {
        items: createKeyedArrayPropApplyFn("n", applySourceToTargetObject),
      },
    );
    expect(result).toBe(true);
    expect(target).toStrictEqual({
      items: [
        { n: "a", v: 4 },
        { n: "b", v: 3 },
      ],
    });
  });

  it("apply to matching items and adds", () => {
    const target = {
      items: [
        { n: "a", v: 1 },
        { n: "b", v: 2 },
      ],
    };
    const result = applySourceToTargetObjectWithTemplate(
      target,
      {
        items: [
          { n: "b", v: 3 },
          { n: "c", v: 4 },
        ],
      },
      {
        items: createKeyedArrayPropApplyFn("n", applySourceToTargetObject, true),
      },
    );
    expect(result).toBe(true);
    expect(target).toStrictEqual({
      items: [
        { n: "a", v: 1 },
        { n: "b", v: 3 },
        { n: "c", v: 4 },
      ],
    });
  });

  it("add missing and remove unspecified", () => {
    const target = {
      items: [
        { n: "a", v: 1 },
        { n: "b", v: 2 },
      ],
    };
    const result = applySourceToTargetObjectWithTemplate(
      target,
      {
        items: [
          { n: "b", v: 3 },
          { n: "c", v: 4 },
        ],
      },
      {
        items: createKeyedArrayPropApplyFn("n", applySourceToTargetObject, true, true),
      },
    );
    expect(result).toBe(true);
    expect(target).toStrictEqual({
      items: [
        { n: "b", v: 3 },
        { n: "c", v: 4 },
      ],
    });
  });
});

describe("apply sub-resource reference lists", () => {
  it("explicitly empty leaves empty", () => {
    const target = { items: [] };
    const result = applySourceToTargetObjectWithTemplate(
      target,
      { items: [] },
      { items: applyResourceRefListProperty },
    );
    expect(result).toBe(false);
    expect(target).toStrictEqual({ items: [] });
  });

  it("can add new item", () => {
    const target = { items: [] };
    const result = applySourceToTargetObjectWithTemplate(
      target,
      { items: [{ id: "/abc/123" }] },
      { items: applyResourceRefListProperty },
    );
    expect(result).toBe(true);
    expect(target).toStrictEqual({ items: [{ id: "/abc/123" }] });
  });

  it("can remove old item", () => {
    const target = { items: [{ id: "/abc/123" }] };
    const result = applySourceToTargetObjectWithTemplate(
      target,
      { items: [] },
      { items: applyResourceRefListProperty },
    );
    expect(result).toBe(true);
    expect(target).toStrictEqual({ items: [] });
  });

  it("can replace item", () => {
    const target = { items: [{ id: "/abc/123" }] };
    const result = applySourceToTargetObjectWithTemplate(
      target,
      { items: [{ id: "/abc/456" }] },
      { items: applyResourceRefListProperty },
    );
    expect(result).toBe(true);
    expect(target).toStrictEqual({ items: [{ id: "/abc/456" }] });
  });
});
