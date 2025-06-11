import { createHash, createHmac } from "node:crypto";
import { CallableClassBase } from "./utils.js";

export interface NameHash {
  (length?: number): string;
}

type EncodingKind = "hex" | "alphanumeric" | "alpha" | "numeric";

interface NameHashOptions {
  type?: EncodingKind,
  defaultLength?: number
}

function isNameHashOptions(value: any): value is NameHashOptions {
  return value != null && typeof value === "object";
}

export class NameHash extends CallableClassBase {

  private static calculateSha256Hash(values: any[]) {
    const valuesHasher = createHash("sha256");
    for (const value of values) {
      if (typeof value === "string") {
        valuesHasher.update(value, "utf8");
      } else {
        valuesHasher.update(value);
      }
    }

    return valuesHasher.digest();
  }

  private static calculateSha256Hmac(prk: Buffer, input: Buffer) {
    const hmac = createHmac("sha256", prk);
    hmac.update(input);
    const buffer = hmac.digest();

    if (!(buffer.length > 0)) {
      throw new Error("Hash failure");
    }

    return buffer;
  }

  private static packBufferIntoInt(buffer: Buffer): BigInt {
    let result = 0n;
    for (let i = 0; i < buffer.length; i++) {
      result |= BigInt(buffer[i]) << BigInt(i * 8);
    }

    return result;
  }

  #values: string[];
  #options: {
    type: EncodingKind,
    defaultLength: number,
  };
  #cached: string | null;

  constructor(value: string);
  constructor(value: string, options: NameHashOptions);
  constructor(...values: string[]);
  constructor(...args: [...values: string[], options: NameHashOptions]);
  constructor(...args: string[] | [...values: string[], options: NameHashOptions]) {
    super();

    let options: NameHashOptions | null;
    let values: string[];

    if (args.length === 0) {
      options = null;
      values = [];
    } else {
      const lastArg = args[args.length - 1];
      if (isNameHashOptions(lastArg)) {
        values = args.slice(0, args.length - 1) as string[];
        options = lastArg;
      }
      else {
        values = args as string[];
        options = null;
      }
    }

    this.#values = values;
    this.#options = {
      type: options?.type ?? "alphanumeric",
      defaultLength: Math.max(options?.defaultLength ?? 4, 1)
    };

    this.#cached = null;
  }

  concat(value: string) {
    return new NameHash(...this.#values, value, this.#options);
  }

  toString(length?: number) {
    length = length != null && length > 0 ? length : this.#options.defaultLength;
    let result = this.#cached;
    if (result == null || result.length < length) {
      result = this.#buildHashText(length);
      this.#cached = result;
    }

    if (result.length > length) {
      result = result.slice(0, length);
    }

    return result;
  }

  protected fnImpl(length?: number) {
    return this.toString(length);
  }

  #buildHashText(minTextLength: number): string {
    let hashValue = "";
    let tBuffer : Buffer | null = null;

    const pseudoRandomKey = NameHash.calculateSha256Hash(this.#values);
    let iteration = 1;

    while (hashValue.length < minTextLength) {
      // This is the expansion
      let hmacInputBuffer = Buffer.from([iteration % 256]);
      if (tBuffer) {
        hmacInputBuffer = Buffer.concat([tBuffer, hmacInputBuffer]);
      }

      tBuffer = NameHash.calculateSha256Hmac(pseudoRandomKey, hmacInputBuffer);

      // Get some base36 characters from the hash
      const tNum = NameHash.packBufferIntoInt(tBuffer);
      let iterationHashValue = tNum.toString(36);

      const expectedIterationCharacters = 49; // based on getting ~49.5 base36 characters from 256 bytes
      // Each iteration should produce a specific number of characters.
      if (iterationHashValue.length < expectedIterationCharacters) {
        // Sometimes we may get a 50th character out of it. It isn't a full byte so drop it.
        iterationHashValue = iterationHashValue.slice(0, expectedIterationCharacters);
      } else if (iterationHashValue.length > expectedIterationCharacters) {
        // Sometimes we may get a value with high order zeros, so we must pad it.
        iterationHashValue = iterationHashValue.padStart(expectedIterationCharacters, "0");
      }

      // Hashes of different lengths but sourced from the same inputs should sort together.
      // Because the output base36 values are effectively text which sorts left to right,
      // the lower order values should be on the left so that additional generated hash bytes
      // are eventually appended to the right of the string. A simple reverse after building
      // the value should work.
      iterationHashValue = iterationHashValue.split("").reverse().join("");

      hashValue += iterationHashValue;
      iteration++;
    }

    return hashValue;
  }

}
