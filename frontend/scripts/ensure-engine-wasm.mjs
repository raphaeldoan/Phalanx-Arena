import { access } from "node:fs/promises";
import path from "node:path";

const requiredFiles = [
  "package.json",
  "engine_wasm.js",
  "engine_wasm.d.ts",
  "engine_wasm_bg.wasm",
  "engine_wasm_bg.wasm.d.ts",
];

const generatedDir = path.resolve(import.meta.dirname, "../src/generated/engine-wasm");

async function main() {
  const missing = [];
  for (const file of requiredFiles) {
    const target = path.join(generatedDir, file);
    try {
      await access(target);
    } catch {
      missing.push(file);
    }
  }

  if (missing.length > 0) {
    console.error(
      [
        "Missing generated engine wasm artifacts:",
        ...missing.map((file) => `- ${file}`),
        "",
        "Run `npm run build:engine-wasm` locally and commit the generated files before deploying to Cloudflare.",
      ].join("\n"),
    );
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
