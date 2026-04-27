from __future__ import annotations

import atexit
import json
import os
import subprocess
import threading
from collections import deque
from pathlib import Path
from typing import Any

from pydantic import TypeAdapter

from ..models import Action, CreateGameRequest, GameSnapshot, ReplayData, ScenarioSummary

REPO_ROOT = Path(__file__).resolve().parents[4]
WINDOWS_DEV_ENV_PATH = REPO_ROOT / "windows-dev-env.bat"
ENGINE_CLI_PATH_ENV = "PHALANX_ENGINE_CLI_PATH"
ENGINE_CLI_BINARY_NAME = "engine-cli.exe" if os.name == "nt" else "engine-cli"


class NativeEngineUnavailable(RuntimeError):
    pass


class _RustEngineProcess:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._stderr_lines: deque[str] = deque(maxlen=200)
        self._process = self._spawn_process()
        self._stderr_thread = threading.Thread(target=self._drain_stderr, daemon=True)
        self._stderr_thread.start()
        atexit.register(self.close)
        try:
            self.request({"command": "ping"})
        except Exception:
            self.close()
            raise

    def request(self, payload: dict[str, Any]) -> Any:
        message = json.dumps(payload, separators=(",", ":"), ensure_ascii=True)
        with self._lock:
            process = self._process
            if process.stdin is None or process.stdout is None:
                raise NativeEngineUnavailable("Rust engine process is missing stdio pipes.")
            if process.poll() is not None:
                raise NativeEngineUnavailable(self._build_failure_message("Rust engine process exited unexpectedly."))
            try:
                process.stdin.write(message + "\n")
                process.stdin.flush()
            except (BrokenPipeError, OSError) as error:
                raise NativeEngineUnavailable(
                    self._build_failure_message("Failed to send a request to the Rust engine process.")
                ) from error

            response_line = process.stdout.readline()
            if not response_line:
                raise NativeEngineUnavailable(
                    self._build_failure_message("Rust engine process closed before returning a response.")
                )

        try:
            response = json.loads(response_line)
        except json.JSONDecodeError as error:
            raise NativeEngineUnavailable(
                self._build_failure_message(f"Rust engine returned invalid JSON: {response_line.strip()!r}")
            ) from error

        if not isinstance(response, dict):
            raise NativeEngineUnavailable(
                self._build_failure_message("Rust engine returned a non-object response payload.")
            )
        if response.get("ok") is True:
            return response.get("result")
        error_message = response.get("error")
        if isinstance(error_message, str) and error_message:
            raise ValueError(error_message)
        raise NativeEngineUnavailable(self._build_failure_message("Rust engine returned an error without details."))

    def close(self) -> None:
        process = getattr(self, "_process", None)
        if process is None or process.poll() is not None:
            return
        try:
            if process.stdin is not None:
                process.stdin.close()
        except OSError:
            pass
        process.terminate()
        try:
            process.wait(timeout=2)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait(timeout=2)

    def __del__(self) -> None:
        try:
            self.close()
        except Exception:
            pass

    def _spawn_process(self) -> subprocess.Popen[str]:
        explicit_path = os.environ.get(ENGINE_CLI_PATH_ENV, "").strip()
        if explicit_path:
            return self._popen([explicit_path, "--stdio"], cwd=Path(explicit_path).resolve().parent)

        release_binary_path = REPO_ROOT / "target" / "release" / ENGINE_CLI_BINARY_NAME
        if release_binary_path.exists() and not self._engine_binary_is_stale(release_binary_path):
            return self._popen([str(release_binary_path), "--stdio"], cwd=REPO_ROOT)

        debug_binary_path = REPO_ROOT / "target" / "debug" / ENGINE_CLI_BINARY_NAME
        if not debug_binary_path.exists() or self._engine_binary_is_stale(debug_binary_path):
            self._build_debug_binary()
        if debug_binary_path.exists():
            return self._popen([str(debug_binary_path), "--stdio"], cwd=REPO_ROOT)
        raise NativeEngineUnavailable("Rust engine binary was not produced after building engine-cli.")

    def _engine_binary_is_stale(self, binary_path: Path) -> bool:
        try:
            binary_mtime = binary_path.stat().st_mtime
        except OSError:
            return True

        source_roots = [
            REPO_ROOT / "Cargo.toml",
            REPO_ROOT / "engine" / "engine-cli",
            REPO_ROOT / "engine" / "engine-core",
        ]
        for root in source_roots:
            paths = [root] if root.is_file() else root.rglob("*")
            for path in paths:
                if not path.is_file() or path.suffix not in {".rs", ".toml", ".json"}:
                    continue
                try:
                    if path.stat().st_mtime > binary_mtime:
                        return True
                except OSError:
                    return True
        return False

    def _build_debug_binary(self) -> None:
        if os.name == "nt" and WINDOWS_DEV_ENV_PATH.exists():
            command = [
                "cmd.exe",
                "/d",
                "/s",
                "/c",
                f'call "{WINDOWS_DEV_ENV_PATH}" >nul 2>nul && cargo build -p engine-cli',
            ]
        else:
            command = ["cargo", "build", "-p", "engine-cli"]
        try:
            completed = subprocess.run(
                command,
                cwd=str(REPO_ROOT),
                capture_output=True,
                text=True,
                encoding="utf-8",
                check=False,
            )
        except OSError as error:
            raise NativeEngineUnavailable(f"Failed to build the Rust engine binary: {error}") from error
        if completed.returncode == 0:
            return
        stderr_output = (completed.stderr or "").strip()
        stdout_output = (completed.stdout or "").strip()
        details = stderr_output or stdout_output or "cargo build returned a non-zero exit code."
        raise NativeEngineUnavailable(f"Failed to build engine-cli.\n{details}")

    def _popen(self, command: list[str], *, cwd: Path) -> subprocess.Popen[str]:
        try:
            return subprocess.Popen(
                command,
                cwd=str(cwd),
                stdin=subprocess.PIPE,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                encoding="utf-8",
                bufsize=1,
            )
        except OSError as error:
            raise NativeEngineUnavailable(f"Failed to start the Rust engine process: {error}") from error

    def _drain_stderr(self) -> None:
        process = self._process
        if process.stderr is None:
            return
        for line in process.stderr:
            self._stderr_lines.append(line.rstrip())

    def _build_failure_message(self, prefix: str) -> str:
        process = self._process
        suffix: list[str] = []
        if process.poll() is not None:
            suffix.append(f"exit code {process.returncode}")
        stderr_output = self._stderr_snapshot()
        if stderr_output:
            suffix.append(f"stderr:\n{stderr_output}")
        return f"{prefix} {' | '.join(suffix)}".strip()

    def _stderr_snapshot(self) -> str:
        return "\n".join(line for line in self._stderr_lines if line).strip()


