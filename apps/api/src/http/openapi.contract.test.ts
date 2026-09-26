import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const openApiUrl = new URL(
  "../../../../documentation/openapi.yaml",
  import.meta.url,
);

async function accountCreationContract(): Promise<string> {
  const document = await readFile(openApiUrl, "utf8");
  const match = document.match(
    /^[ ]{2}"\/users":\n([\s\S]*?)(?=^[ ]{2}"\/[^\n]+":|^components:)/m,
  );
  if (!match)
    throw new Error(
      "OpenAPI document does not define the account creation path",
    );
  return match[1];
}

describe("OpenAPI account creation contract", () => {
  it("describes a direct organization association without an organization membership", async () => {
    const accountCreation = await accountCreationContract();

    expect(accountCreation).toMatch(/direct(?:ly)?[^\n]*organization/i);
    expect(accountCreation).not.toMatch(/creates? (?:an? |its )?membership/i);
  });
});
