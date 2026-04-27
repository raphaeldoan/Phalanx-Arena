import { access, rm, writeFile } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import path from "node:path";
import process from "node:process";
import { spawn } from "node:child_process";

const projectRoot = path.resolve(import.meta.dirname, "..");
const repositoryRoot = path.resolve(projectRoot, "..");
const generatedDir = path.resolve(projectRoot, "src/generated/engine-wasm");
const staleGeneratedDirs = [
  path.resolve(repositoryRoot, "engine/engine-wasm/src/generated/engine-wasm"),
  path.resolve(repositoryRoot, "engine/frontend/src/generated/engine-wasm"),
];
const requiredGeneratedFiles = [
  "package.json",
  "engine_wasm.js",
  "engine_wasm.d.ts",
  "engine_wasm_bg.wasm",
  "engine_wasm_bg.wasm.d.ts",
];
const generatedIgnoreContents = [
  "*",
  "!.gitignore",
  "!package.json",
  "!engine_wasm.js",
  "!engine_wasm.d.ts",
  "!engine_wasm_bg.wasm",
  "!engine_wasm_bg.wasm.d.ts",
  "",
].join("\n");
const candidateExecutables = [];

if (process.platform === "win32") {
  candidateExecutables.push(
    path.join(process.env.USERPROFILE ?? "", ".cargo", "bin", "wasm-pack.exe"),
    "wasm-pack.exe",
    "wasm-pack",
  );
} else {
  candidateExecutables.push(
    path.join(process.env.HOME ?? "", ".cargo", "bin", "wasm-pack"),
    "wasm-pack",
  );
}

async function resolveExecutable() {
  for (const candidate of candidateExecutables) {
    if (!candidate) continue;
    const isPath = candidate.includes(path.sep);
    if (!isPath) {
      return candidate;
    }
    try {
      await access(candidate, fsConstants.X_OK);
      return candidate;
    } catch {
      // Try the next candidate.
    }
  }
  throw new Error(
    "wasm-pack was not found. Install it locally and ensure it is available in PATH or in ~/.cargo/bin.",
  );
}

async function getMissingGeneratedFiles() {
  const missing = [];
  for (const file of requiredGeneratedFiles) {
    try {
      await access(path.join(generatedDir, file), fsConstants.F_OK);
    } catch {
      missing.push(file);
    }
  }
  return missing;
}

async function removeStaleGeneratedDirs() {
  for (const dir of staleGeneratedDirs) {
    const relative = path.relative(repositoryRoot, dir);
    if (relative.startsWith("..") || path.isAbsolute(relative)) {
      throw new Error(`Refusing to remove generated directory outside the repository: ${dir}`);
    }
    await rm(dir, { recursive: true, force: true });
  }
}

async function restoreGeneratedIgnore() {
  await writeFile(path.join(generatedDir, ".gitignore"), generatedIgnoreContents, "utf8");
}

function buildRustFlagsEnv() {
  const remaps = [
    [repositoryRoot, "."],
    [process.env.CARGO_HOME, "$CARGO_HOME"],
    [process.env.USERPROFILE ? path.join(process.env.USERPROFILE, ".cargo") : "", "~/.cargo"],
    [process.env.USERPROFILE ?? process.env.HOME ?? "", "~"],
  ];
  const flags = [];
  const seen = new Set();
  for (const [from, to] of remaps) {
    if (!from || seen.has(from)) {
      continue;
    }
    seen.add(from);
    flags.push(`--remap-path-prefix=${from}=${to}`);
  }
  return [process.env.RUSTFLAGS, ...flags].filter(Boolean).join(" ");
}

function isMissingExecutableError(error) {
  if (!(error instanceof Error)) {
    return false;
  }
  return error.message.includes("wasm-pack was not found") || error.code === "ENOENT";
}

async function main() {
  await removeStaleGeneratedDirs();

  const args = [
    "build",
    "../engine/engine-wasm",
    "--target",
    "web",
    "--out-dir",
    "../../frontend/src/generated/engine-wasm",
    "--release",
  ];

  try {
    const executable = await resolveExecutable();
    await new Promise((resolve, reject) => {
      const child = spawn(executable, args, {
        cwd: projectRoot,
        env: {
          ...process.env,
          RUSTFLAGS: buildRustFlagsEnv(),
        },
        stdio: "inherit",
      });
      child.on("exit", (code) => {
        if (code === 0) {
          resolve();
          return;
        }
        reject(new Error(`wasm-pack exited with code ${code ?? "unknown"}`));
      });
      child.on("error", reject);
    });
    await restoreGeneratedIgnore();
  } catch (error) {
    if (!isMissingExecutableError(error)) {
      await restoreGeneratedIgnore().catch(() => undefined);
      throw error;
    }

    const missingGeneratedFiles = await getMissingGeneratedFiles();
    if (missingGeneratedFiles.length === 0) {
      await restoreGeneratedIgnore();
      console.warn(
        [
          "wasm-pack was not found. Reusing the committed generated engine wasm bundle.",
          "Install wasm-pack only if you need to rebuild frontend/src/generated/engine-wasm locally.",
        ].join("\n"),
      );
      return;
    }

    throw new Error(
      [
        "wasm-pack was not found and the generated engine wasm bundle is incomplete.",
        ...missingGeneratedFiles.map((file) => `- ${file}`),
        "",
        "Install wasm-pack or restore the committed files in frontend/src/generated/engine-wasm.",
      ].join("\n"),
    );
  }
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
