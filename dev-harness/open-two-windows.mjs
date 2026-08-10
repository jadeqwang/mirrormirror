import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import process from "node:process";

const host = process.env.DEV_HOST ?? "127.0.0.1";
const port = Number(process.env.DEV_PORT ?? 5173);
const baseUrl = `http://${host}:${port}`;
const mockCase = process.env.MOCK_GENERATION_CASE ?? "normal";
const mockQuery = new URLSearchParams({ mock_camera: "1", mock_generation: mockCase });
const urls = ["praise", "roast"].map(
  (screen) => `${baseUrl}/?screen=${screen}&${mockQuery}`,
);

const viteBin = new URL("../node_modules/vite/bin/vite.js", import.meta.url).pathname;
const serverEntry = new URL("../server/index.ts", import.meta.url).pathname;
const api = spawn(process.execPath, ["--experimental-strip-types", serverEntry], {
  env: { ...process.env, MOCK_GENERATION: "1", HOST: "127.0.0.1", PORT: "4173", STATIC_DIR: "kiosk" },
  stdio: ["ignore", "inherit", "inherit"],
});
const vite = spawn(process.execPath, [viteBin, "--host", host, "--port", String(port), "kiosk"], {
  env: { ...process.env, MOCK_CAMERA: "1", MOCK_GENERATION: "1" },
  stdio: ["ignore", "pipe", "inherit"],
});

let opened = false;
vite.stdout.setEncoding("utf8");
vite.stdout.on("data", (chunk) => {
  process.stdout.write(chunk);
  if (!opened && /Local:|ready in/i.test(chunk)) {
    opened = true;
    openWindows(urls);
  }
});

let shuttingDown = false;
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    shuttingDown = true;
    vite.kill(signal);
    api.kill(signal);
  });
}

const [name, code] = await Promise.race([
  once(vite, "exit").then(([exitCode]) => ["Vite", exitCode]),
  once(api, "exit").then(([exitCode]) => ["mock API", exitCode]),
]);
vite.kill("SIGTERM");
api.kill("SIGTERM");
if (code !== null && code !== 0) process.exitCode = code;
if (!shuttingDown && name === "mock API") console.error("Mock API exited before the dev server");

function openWindows(targets) {
  const browser = process.env.BROWSER ?? findBrowser();
  if (!browser) {
    console.warn(`No Chromium browser found. Open these URLs manually:\n${targets.join("\n")}`);
    return;
  }

  const child = spawn(browser, ["--new-window", ...targets], {
    detached: true,
    stdio: "ignore",
  });
  child.unref();
}

function findBrowser() {
  for (const candidate of ["google-chrome", "chromium", "chromium-browser"]) {
    if (process.platform !== "win32" && commandExists(candidate)) return candidate;
  }
  return process.platform === "darwin" ? "open" : undefined;
}

function commandExists(command) {
  const result = spawnSync(command, ["--version"], { stdio: "ignore" });
  return result.error === undefined;
}
