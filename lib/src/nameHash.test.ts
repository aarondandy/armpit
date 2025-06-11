import { test, describe, it, expect } from "vitest"
import { NameHash } from "./nameHash.js"

expect.extend({
  toStartWith(received: string | NameHash, expectedPrefix: string | NameHash) {
    const { isNot } = this;
    const receivedValue = received.toString();
    const expectedPrefixValue = expectedPrefix.toString();
    return {
      pass: receivedValue.startsWith(expectedPrefixValue),
      message: () => `Expected '${receivedValue}' to${isNot ? " not" : ""} start with ${expectedPrefixValue}`
    };
  }
})

interface CustomMatchers<R = unknown> {
  toStartWith: (expectedPrefix: string | NameHash) => R
}

declare module "vitest" {
  interface Matchers<T = any> extends CustomMatchers<T> {}
}

describe("alphanumeric generation long-term stability by size", () => {
  const givenName = "abc";
  const expectedHugeHashOfAbcAlphaNum = "y1rm3to8s85ef3n6dlmklfa8xxi6uz1nh60incdk2n3ogph111cgnp06yuixctglj3it7bxgytoo9sdie630pabs50egbrj3gz1i4u8k2nm7wt48kunng6xqee18gu9sxyhlzpnkxvktiegtymumpqm08za6md9khb7n3bju5kb8ca15uulih15zdspg9pyidqug94tw";

  it("small", () => {
    const actual = new NameHash(givenName, { type: "alphanumeric", defaultLength: 2 })();
    expect(actual).toHaveLength(2);
    expect(expectedHugeHashOfAbcAlphaNum).toStartWith(actual);
  });
  it("default", () => {
    const actual = new NameHash(givenName, { type: "alphanumeric", defaultLength: undefined })();
    expect(actual).toHaveLength(4);
    expect(expectedHugeHashOfAbcAlphaNum).toStartWith(actual);
  });
  it("huge", () => {
    const actual = new NameHash(givenName, { type: "alphanumeric", defaultLength: 200 })();
    expect(actual).toHaveLength(200);
    expect(expectedHugeHashOfAbcAlphaNum).toStartWith(actual);
  });
});

describe("alphanumeric generation short-term stability", () => {
  const givenName = "abc";
  it("single instance", () => {
    const hash = new NameHash(givenName);
    let oldValue: string = "";
    // Note, a value of 100 should force us to perform 2 HMAC passes and makes for a great test
    for (let i = 1; i < 100; i++) {
      const newValue = hash(i);
      expect(newValue).toHaveLength(i);
      expect(newValue).toStartWith(oldValue);
      oldValue = newValue;
    }
  });

  it("instance per", () => {
    let oldValue: string = "";
    // Note, a value of 100 should force us to perform 2 HMAC passes and makes for a great test
    for (let i = 1; i < 100; i++) {
      const hash = new NameHash(givenName);
      const newValue = hash(i);
      expect(newValue).toHaveLength(i);
      expect(newValue).toStartWith(oldValue);
      oldValue = newValue;
    }
  });
});

describe("alphanumeric input concatenation stability", () => {
  const nameParts = ["abc", "def"];
  const nameFull = "abcdef";

  it("hash concat matches input string concat", () => {
    // A script may be refactored in a way that it used to produce a single hasher
    // combining subscription and group name. After the introduction of a new group
    // to the script, it should be possible to produce a root hasher for the entire
    // subscription and derived hasher instances which can combine the values. The
    // resulting hash values should be identical after such a refactoring.
    const hashConcat = new NameHash("abcdef");
    const hashChild = new NameHash("abc").concat("def");
    expect(hashConcat(10)).toBe(hashChild(10));
  });

  it("different hash suffixes can differ in value", () => {
    const rootHashObject = new NameHash("abc", { defaultLength: 6 });

    const rootHash = rootHashObject();
    const aHash = rootHashObject.concat("a")();
    const bHash = rootHashObject.concat("b")();

    expect(aHash).not.toBe(rootHash);
    expect(aHash).toHaveLength(rootHash.length);
    expect(bHash).not.toBe(rootHash);
    expect(bHash).toHaveLength(rootHash.length);
    expect(aHash).not.toBe(bHash);
  });

  it("redundantly built hashes match values", () => {
    const rootHashObject = new NameHash("abc", { defaultLength: 6 });
    const rootHash = rootHashObject();
    const expected = rootHashObject.concat("a")();

    const actual = rootHashObject.concat("a")();

    expect(actual).toHaveLength(rootHash.length);
    expect(actual).not.toBe(rootHash);
    expect(actual).toBe(expected);
  });
});

describe("stringification", () => {
  it("interpolated string", () => {
    const hash = new NameHash("abc");
    const actual = `123${hash}456`;
    expect(actual).toBe("123y1rm456");
  });
  it("string concat", () => {
    const hash = new NameHash("abc");
    const actual = "123".concat(hash.toString(), "456");
    expect(actual).toBe("123y1rm456");
  });
  it("string plus operator", () => {
    const hash = new NameHash("abc");
    const actual = "123" + hash + "456";
    expect(actual).toBe("123y1rm456");
  });
  it("string plus operator hash lvalue", () => {
    const hash = new NameHash("abc");
    let actual = hash + "456";
    actual = "123" + actual;
    expect(actual).toBe("123y1rm456");
  });
  it("string append operator", () => {
    const hash = new NameHash("abc");
    let actual = "123";
    actual += hash;
    actual += "456";
    expect(actual).toBe("123y1rm456");
  });
});
