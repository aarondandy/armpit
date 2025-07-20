import { describe, it, expect } from "vitest"
import { NameHash } from "./nameHash.js"

expect.extend({
  toStartWith(received: string | NameHash, expectedPrefix: string | NameHash) {
    const { isNot } = this;
    const receivedValue = received.toString();
    const expectedPrefixValue = expectedPrefix.toString();
    return {
      pass: receivedValue.startsWith(expectedPrefixValue),
      message: () => `Expected '${receivedValue}' ${isNot ? "to not" : "to"} start with ${expectedPrefixValue}`
    };
  }
})

interface CustomMatchers<R = unknown> {
  toStartWith: (expectedPrefix: string | NameHash) => R
}

declare module "vitest" {
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type, @typescript-eslint/no-explicit-any
  interface Matchers<T = any> extends CustomMatchers<T> {}
}

describe("alphanumeric generation long-term stability by size", () => {
  const givenName = "abc123-input";
  const longTermHugeHash = "g52gyylw97shv2josded10rtx6xpcf43u694vs1t5tdo9xtgmseggxvu5k0jzzufj5zmkcen3sitpnxzxt9pkup4fvg4un409k00ysuvpzi76a1ns718qv6maxz63wwp9imnl0mh3ax2sm4eimf83af0f8qsean5oyr8j0ddqa1lapmj0dquqvwnn8k6gkif45hr7wdb";

  it("small", () => {
    const actual = new NameHash(givenName, { type: "alphanumeric", defaultLength: 2 })();
    expect(actual).toHaveLength(2);
    expect(longTermHugeHash).toStartWith(actual);
  });
  it("default", () => {
    const actual = new NameHash(givenName, { type: "alphanumeric", defaultLength: undefined })();
    expect(actual).toHaveLength(3);
    expect(longTermHugeHash).toStartWith(actual);
  });
  it("huge", () => {
    const actual = new NameHash(givenName, { type: "alphanumeric", defaultLength: 200 })();
    expect(actual).toHaveLength(200);
    expect(longTermHugeHash).toStartWith(actual);
  });
});

describe("alpha generation long-term stability by size", () => {
  const givenName = "abc-input";
  const longTermHugeHash = "zfkfshrxmzmukpmblrujwrqlgyuapazvaqmkqpwwbmasucylqgsxcuvlgduxoeyoxhurxoawbrayfxmrowhtlnkvkjkrfavlvakozmvbnyclgislqkqhajiwcnrtuxujgkvmephsaclttyircvilimajspfjweyxtlzahrpqlyeyknnjltgnuxjsivbniisnxcgzzjyq";

  it("small", () => {
    const actual = new NameHash(givenName, { type: "alpha", defaultLength: 2 })();
    expect(actual).toHaveLength(2);
    expect(longTermHugeHash).toStartWith(actual);
  });
  it("default", () => {
    const actual = new NameHash(givenName, { type: "alpha", defaultLength: undefined })();
    expect(actual).toHaveLength(3);
    expect(longTermHugeHash).toStartWith(actual);
  });
  it("huge", () => {
    const actual = new NameHash(givenName, { type: "alpha", defaultLength: 200 })();
    expect(actual).toHaveLength(200);
    expect(longTermHugeHash).toStartWith(actual);
  });
});

describe("hex generation long-term stability by size", () => {
  const givenName = "hex-input";
  const longTermHugeHash = "29da8b0df30fd87061c535c46a15d6d928cf41cf6c7b3981ff2effbf183e04e202b08674ea7bc4f79a7ec281305121f10148fc7d1345b99d712bb81657d7581853f61b12c576fae511baedff632a8098e9f5138b8bd11a2f9e631cc0f66135032329edb1";

  it("small", () => {
    const actual = new NameHash(givenName, { type: "hex", defaultLength: 2 })();
    expect(actual).toHaveLength(2);
    expect(longTermHugeHash).toStartWith(actual);
  });
  it("default", () => {
    const actual = new NameHash(givenName, { type: "hex", defaultLength: undefined })();
    expect(actual).toHaveLength(4);
    expect(longTermHugeHash).toStartWith(actual);
  });
  it("huge", () => {
    const actual = new NameHash(givenName, { type: "hex", defaultLength: 200 })();
    expect(actual).toHaveLength(200);
    expect(longTermHugeHash).toStartWith(actual);
  });
});

describe("numeric generation long-term stability by size", () => {
  const givenName = "123-input";
  const longTermHugeHash = "08877159949384226962477697075934455023491100904365852208127779627777045555170806496813727047157844761875393773458862297878925806559980622939143010804526444691686898114376839805663855593778981592919269";

  it("small", () => {
    const actual = new NameHash(givenName, { type: "numeric", defaultLength: 2 })();
    expect(actual).toHaveLength(2);
    expect(longTermHugeHash).toStartWith(actual);
  });
  it("default", () => {
    const actual = new NameHash(givenName, { type: "numeric", defaultLength: undefined })();
    expect(actual).toHaveLength(4);
    expect(longTermHugeHash).toStartWith(actual);
  });
  it("huge", () => {
    const actual = new NameHash(givenName, { type: "numeric", defaultLength: 200 })();
    expect(actual).toHaveLength(200);
    expect(longTermHugeHash).toStartWith(actual);
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
  const expected = `123${new NameHash("abc").toString()}456`;
  it("interpolated string", () => {
    const hash = new NameHash("abc");
    const actual = `123${hash}456`;
    expect(actual).toBe(expected);
  });
  it("string concat", () => {
    const hash = new NameHash("abc");
    const actual = "123".concat(hash.toString(), "456");
    expect(actual).toBe(expected);
  });
  it("string plus operator", () => {
    const hash = new NameHash("abc");
    const actual = "123" + hash + "456";
    expect(actual).toBe(expected);
  });
  it("string plus operator hash lvalue", () => {
    const hash = new NameHash("abc");
    let actual = hash + "456";
    actual = "123" + actual;
    expect(actual).toBe(expected);
  });
  it("string append operator", () => {
    const hash = new NameHash("abc");
    let actual = "123";
    actual += hash;
    actual += "456";
    expect(actual).toBe(expected);
  });
});
