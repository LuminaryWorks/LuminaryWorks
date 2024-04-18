# Source-signal detection checklist (full, pro-grade)

**Single-use checklist for `compact-transcript`.** Do **not** emit nested "run compact again" loops.

## What exists on disk

| Signal | Typical path | Notes |
|--------|----------------|-------|
| Agent transcripts | `agent-transcripts/*.jsonl` (active / newest UUID) | Primary |
| Served summary | `agent-transcript-summaries/latest-summary.md` | Optional seed only |
| **PreCompact** | `<<>>` before model-facing user text with `Continue from #file:…` | Strongest editorial seed |
| **Compact round** | `─── Stage 2 transcript compacted ───` + `[Context compacted]` | Usually suppressed in export |
| **Ceremony opener** | `─── Stage 2 transcript compacted ───` (script paste only) | CLI `--until` hint |
| **Conversation compacted** | UI line variants | Tail-scan hint |

**Do not assume:** `pre_compact` JSONL row, `#` H1 every export, full file read on multi-GB logs.

## Tail scan (default anchor when flags omitted)

- **Budget:** last **400 lines** or **2 MB** from EOF.
- **Order:** ceremony line → pre-compact `#file:` / Stage 2 opener → last assistant ISO.
- **Default `--last`:** `8` (override: `COMPACT_TRANSCRIPT_DEFAULT_LAST`).
- **Log:** `Auto range: until=… last=… source=transcript-tail|pre_compact|flags|fallback`.

## Optional / fallback inputs

- **Flags** `--until` / `--last` → `source=flags`
- **Stdin** paste wrapped by `scripts/compact-transcript.py`
- **Fallback:** newest assistant turn + `last=8`

## Parser output (`--format json`)

`{ "until", "last", "agent_id", "paths", "source" }`

## Quality gate (internal only)

Answer [self-question protocol](../architecture.md#self-question-protocol-quality-gate) before writing final markdown.

## Related docs

- [SKILL.md](../SKILL.md) — operator procedure
- [architecture.md](../architecture.md) — second-pass narrative
- [architecture-300.md](../architecture-300.md) — implementation map
- [output-template.md](../output-template.md) — stable headings
