"""
acdd.core.doc_compiler
======================

Translates a validated :class:`CapabilityManifest` into pristine, scannable
Markdown documentation.

Two rendering paths exist:

* **LLM path** — a strict system prompt drives a local model to produce polished
  prose. The output is sanitised to strip any conversational wrapper or code
  fences the model may add.
* **Deterministic fallback** — if no LLM client is configured or the call fails,
  a fully-formed template is rendered from the manifest directly. This keeps the
  pipeline operational offline and guarantees the git worker always has content.

Both paths emit the same structural skeleton: a metadata callout, horizontal
rules (``---``), parameter tables, and an explicit security-guardrail block.
"""

from __future__ import annotations

import logging
from typing import Final

from .config import AcddConfig, get_config
from .llm import LLMClient, LLMError
from .schema import CapabilityCategory, CapabilityManifest, validate_manifest

logger = logging.getLogger("acdd.doc_compiler")

__all__ = ["SYSTEM_PROMPT", "CATEGORY_EMOJI", "DocCompiler"]


SYSTEM_PROMPT: Final[str] = """\
You are Oddjob's internal Technical Writer Agent. Your sole job is to translate a
structured JSON Capability Manifest into clean, beautifully formatted GitHub
Flavored Markdown documentation for an engineering audience.

Adhere strictly to these layout constraints:
- Begin immediately with a level-1 heading: `# <emoji> <display_name>`.
- Directly under the title, render a blockquote metadata callout with the
  capability id, category, owner, risk profile and execution environment.
- Separate every major section with a horizontal rule (`---`).
- Render all inputs and outputs as GitHub Markdown tables with the columns
  `Name` and `Type`.
- Render every guardrail as a `> [!WARNING]` callout block. If there are no
  guardrails, state "No explicit guardrails declared." in a `> [!NOTE]` block.
- Render business use cases as a bulleted list.
- Use clear, professional language. Do not invent fields that are not present.

Output rules:
- Return ONLY raw Markdown. No code fences around the whole document.
- Do NOT include any conversational meta-text, preamble, or trailing
  pleasantries (no "Here is", no "Let me know", no sign-off).
"""


CATEGORY_EMOJI: Final[dict[CapabilityCategory, str]] = {
    CapabilityCategory.DATA_OPERATIONS: "🗄️",
    CapabilityCategory.BROWSER_AUTOMATION: "🌐",
    CapabilityCategory.FINANCIAL_OPERATIONS: "💳",
    CapabilityCategory.SAAS_CONNECTORS: "🔌",
    CapabilityCategory.SYSTEM_UTILITIES: "🛠️",
    CapabilityCategory.KNOWLEDGE: "📚",
    CapabilityCategory.CUSTOM_JIT: "⚡",
}


