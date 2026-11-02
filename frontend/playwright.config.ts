import { defineConfig, devices } from "@playwright/test";
import path from "node:path";
import os from "node:os";

const local = process.env.PLAYWRIGHT_LOCAL === "1";
const port = local ? 8017 : 8000;
const baseURL = `http://127.0.0.1:${port}`;
const backendDir = path.resolve(__dirname, "..", "backend");
const backendPython = path.join(backendDir, ".venv", process.platform === "win32" ? "Scripts\\python.exe" : "bin/python");

export default defineConfig({
  testDir: "./tests",
  timeout: 60_000,
  expect: {
    timeout: 10_000,
  },
  workers: 1,
  use: {
    baseURL,
    trace: "retain-on-failure",
  },
  webServer: {
    command: local
      ? `"${backendPython}" -m uvicorn app.main:app --app-dir "${backendDir}" --host 127.0.0.1 --port ${port}`
      : "docker compose up --build",
    url: `${baseURL}/api/health`,
    reuseExistingServer: !local,
    env: local ? {
      DATABASE_PATH: process.env.E2E_DATABASE_PATH ?? path.join(os.tmpdir(), `kanban-e2e-${process.pid}.sqlite3`),
      DATABASE_URL: "",
      STATIC_DIR: path.resolve(__dirname, "out"),
      APP_ENV: "development",
      MVP_PASSWORD: "password",
      SESSION_SECRET: "playwright-isolated-session-secret",
      OPENROUTER_API_KEY: "",
    } : undefined,
    timeout: 300_000,
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