class NativeRuntimeAdapter:
    def __init__(self, runtime: _RustEngineProcess) -> None:
        self._runtime = runtime
        self._games: dict[str, object] = {}

    def list_scenarios(self) -> list[ScenarioSummary]:
        payload = self._runtime.request({"command": "list_scenarios"})
        return [ScenarioSummary.model_validate(item) for item in self._expect_list(payload)]

    def rules_metadata(self) -> dict[str, object]:
        payload = self._runtime.request({"command": "rules_metadata"})
        if isinstance(payload, dict):
            return payload
        raise NativeEngineUnavailable("Rust engine returned a non-object rules metadata payload.")

    def create_game(self, request: CreateGameRequest) -> GameSnapshot:
        return self._snapshot_from_runtime(
            {"command": "create_game", "request": request.model_dump(mode="json")}
        )

    def create_from_replay(self, replay: ReplayData) -> GameSnapshot:
        return self._snapshot_from_runtime(
            {"command": "create_from_replay", "replay": replay.model_dump(mode="json")}
        )

    def clone_game(self, game_id: str) -> GameSnapshot:
        return self._snapshot_from_runtime({"command": "clone_game", "game_id": game_id})

    def snapshot(self, game_id: str) -> GameSnapshot:
        return self._snapshot_from_runtime({"command": "snapshot", "game_id": game_id})

    def apply(self, game_id: str, action: Action) -> GameSnapshot:
        return self._snapshot_from_runtime(
            {"command": "apply", "game_id": game_id, "action": action.model_dump(mode="json")}
        )

    def apply_legal_action_index(self, game_id: str, index: int) -> GameSnapshot:
        return self._snapshot_from_runtime(
            {"command": "apply_legal_action_index", "game_id": game_id, "index": index}
        )

    def undo(self, game_id: str) -> GameSnapshot:
        return self._snapshot_from_runtime({"command": "undo", "game_id": game_id})

    def drop_game(self, game_id: str) -> None:
        try:
            self._runtime.request({"command": "drop_game", "game_id": game_id})
        except ValueError as error:
            self._raise_runtime_error(error)
        self._games.pop(game_id, None)

    def replay(self, game_id: str) -> ReplayData:
        try:
            payload = self._runtime.request({"command": "replay", "game_id": game_id})
        except ValueError as error:
            self._raise_runtime_error(error)
        return ReplayData.model_validate(payload)

    def get(self, game_id: str):
        return self.snapshot(game_id).state

    def build_action_catalog(self, legal_actions):
        payload = self._runtime.request(
            {
                "command": "build_action_catalog",
                "legal_actions": [action.model_dump(mode="json") for action in legal_actions],
            }
        )
        return self._expect_list(payload)

    def build_user_prompt(self, snapshot, request, action_catalog, action_history=None, prompt_profile: str | None = None):
        payload = self._runtime.request(
            {
                "command": "build_user_prompt",
                "snapshot": snapshot.model_dump(mode="json"),
                "request": request.model_dump(mode="json"),
                "action_catalog": action_catalog,
                "action_history": [action.model_dump(mode="json") for action in (action_history or [])],
                "prompt_profile": prompt_profile,
            }
        )
        if not isinstance(payload, str):
            raise NativeEngineUnavailable("Rust engine returned a non-string prompt payload.")
        return payload

    def describe_legal_action(self, action):
        payload = self._runtime.request(
            {"command": "describe_legal_action", "action": action.model_dump(mode="json")}
        )
        if not isinstance(payload, str):
            raise NativeEngineUnavailable("Rust engine returned a non-string action description.")
        return payload

    def legal_action_to_action(self, action):
        payload = self._runtime.request(
            {"command": "legal_action_to_action", "action": action.model_dump(mode="json")}
        )
        return ACTION_ADAPTER.validate_python(payload)

    def _snapshot_from_runtime(self, payload: dict[str, Any]) -> GameSnapshot:
        try:
            snapshot_payload = self._runtime.request(payload)
        except ValueError as error:
            self._raise_runtime_error(error)
        snapshot = GameSnapshot.model_validate(snapshot_payload)
        self._games[snapshot.state.game_id] = snapshot.state
        return snapshot

    def close(self) -> None:
        self._runtime.close()

    def __del__(self) -> None:
        try:
            self.close()
        except Exception:
            pass

    @staticmethod
    def _expect_list(payload: Any) -> list[Any]:
        if isinstance(payload, list):
            return payload
        raise NativeEngineUnavailable("Rust engine returned a non-list payload.")

    @staticmethod
    def _raise_runtime_error(error: ValueError) -> None:
        message = str(error)
        if message.startswith("Unknown game id:"):
            raise KeyError(message) from error
        raise ValueError(message) from error


def create_native_runtime() -> NativeRuntimeAdapter:
    return NativeRuntimeAdapter(_RustEngineProcess())


ACTION_ADAPTER = TypeAdapter(Action)
