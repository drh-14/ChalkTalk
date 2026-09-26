import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "api",
          include: ["apps/api/**/*.test.ts"],
          environment: "node",
        },
      },
      {
        test: {
          name: "web",
          include: ["apps/web/**/*.test.{ts,tsx}"],
          environment: "jsdom",
        },
      },
    ],
  },
});
