#!/usr/bin/env node
import { spawn } from "node:child_process";
import { constants as fsConstants } from "node:fs";
import { access, mkdir, readFile } from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import process from "node:process";

const projectRoot = path.resolve(import.meta.dirname, "..");
const defaultWidth = 1280;
const defaultHeight = 720;
const defaultFps = 30;
const defaultActionDurationMs = 720;
const defaultStartHoldMs = 900;
const defaultEndHoldMs = 1400;
const defaultTimeoutMs = 10 * 60 * 1000;

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printUsage();
    return;
  }
  if (!args.input) {
    throw new Error("Missing --input <json>.");
  }

  const inputPath = path.resolve(process.cwd(), args.input);
  const choices = extractReplayChoices(JSON.parse(await readFile(inputPath, "utf8")), path.basename(inputPath));
  if (!choices.length) {
    throw new Error(`No replay payloads were found in ${inputPath}.`);
  }

  if (args.list) {
    printReplayChoices(choices);
    return;
  }

  if (!args.output) {
    throw new Error("Missing --output <video path>. Use --list to inspect available replay choices.");
  }

  const selectedChoice = selectReplayChoice(choices, args);
  if (!selectedChoice) {
    printReplayChoices(choices);
    throw new Error("Select one replay with --replay-index <n> or --match-index <n>.");
  }

  let vite = null;
  let browser = null;

  try {
    const { chromium } = await importPlaywright();
    browser = await chromium.launch({
      headless: !args.headful,
      args: ["--autoplay-policy=no-user-gesture-required"],
    });

    if (!args.skipWasmBuild) {
      await runChecked(process.execPath, [path.join(projectRoot, "scripts", "build-engine-wasm.mjs")], {
        cwd: projectRoot,
      });
    }

    const port = await findOpenPort(5180);
    vite = await startVite(port, args.verbose);
    const context = await browser.newContext({
      acceptDownloads: true,
      viewport: {
        width: args.width,
        height: args.height,
      },
    });
    const page = await context.newPage();
    page.on("console", (message) => {
      if (message.text().includes("send was called before connect")) {
        return;
      }
      if (message.type() === "error" || (args.verbose && message.type() === "warning")) {
        process.stderr.write(`[browser:${message.type()}] ${message.text()}\n`);
      }
    });
    page.on("pageerror", (error) => {
      process.stderr.write(`[browser:error] ${error.message}\n`);
    });
    const rendererDone = createDeferred();
    const rendererError = createDeferred();

    await page.exposeFunction("__PHALANX_REPLAY_VIDEO_DONE__", (result) => {
      rendererDone.resolve(result);
    });
    await page.exposeFunction("__PHALANX_REPLAY_VIDEO_ERROR__", (message) => {
      rendererError.reject(new Error(String(message || "Replay video rendering failed.")));
    });
    await page.addInitScript((request) => {
      window.__PHALANX_REPLAY_VIDEO_REQUEST__ = request;
    }, {
      actionDurationMs: args.actionDurationMs,
      cameraDistanceScale: args.cameraDistanceScale,
      endHoldMs: args.endHoldMs,
      fps: args.fps,
      label: selectedChoice.label,
      providerLabels: selectedChoice.commanderLabels,
      replay: selectedChoice.replay,
      startHoldMs: args.startHoldMs,
    });

    const url = `http://127.0.0.1:${port}/?replay-video-renderer=1`;
    const downloadPromise = page.waitForEvent("download", { timeout: args.timeoutMs });
    console.error(`Recording replay ${selectedChoice.index}: ${selectedChoice.label}`);
    await page.goto(url, { waitUntil: "domcontentloaded" });

    const download = await Promise.race([downloadPromise, rendererError.promise]);
    const outputPath = resolveOutputPath(args.output, download.suggestedFilename());
    await mkdir(path.dirname(outputPath), { recursive: true });
    await download.saveAs(outputPath);
    await Promise.race([rendererDone.promise, waitForDelay(3000)]).catch(() => undefined);
    console.log(outputPath);
  } catch (error) {
    throw augmentPlaywrightError(error);
  } finally {
    if (browser) {
      await browser.close().catch(() => undefined);
    }
    if (vite) {
      stopChild(vite);
    }
  }
}