class DocCompiler:
    """Compiles capability manifests to Markdown, LLM-first with a safe fallback."""

    def __init__(self, llm_client: LLMClient | None = None, config: AcddConfig | None = None) -> None:
        self._llm = llm_client
        self._config = config or get_config()

    # ------------------------------------------------------------------
    def compile(self, manifest: CapabilityManifest | dict) -> str:
        """Return Markdown documentation for ``manifest``.

        Never raises for LLM problems — it degrades to the deterministic
        renderer so the surrounding git pipeline can always proceed.
        """
        model = validate_manifest(manifest)

        if self._llm is not None:
            try:
                raw = self._llm.generate(
                    prompt=self._build_user_prompt(model), system=SYSTEM_PROMPT, temperature=0.2
                )
                cleaned = self._sanitize(raw)
                if cleaned:
                    return cleaned
                logger.warning(
                    "LLM produced empty doc for %s; using deterministic fallback.",
                    model.capability_id,
                )
            except LLMError as exc:
                logger.warning(
                    "LLM doc compilation failed for %s (%s); using deterministic fallback.",
                    model.capability_id,
                    exc,
                )
            except Exception:  # noqa: BLE001 - never let doc-gen crash the pipeline
                logger.exception("Unexpected error compiling doc for %s.", model.capability_id)

        return self._render_fallback(model)

    # ------------------------------------------------------------------
    @staticmethod
    def _build_user_prompt(manifest: CapabilityManifest) -> str:
        return "Capability Manifest (JSON):\n\n" + manifest.to_json()

    @staticmethod
    def _sanitize(raw: str) -> str:
        """Strip code-fence wrappers and any leading conversational chatter."""
        text = raw.strip()

        # Remove a single wrapping code fence (```markdown ... ``` or ``` ... ```).
        if text.startswith("```"):
            lines = text.splitlines()
            if lines:
                lines = lines[1:]  # drop opening fence
            if lines and lines[-1].strip().startswith("```"):
                lines = lines[:-1]  # drop closing fence
            text = "\n".join(lines).strip()

        # If the model prepended chatter before the first heading, cut to it.
        if not text.startswith("#"):
            index = text.find("\n# ")
            if index != -1:
                text = text[index + 1 :].strip()

        return text

    # ------------------------------------------------------------------
    def _render_fallback(self, manifest: CapabilityManifest) -> str:
        """Deterministically render Markdown without an LLM."""
        emoji = CATEGORY_EMOJI.get(manifest.metadata.category, "🧩")
        meta = manifest.metadata
        doc = manifest.documentation_meta
        runtime = manifest.runtime_context
        spec = manifest.technical_spec

        parts: list[str] = []
        parts.append(f"# {emoji} {meta.display_name}")
        parts.append("")
        parts.append(
            "> **Capability ID:** `{id}`  \n"
            "> **Category:** {category}  \n"
            "> **Owner:** {owner}  \n"
            "> **Risk Profile:** {risk}  \n"
            "> **Execution Environment:** {env}".format(
                id=manifest.capability_id,
                category=meta.category.value,
                owner=meta.owner,
                risk=runtime.risk_profile.value,
                env=runtime.execution_environment.value,
            )
        )
        parts.append("")
        parts.append("---")
        parts.append("")
        parts.append("## Overview")
        parts.append("")
        parts.append(meta.description)
        if doc.summary:
            parts.append("")
            parts.append(doc.summary)
        parts.append("")
        parts.append("---")
        parts.append("")
        parts.append("## Inputs")
        parts.append("")
        parts.append(self._render_table(spec.inputs))
        parts.append("")
        parts.append("## Outputs")
        parts.append("")
        parts.append(self._render_table(spec.outputs))
        parts.append("")
        parts.append("---")
        parts.append("")
        parts.append("## Business Use Cases")
        parts.append("")
        if doc.business_use_cases:
            parts.extend(f"- {case}" for case in doc.business_use_cases)
        else:
            parts.append("_No business use cases documented._")
        parts.append("")
        parts.append("---")
        parts.append("")
        parts.append("## Security Guardrails")
        parts.append("")
        if doc.guardrails:
            for guardrail in doc.guardrails:
                parts.append(f"> [!WARNING]")
                parts.append(f"> {guardrail}")
                parts.append("")
        else:
            parts.append("> [!NOTE]")
            parts.append("> No explicit guardrails declared.")
            parts.append("")
        if runtime.dependencies:
            parts.append("---")
            parts.append("")
            parts.append("## Dependencies")
            parts.append("")
            parts.extend(f"- `{dependency}`" for dependency in runtime.dependencies)
            parts.append("")

        return "\n".join(parts).rstrip() + "\n"

    @staticmethod
    def _render_table(fields: dict[str, str]) -> str:
        if not fields:
            return "_None._"
        rows = ["| Name | Type |", "| --- | --- |"]
        for name, type_str in fields.items():
            safe_type = type_str.replace("|", "\\|")
            rows.append(f"| `{name}` | `{safe_type}` |")
        return "\n".join(rows)
