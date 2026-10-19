"""
acdd.core.git_worker
====================

Programmatic Git orchestrator for compiled capability documentation.

Writes ``docs/capabilities/<capability_id>.md`` and then applies a
**risk-based branching strategy**:

* **Low / Medium** — commit on the configured docs branch and (optionally) push.
* **High / Critical** — isolate to an ``audit/capability-<id>`` branch, push it,
  and fire a review hook. These changes are never auto-merged.

Implementation notes:
- Uses ``subprocess`` with explicit argument lists (never ``shell=True``) so
  LLM/user-derived strings can never be interpreted as shell syntax.
- ``capability_id`` is validated against the manifest slug pattern before it is
  ever joined into a filesystem path, defeating path traversal.
- Pushing is best-effort: a missing remote or offline network degrades to a
  warning, not a failure — the commit is still made locally.
- The working branch is restored afterwards so the repo is left as it was found.
"""

from __future__ import annotations

import logging
import subprocess
from dataclasses import dataclass
from datetime import date
from pathlib import Path
from typing import Callable, Sequence

from .config import AcddConfig, get_config
from .schema import CAPABILITY_ID_PATTERN, RiskProfile

logger = logging.getLogger("acdd.git_worker")

__all__ = ["GitWorkerError", "CommitResult", "GitWorker"]

# Hook signature: (capability_id, branch_name) -> None
ReviewHook = Callable[[str, str], None]


class GitWorkerError(RuntimeError):
    """Raised for unrecoverable git/filesystem failures."""


@dataclass(frozen=True, slots=True)
class CommitResult:
    """Outcome of a documentation commit."""

    capability_id: str
    doc_path: str
    branch: str
    committed: bool
    pushed: bool
    requires_review: bool
    message: str


