import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { buildCliCredential } from "./armpitCredential.js";
import type { AzCliAccessToken } from "./azureUtils.js";

describe("ArmpitCredential getToken", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  const strictMock = vi.fn();
  const fakeInvoker = Object.assign(strictMock, {});

  it("get token in default context", async () => {
    strictMock.mockResolvedValue({
      accessToken: "abc123",
      tokenType: "Bearer",
      expires_on: new Date().getTime() / 1000,
    } as AzCliAccessToken);
    const credential = buildCliCredential(fakeInvoker);

    const result = await credential.getToken("https://management.azure.com/.default");

    expect(result).toBeTruthy();
    expect(result?.token).toBe("abc123");
    expect(strictMock)
      .toHaveBeenCalledExactlyOnceWith`account get-access-token ${["--scope", "https://management.azure.com/.default"]}`;
  });
});