function parseArgs(argv) {
  const args = {
    actionDurationMs: defaultActionDurationMs,
    cameraDistanceScale: 1,
    endHoldMs: defaultEndHoldMs,
    fps: defaultFps,
    headful: false,
    height: defaultHeight,
    help: false,
    input: "",
    list: false,
    matchIndex: null,
    output: "",
    replayIndex: null,
    skipWasmBuild: false,
    startHoldMs: defaultStartHoldMs,
    timeoutMs: defaultTimeoutMs,
    verbose: false,
    width: defaultWidth,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") {
      args.help = true;
    } else if (arg === "--input" || arg === "-i") {
      args.input = readValue(argv, ++index, arg);
    } else if (arg === "--output" || arg === "-o") {
      args.output = readValue(argv, ++index, arg);
    } else if (arg === "--list") {
      args.list = true;
    } else if (arg === "--replay-index") {
      args.replayIndex = readPositiveInteger(argv, ++index, arg);
    } else if (arg === "--match-index") {
      args.matchIndex = readInteger(argv, ++index, arg);
    } else if (arg === "--width") {
      args.width = readPositiveInteger(argv, ++index, arg);
    } else if (arg === "--height") {
      args.height = readPositiveInteger(argv, ++index, arg);
    } else if (arg === "--fps") {
      args.fps = readPositiveInteger(argv, ++index, arg);
    } else if (arg === "--action-ms") {
      args.actionDurationMs = readPositiveInteger(argv, ++index, arg);
    } else if (arg === "--camera-distance-scale") {
      args.cameraDistanceScale = readPositiveNumber(argv, ++index, arg);
    } else if (arg === "--start-hold-ms") {
      args.startHoldMs = readNonNegativeInteger(argv, ++index, arg);
    } else if (arg === "--end-hold-ms") {
      args.endHoldMs = readNonNegativeInteger(argv, ++index, arg);
    } else if (arg === "--timeout-ms") {
      args.timeoutMs = readPositiveInteger(argv, ++index, arg);
    } else if (arg === "--headful") {
      args.headful = true;
    } else if (arg === "--skip-wasm-build") {
      args.skipWasmBuild = true;
    } else if (arg === "--verbose") {
      args.verbose = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return args;
}

function printUsage() {
  console.log(`Usage:
  npm run replay:video -- --input <replay-or-report.json> --output <video.webm> [options]

Options:
  --list                    List replay payloads found in the input JSON.
  --replay-index <n>        1-based replay choice from --list output.
  --match-index <n>         Match index from benchmark/tournament JSON.
  --width <px>              Viewport width. Default ${defaultWidth}.
  --height <px>             Viewport height. Default ${defaultHeight}.
  --fps <n>                 Recording frame rate. Default ${defaultFps}.
  --action-ms <ms>          Hold duration per replay action. Default ${defaultActionDurationMs}.
  --camera-distance-scale <n>
                            Scale camera distance from target. Use < 1 to zoom in. Default 1.
  --start-hold-ms <ms>      Initial hold. Default ${defaultStartHoldMs}.
  --end-hold-ms <ms>        Final hold. Default ${defaultEndHoldMs}.
  --headful                 Show Chromium while recording.
  --skip-wasm-build         Reuse existing generated WASM artifacts.
  --verbose                 Print Vite and browser warning output.`);
}

function printReplayChoices(choices) {
  for (const choice of choices) {
    const match = choice.matchIndex === null ? "" : ` match_index=${choice.matchIndex}`;
    console.log(`[${choice.index}]${match} ${choice.label}`);
  }
}

function selectReplayChoice(choices, args) {
  if (args.replayIndex !== null) {
    return choices.find((choice) => choice.index === args.replayIndex) ?? null;
  }
  if (args.matchIndex !== null) {
    const matches = choices.filter((choice) => choice.matchIndex === args.matchIndex);
    if (matches.length === 1) {
      return matches[0];
    }
    if (matches.length > 1) {
      return null;
    }
  }
  return choices.length === 1 ? choices[0] : null;
}

function extractReplayChoices(payload, sourceLabel) {
  const choices = [];
  collectReplayChoices(payload, sourceLabel, choices, new Set());
  return choices.map((choice, index) => ({
    ...choice,
    index: index + 1,
  }));
}

function collectReplayChoices(value, fallbackLabel, choices, visited) {
  if (!value || typeof value !== "object") {
    return;
  }
  if (visited.has(value)) {
    return;
  }
  visited.add(value);

  if (isReplayData(value)) {
    choices.push({
      commanderLabels: null,
      label: buildReplayLabel(value, fallbackLabel),
      matchIndex: null,
      replay: normalizeReplay(value),
    });
    return;
  }

  if (Array.isArray(value)) {
    value.forEach((entry, index) => collectReplayChoices(entry, `${fallbackLabel} ${index + 1}`, choices, visited));
    return;
  }

  const record = value;
  if (isReplayData(record.replay)) {
    const matchIndex = readFiniteNumber(record.match_index);
    choices.push({
      commanderLabels: readCommanderLabelRecord(record.commander_labels),
      label: buildReplayLabel(record.replay, describeReplayContainer(record, fallbackLabel)),
      matchIndex,
      replay: normalizeReplay(record.replay),
    });
  }

  for (const [key, child] of Object.entries(record)) {
    if (key === "replay") {
      continue;
    }
    collectReplayChoices(child, `${fallbackLabel} ${key}`, choices, visited);
  }
}

function isReplayData(value) {
  return Boolean(
    value &&
      typeof value === "object" &&
      typeof value.scenario_id === "string" &&
      Number.isFinite(value.seed) &&
      Array.isArray(value.actions) &&
      value.actions.every((action) => action && typeof action === "object" && typeof action.type === "string"),
  );
}

function normalizeReplay(replay) {
  return {
    scenario_id: replay.scenario_id,
    seed: replay.seed,
    deployment_first_army: readArmyId(replay.deployment_first_army),
    first_bound_army: readArmyId(replay.first_bound_army),
    actions: replay.actions,
  };
}

function buildReplayLabel(replay, fallbackLabel) {
  const actionLabel = `${replay.actions.length} action${replay.actions.length === 1 ? "" : "s"}`;
  return `${fallbackLabel} | ${replay.scenario_id} | seed ${replay.seed} | ${actionLabel}`;
}

function describeReplayContainer(record, fallbackLabel) {
  const matchIndex = readFiniteNumber(record.match_index);
  const seed = readFiniteNumber(record.seed);
  const commanderLabels = readCommanderLabels(record.commander_labels);
  const winner = readString(record.winner);
  const pieces = [
    matchIndex === null ? null : `Match ${matchIndex}`,
    seed === null ? null : `seed ${seed}`,
    commanderLabels,
    winner ? `winner ${winner}` : null,
  ].filter(Boolean);
  return pieces.length ? pieces.join(" | ") : fallbackLabel;
}

function readCommanderLabels(value) {
  const labels = readCommanderLabelRecord(value);
  return labels ? `${labels.A} vs ${labels.B}` : null;
}

function readCommanderLabelRecord(value) {
  if (!value || typeof value !== "object") {
    return null;
  }
  const armyA = readString(value.A);
  const armyB = readString(value.B);
  return armyA && armyB ? { A: armyA, B: armyB } : null;
}

function readString(value) {
  return typeof value === "string" && value.trim() ? value : null;
}

function readArmyId(value) {
  return value === "A" || value === "B" ? value : undefined;
}

function readFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function readValue(argv, index, flag) {
  const value = argv[index];
  if (!value || value.startsWith("--")) {
    throw new Error(`Missing value for ${flag}.`);
  }
  return value;
}

function readInteger(argv, index, flag) {
  const value = Number.parseInt(readValue(argv, index, flag), 10);
  if (!Number.isInteger(value)) {
    throw new Error(`${flag} must be an integer.`);
  }
  return value;
}

function readPositiveInteger(argv, index, flag) {
  const value = readInteger(argv, index, flag);
  if (value <= 0) {
    throw new Error(`${flag} must be greater than 0.`);
  }
  return value;
}

function readPositiveNumber(argv, index, flag) {
  const value = Number.parseFloat(readValue(argv, index, flag));
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${flag} must be a positive number.`);
  }
  return value;
}

function readNonNegativeInteger(argv, index, flag) {
  const value = readInteger(argv, index, flag);
  if (value < 0) {
    throw new Error(`${flag} must be 0 or greater.`);
  }
  return value;
}

async function runChecked(command, args, options) {
  await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      ...options,
      stdio: "inherit",
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${path.basename(command)} exited with code ${code ?? "unknown"}.`));
    });
  });
}

