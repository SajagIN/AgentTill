/**
 * Full build for AgentTill.
 *
 *   bun run build
 *
 * The backend is plain ESM with no compile step, so "building the backend"
 * means proving it bundles: every import in the server and MCP entry points
 * resolves and every file parses. The frontend is a Vite SPA that the server
 * serves from frontend/dist, so it is built second.
 *
 * Run order matters — a broken backend is reported before time is spent on the
 * SPA bundle.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DIST = path.join(ROOT, "frontend", "dist");
const BACKEND_ENTRIES = ["src/server.js", "src/mcp-server.js"];

const run = (cmd, cwd) => Bun.spawn({ cmd, cwd, stdout: "inherit", stderr: "inherit" }).exited;

const step = (label) => console.log(`\n▸ ${label}`);

step("1/3 bundling the backend — resolves every import");
for (const entry of BACKEND_ENTRIES) {
  const outfile = path.join(ROOT, ".build-check", path.basename(entry));
  const code = await run(["bun", "build", entry, "--target=bun", "--outfile", outfile], ROOT);
  if (code !== 0) {
    console.error(`\n✖ backend bundle failed for ${entry}`);
    process.exit(1);
  }
}
console.log(`  ✓ ${BACKEND_ENTRIES.length} entry points bundle cleanly`);

step("2/3 building the React dashboard");
if ((await run(["bun", "run", "build"], path.join(ROOT, "frontend"))) !== 0) {
  console.error("\n✖ frontend build failed");
  process.exit(1);
}

step("3/3 verifying the build output");
if (!fs.existsSync(path.join(DIST, "index.html"))) {
  console.error(`\n✖ expected ${path.relative(ROOT, DIST)}/index.html after the build`);
  process.exit(1);
}
const assets = fs
  .readdirSync(path.join(DIST, "assets"))
  .filter((file) => file.endsWith(".js") || file.endsWith(".css"));

fs.rmSync(path.join(ROOT, ".build-check"), { recursive: true, force: true });

console.log(`  ✓ frontend/dist/index.html + ${assets.length} bundle(s)`);
console.log("\n✔ build complete — start it with `bun run start`");
