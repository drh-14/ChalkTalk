import { expect, it } from "vitest";
import { ApiError } from "../auth/client.js";
import { retryFreshTicket } from "./ticket-retry.js";
it("retries only transient 503/network failures and returns only the fresh ticket", async () => {
  let calls = 0;
  let notices = 0;
  const value = await retryFreshTicket(
    async () => {
      calls++;
      if (calls === 1)
        throw new ApiError(503, "service_unavailable", "temporary");
      if (calls === 2) throw new TypeError("network failed");
      return "fresh-ticket";
    },
    new AbortController().signal,
    () => {
      notices++;
    },
    1,
  );
  expect(value).toBe("fresh-ticket");
  expect(calls).toBe(3);
  expect(notices).toBe(2);
});
it.each([401, 403, 404, 409])(
  "does not retry permanent HTTP %s",
  async (status) => {
    let calls = 0;
    const error = new ApiError(status, "access_removed", "permanent");
    await expect(
      retryFreshTicket(
        async () => {
          calls++;
          throw error;
        },
        new AbortController().signal,
        () => {},
        1,
      ),
    ).rejects.toBe(error);
    expect(calls).toBe(1);
  },
);
it("cancels a pending retry without issuing another ticket request", async () => {
  let calls = 0;
  const controller = new AbortController();
  const pending = retryFreshTicket(
    async () => {
      calls++;
      throw new ApiError(503, "service_unavailable", "temporary");
    },
    controller.signal,
    () => {
      controller.abort();
    },
    1,
  );
  await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  expect(calls).toBe(1);
});
it("rejects a late fresh ticket after disposal rather than returning stale-session authorization", async () => {
  const controller = new AbortController();
  let complete!: (value: string) => void;
  const request = new Promise<string>((done) => {
    complete = done;
  });
  const pending = retryFreshTicket(
    () => request,
    controller.signal,
    () => {},
    1,
  );
  controller.abort();
  complete("late-ticket");
  await expect(pending).rejects.toMatchObject({ name: "AbortError" });
});