async function findOpenPort(startPort) {
  for (let port = startPort; port < startPort + 100; port += 1) {
    if (await canListen(port)) {
      return port;
    }
  }
  throw new Error(`Could not find an open local port starting at ${startPort}.`);
}

function canListen(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once("error", () => resolve(false));
    server.once("listening", () => {
      server.close(() => resolve(true));
    });
    server.listen(port, "127.0.0.1");
  });
}

async function startVite(port, verbose) {
  const viteBin = path.join(projectRoot, "node_modules", "vite", "bin", "vite.js");
  await access(viteBin, fsConstants.F_OK);

  const child = spawn(process.execPath, [viteBin, "--host", "127.0.0.1", "--port", String(port), "--strictPort"], {
    cwd: projectRoot,
    stdio: verbose ? ["ignore", "pipe", "pipe"] : "ignore",
  });
  if (verbose) {
    child.stdout.on("data", (chunk) => process.stderr.write(chunk));
    child.stderr.on("data", (chunk) => process.stderr.write(chunk));
  }
  child.on("exit", (code) => {
    if (code !== null && code !== 0) {
      process.stderr.write(`Vite exited with code ${code}.\n`);
    }
  });

  await waitForHttp(`http://127.0.0.1:${port}/`, 30000);
  return child;
}

