from __future__ import annotations

from pathlib import Path
from shutil import copy2

from hatchling.builders.hooks.plugin.interface import BuildHookInterface


class CanonicalDataBuildHook(BuildHookInterface):
    PLUGIN_NAME = "canonical-data"

    def initialize(self, version: str, build_data: dict[str, object]) -> None:
        root = Path(self.root)
        package_dir = root / "src" / "backend"
        self._copied_paths: list[Path] = []

        self._copy_game_rules(root, package_dir)
        self._copy_ai_system_prompt_template(root, package_dir)
        self._copy_provider_catalog(root, package_dir)

    def finalize(self, version: str, build_data: dict[str, object], artifact_path: str) -> None:
        for path in reversed(getattr(self, "_copied_paths", [])):
            try:
                path.unlink()
            except FileNotFoundError:
                pass

    def _copy_game_rules(self, root: Path, package_dir: Path) -> None:
        destination = package_dir / "game_rules.md"
        source = self._first_existing(
            [
                root.parent / "game_rules.md",
                destination,
            ],
            "game_rules.md",
        )
        self._copy_build_file(source, destination)

    def _copy_ai_system_prompt_template(self, root: Path, package_dir: Path) -> None:
        destination = package_dir / "aiSystemPrompt.txt"
        source = self._first_existing(
            [
                root.parent / "shared" / "aiSystemPrompt.txt",
                destination,
            ],
            "aiSystemPrompt.txt",
        )
        self._copy_build_file(source, destination)

    def _copy_provider_catalog(self, root: Path, package_dir: Path) -> None:
        destination = package_dir / "aiProviderCatalog.json"
        source = self._first_existing(
            [
                root.parent / "shared" / "aiProviderCatalog.json",
                destination,
            ],
            "aiProviderCatalog.json",
        )
        self._copy_build_file(source, destination)

    def _copy_build_file(self, source: Path, destination: Path) -> None:
        if source.resolve() == destination.resolve():
            return
        destination.parent.mkdir(parents=True, exist_ok=True)
        copy2(source, destination)
        self._copied_paths.append(destination)

    @staticmethod
    def _first_existing(candidates: list[Path], label: str) -> Path:
        for candidate in candidates:
            if candidate.is_file():
                return candidate
        raise FileNotFoundError(f"Unable to find canonical {label} for backend build.")


def get_build_hook():
    return CanonicalDataBuildHook
