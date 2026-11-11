import { describe, expect, it, vi } from "vitest";
import { runSmoke, type SmokePorts } from "./smoke.js";

function ports(): SmokePorts {
  return {
    expectedMigrations: async () => ["001.sql", "002.sql"],
    appliedMigrations: async () => ["001.sql", "002.sql"],
    put: vi.fn(async () => {}),
    get: vi.fn(async () => Buffer.from("chalktalk-deployment-smoke")),
    remove: vi.fn(async () => {}),
    send: vi.fn(async () => {}),
  };
}

describe("production smoke", () => {
  it("verifies schema and private Storage, cleans up, then sends only to the test inbox", async () => {
    const target = ports();
    await runSmoke("a".repeat(40), target);
    expect(target.put).toHaveBeenCalledOnce();
    expect(target.get).toHaveBeenCalledOnce();
    expect(target.remove).toHaveBeenCalledOnce();
    expect(target.send).toHaveBeenCalledWith(
      "chalktalk602@gmail.com",
      expect.stringContaining("a".repeat(40)),
      "chalktalk-deploy-" + "a".repeat(40),
    );
  });

  it("does not send if the ledger is incomplete", async () => {
    const target = ports();
    target.appliedMigrations = async () => ["001.sql"];
    await expect(runSmoke("a".repeat(40), target)).rejects.toThrow(
      "migration ledger",
    );
    expect(target.put).not.toHaveBeenCalled();
    expect(target.send).not.toHaveBeenCalled();
  });

  it("removes the temporary object after a read failure", async () => {
    const target = ports();
    target.get = vi.fn(async () => {
      throw new Error("network dropped");
    });
    await expect(runSmoke("a".repeat(40), target)).rejects.toThrow(
      "network dropped",
    );
    expect(target.remove).toHaveBeenCalledOnce();
    expect(target.send).not.toHaveBeenCalled();
  });

  it("attempts cleanup even when the write result is lost", async () => {
    const target = ports();
    target.put = vi.fn(async () => {
      throw new Error("write response lost");
    });
    await expect(runSmoke("a".repeat(40), target)).rejects.toThrow(
      "write response lost",
    );
    expect(target.remove).toHaveBeenCalledOnce();
    expect(target.send).not.toHaveBeenCalled();
  });

  it("fails when cleanup fails rather than claiming success", async () => {
    const target = ports();
    target.remove = vi.fn(async () => {
      throw new Error("cleanup failed");
    });
    await expect(runSmoke("a".repeat(40), target)).rejects.toThrow(
      "cleanup failed",
    );
    expect(target.send).not.toHaveBeenCalled();
  });

  it("fails on an unaccepted email and rejects malformed SHAs", async () => {
    const target = ports();
    target.send = vi.fn(async () => {
      throw new Error("network dropped");
    });
    await expect(runSmoke("a".repeat(40), target)).rejects.toThrow(
      "network dropped",
    );
    await expect(runSmoke("main", target)).rejects.toThrow("commit SHA");
  });
});