async function waitForHttp(url, timeoutMs) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        return;
      }
    } catch {
      // Vite is still starting.
    }
    await waitForDelay(200);
  }
  throw new Error(`Timed out waiting for ${url}.`);
}

function stopChild(child) {
  if (!child.killed) {
    child.kill();
  }
}

async function importPlaywright() {
  try {
    return await import("playwright");
  } catch (error) {
    throw new Error(
      `Playwright is required for replay video generation. Run npm install in ${projectRoot} and then npx playwright install chromium.`,
      { cause: error },
    );
  }
}

function augmentPlaywrightError(error) {
  if (!(error instanceof Error)) {
    return error;
  }
  if (error.message.includes("Executable doesn't exist") || error.message.includes("browserType.launch")) {
    return new Error(`${error.message}\n\nInstall the Chromium browser with: npx playwright install chromium`);
  }
  return error;
}

function resolveOutputPath(output, suggestedFilename) {
  const outputPath = path.resolve(process.cwd(), output);
  if (path.extname(outputPath)) {
    return outputPath;
  }
  const suggestedExtension = path.extname(suggestedFilename) || ".webm";
  return `${outputPath}${suggestedExtension}`;
}

function createDeferred() {
  let resolve;
  let reject;
  const promise = new Promise((innerResolve, innerReject) => {
    resolve = innerResolve;
    reject = innerReject;
  });
  return { promise, resolve, reject };
}

function waitForDelay(durationMs) {
  return new Promise((resolve) => {
    setTimeout(resolve, durationMs);
  });
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
