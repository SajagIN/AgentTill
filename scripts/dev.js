/**
 * Local development: the API on :3000 with hot reload, plus Vite on :5173
 * proxying /api, /pay and /webhooks to it.
 *
 *   bun run dev
 */
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const COLOURS = { api: "\x1b[36m", web: "\x1b[35m" };
const RESET = "\x1b[0m";

function spawn(label, cmd, cwd) {
  const proc = Bun.spawn({ cmd, cwd, stdout: "pipe", stderr: "pipe" });
  const prefix = `${COLOURS[label]}[${label}]${RESET} `;
  const pipe = async (stream) => {
    const reader = stream.getReader();
    let buffer = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += new TextDecoder().decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) console.log(`${prefix}${line}`);
    }
  };
  pipe(proc.stdout);
  pipe(proc.stderr);
  return proc;
}

const api = spawn("api", ["bun", "--watch", "src/server.js"], ROOT);
const web = spawn("web", ["bun", "run", "dev"], path.join(ROOT, "frontend"));

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    api.kill();
    web.kill();
    process.exit(0);
  });
}

await Promise.race([api.exited, web.exited]);
api.kill();
web.kill();