class GitWorker:
    """Writes capability docs to disk and commits them per risk policy."""

    def __init__(
        self,
        config: AcddConfig | None = None,
        *,
        review_hook: ReviewHook | None = None,
    ) -> None:
        self._config = config or get_config()
        self._review_hook = review_hook or self._default_review_hook

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------
    def doc_path(self, capability_id: str) -> Path:
        """Absolute, traversal-safe path for a capability's doc file."""
        self._require_valid_id(capability_id)
        target = (self._config.docs_dir / f"{capability_id}.md").resolve()
        docs_dir = self._config.docs_dir
        # Belt-and-suspenders: ensure the resolved path stays inside docs_dir.
        if docs_dir not in target.parents and target.parent != docs_dir:
            raise GitWorkerError(f"Refusing to write outside docs dir: {target}")
        return target

    def commit_capability_doc(
        self, capability_id: str, markdown: str, risk_profile: RiskProfile | str
    ) -> CommitResult:
        """Write and commit ``markdown`` for ``capability_id`` per its risk profile."""
        self._require_valid_id(capability_id)
        risk = RiskProfile(risk_profile)
        repo = self._config.docs_repo_path
        self._require_git_repo(repo)

        target = self.doc_path(capability_id)
        try:
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text(markdown, encoding="utf-8")
        except OSError as exc:
            raise GitWorkerError(f"Failed to write {target}: {exc}") from exc

        rel_path = target.relative_to(repo).as_posix()
        original_branch = self._current_branch()

        if risk.requires_isolation:
            return self._commit_isolated(capability_id, rel_path, risk, original_branch)
        return self._commit_mainline(capability_id, rel_path, risk, original_branch)

    # ------------------------------------------------------------------
    # Commit strategies
    # ------------------------------------------------------------------
    def _commit_mainline(
        self, capability_id: str, rel_path: str, risk: RiskProfile, original_branch: str
    ) -> CommitResult:
        branch = self._config.git_docs_branch
        try:
            if original_branch != branch:
                self._checkout(branch, create_if_missing=True)
            committed = self._add_and_commit(
                rel_path, f"docs(auto): update capabilities matrix for {capability_id}"
            )
            pushed = self._maybe_push(branch) if committed else False
        finally:
            self._restore_branch(original_branch, branch)

        return CommitResult(
            capability_id=capability_id,
            doc_path=rel_path,
            branch=branch,
            committed=committed,
            pushed=pushed,
            requires_review=False,
            message=(
                f"Committed {rel_path} to {branch}." if committed else "No changes to commit."
            ),
        )

    def _commit_isolated(
        self, capability_id: str, rel_path: str, risk: RiskProfile, original_branch: str
    ) -> CommitResult:
        branch = f"audit/capability-{capability_id}"
        try:
            self._checkout(branch, create_if_missing=True)
            committed = self._add_and_commit(
                rel_path,
                f"security(audit): automated verification document draft for {capability_id}",
            )
            pushed = self._maybe_push(branch) if committed else False
        finally:
            self._restore_branch(original_branch, branch)

        # Signal a human reviewer regardless of push outcome.
        try:
            self._review_hook(capability_id, branch)
        except Exception:  # noqa: BLE001 - hook failure must not mask the commit
            logger.exception("Review hook failed for %s", capability_id)

        return CommitResult(
            capability_id=capability_id,
            doc_path=rel_path,
            branch=branch,
            committed=committed,
            pushed=pushed,
            requires_review=True,
            message=(
                f"Isolated {risk.value}-risk doc on {branch}; flagged for human review."
            ),
        )

    # ------------------------------------------------------------------
    # Git primitives
    # ------------------------------------------------------------------
    def _run_git(self, *args: str, check: bool = True) -> subprocess.CompletedProcess[str]:
        cmd: Sequence[str] = ["git", *args]
        try:
            result = subprocess.run(
                cmd,
                cwd=self._config.docs_repo_path,
                capture_output=True,
                text=True,
                check=False,
            )
        except (OSError, FileNotFoundError) as exc:
            raise GitWorkerError(f"Failed to execute git {' '.join(args)}: {exc}") from exc
        if check and result.returncode != 0:
            raise GitWorkerError(
                f"git {' '.join(args)} failed (exit {result.returncode}): "
                f"{result.stderr.strip() or result.stdout.strip()}"
            )
        return result

    def _add_and_commit(self, rel_path: str, message: str) -> bool:
        """Stage and commit ``rel_path``. Returns False if there was nothing to commit."""
        self._run_git("add", "--", rel_path)
        # Detect a no-op commit up front so it is not treated as an error.
        status = self._run_git("status", "--porcelain", "--", rel_path)
        if not status.stdout.strip():
            logger.info("No changes detected for %s; skipping commit.", rel_path)
            return False
        self._run_git(
            "-c",
            f"user.name={self._config.git_author_name}",
            "-c",
            f"user.email={self._config.git_author_email}",
            "commit",
            "-m",
            message,
            "--",
            rel_path,
        )
        return True

    def _maybe_push(self, branch: str) -> bool:
        if not self._config.git_auto_push:
            return False
        remotes = self._run_git("remote", check=False).stdout.split()
        if self._config.git_remote not in remotes:
            logger.warning(
                "Remote %r not configured; commit made locally only.", self._config.git_remote
            )
            return False
        result = self._run_git(
            "push", "--set-upstream", self._config.git_remote, branch, check=False
        )
        if result.returncode != 0:
            logger.warning("Push to %s/%s failed: %s", self._config.git_remote, branch, result.stderr.strip())
            return False
        return True

    def _current_branch(self) -> str:
        result = self._run_git("rev-parse", "--abbrev-ref", "HEAD", check=False)
        return result.stdout.strip() or "HEAD"

    def _branch_exists(self, branch: str) -> bool:
        result = self._run_git(
            "rev-parse", "--verify", "--quiet", f"refs/heads/{branch}", check=False
        )
        return result.returncode == 0

    def _checkout(self, branch: str, *, create_if_missing: bool = False) -> None:
        if self._branch_exists(branch):
            self._run_git("checkout", branch)
        elif create_if_missing:
            self._run_git("checkout", "-b", branch)
        else:
            raise GitWorkerError(f"Branch {branch} does not exist.")

    def _restore_branch(self, original_branch: str, working_branch: str) -> None:
        if original_branch and original_branch != working_branch and original_branch != "HEAD":
            try:
                self._checkout(original_branch)
            except GitWorkerError:
                logger.warning("Could not restore original branch %s.", original_branch)

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------
    @staticmethod
    def _require_valid_id(capability_id: str) -> None:
        if not CAPABILITY_ID_PATTERN.match(capability_id or ""):
            raise GitWorkerError(
                f"Invalid capability_id {capability_id!r}; refusing to build a file path from it."
            )

    @staticmethod
    def _require_git_repo(repo: Path) -> None:
        if not (repo / ".git").exists():
            raise GitWorkerError(
                f"{repo} is not a git repository (no .git). "
                "Point ACDD_DOCS_REPO_PATH at a git workspace."
            )

    @staticmethod
    def _default_review_hook(capability_id: str, branch: str) -> None:
        logger.warning(
            "[HUMAN REVIEW REQUIRED] capability=%s branch=%s — high/critical doc awaiting verification.",
            capability_id,
            branch,
        )
