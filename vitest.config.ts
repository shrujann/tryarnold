import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import { defineWorkersConfig } from "@cloudflare/vitest-pool-workers/config";

const root = path.dirname(fileURLToPath(import.meta.url));
const workerThreadsShim = path.resolve(root, "tests/shims/worker_threads.ts");

const workersConfig = defineWorkersConfig({
  resolve: {
    alias: {
      "node:worker_threads": workerThreadsShim,
    },
  },
  test: {
    name: "workers",
    globals: true,
    include: ["tests/**/*.test.ts"],
    exclude: [
      "tests/agents.test.ts",
      "tests/webhooks.test.ts",
      "tests/food-image-rank.test.ts",
    ],
    poolOptions: {
      workers: {
        wrangler: { configPath: "./wrangler.toml" },
      },
    },
  },
});

export default defineConfig({
  test: {
    projects: [
      workersConfig,
      {
        test: {
          name: "node",
          include: [
            "tests/agents.test.ts",
            "tests/webhooks.test.ts",
            "tests/food-image-rank.test.ts",
          ],
          environment: "node",
        },
      },
    ],
  },
});
