# stage-two-like compaction architecture (300 lines)

Implementation-level map for `skills/compact-transcript`, `scripts/compact-transcript.py`, and `cmd/compact-transcript/`. Targets: stronger automatic context, self-question quality, conversation-end detection. No product `/summarize` API.

---

## 1. Three-layer model

| Layer | Entry | Role |
|-------|--------|------|
| L1 Skill | `skills/compact-transcript/SKILL.md` | When/how; 8-section template; self-questions; mirror CLI defaults (`--last 8`, auto `until`) |
| L2 Root script | `scripts/compact-transcript.py` | stdin paste → wrap `Stage 2` delimiters → `latest-summary.md` (no JSONL parse) |
| L3 Daemon | `compact-transcript` → `cmd/compact-transcript/main.go` | Resolve agent, `--until`/`--last`, tail ceremony, slice transcript, log `Auto range:` |

**Data:** `~/.cursor/projects/<slug>/agent-transcripts/*.jsonl`  
**Out:** `agent-transcript-summaries/<timestamp>-<last>.md`, `latest-summary.md`

```
┌─────────────┐     ┌──────────────────┐     ┌─────────────────────┐
│ SKILL.md    │────▶│ daemon (socket)  │────▶│ agent-transcripts   │
│ self-Q +    │     │ tail / flags     │     │ JSONL slice         │
│ template    │     └────────┬─────────┘     └──────────┬──────────┘
└─────────────┘              │                          │
       ▲                     ▼                          │
       │              model writes 8 sections ◀──────────┘
       │                     │
┌──────┴──────┐              ▼
│ compact-    │     agent-transcript-summaries/
│ transcript  │     (no "re-run compact" in body)
│ .py (stdin) │
└─────────────┘
```

---

## 2. End-to-end sequences

### 2.1 Skill / daemon (default, no range flags)

1. User or rule invokes `compact-transcript` (optional `--agent`, `--format fixed`).
2. Daemon picks agent: explicit id → env → newest transcript by mtime.
3. If `--until` empty: `resolveAutoUntil(path)` scans tail (see §4).
4. If `--last` empty: `defaultLast = 8`.
5. Load messages ≤ `until`, take last N turns; emit paths + range to model/logs.
6. Model runs self-question protocol (§6); writes file; short chat reply with path.

### 2.2 Clipboard script

1. stdin = user paste (maybe partial).
2. Script wraps:

```text
─── Stage 2 transcript compacted ───
<first non-empty line>
…
─── Stage 2 transcript compacted ───
```

3. Write `agent-transcript-summaries/latest-summary.md` only (no `until` inference in Python).

### 2.3 Explicit override

`compact-transcript --until 2026-03-17T10:00:00Z --last 12` → `source=flags`; skip tail for `until` (still validate file exists).

---

## 3. Strong automatic context

### 3.1 Fallback chain

```text
user --until/--last
  → compaction ceremony in transcript tail (§4)
  → pre_compact / structured block if present in JSONL (optional seed)
  → fallback: last 8 msgs to newest assistant line; until = that message time or file mtime
```

### 3.2 Session binding

- Prefer transcript for **current** agent when id known (daemon socket context, last message metadata).
- Skill: use paths from daemon output; do not invent UUIDs.

### 3.3 pre_compact

If export contains a pre-compaction summary segment: merge into `## Context` / `## Conversation arc`; do not duplicate verbatim. If absent (typical), proceed without error. Log `source=pre_compact` only when parser actually found it.

### 3.4 What we do not rely on

- H1 headers in every export.
- Dedicated `pre_compact` row type in all on-disk JSONL versions.
- Full-file read of multi-GB transcripts.

---

## 4. Conversation-end / ceremony detection

**Where:** `resolveAutoUntil` in `cmd/compact-transcript/main.go` (and skill docs).

**Budget:** last **400 lines** OR **2 MB** from EOF (whichever limit hits first).

**Marker table (line substring / pattern):**

| Marker | Notes |
|--------|--------|
| `─── Stage 2 transcript compacted ───` | Primary opener/closer (script uses same) |
| `Stage 2` | Prefer lines with delimiters/metadata; guard user prose false positives |
| `Conversation compacted` | UI variant |
| `…` (U+2026 ellipsis) | Optional weak signal with other cues |

**Derive:**

- `until`: ISO timestamp of compaction line or last assistant turn before marker.
- `last`: default **8** (future: `COMPACT_TRANSCRIPT_DEFAULT_LAST`).

**Log line (required for support):**

```text
Auto range: until=2026-03-17T10:45:12Z last=8 source=transcript-tail
```

`sources`: `flags` | `transcript-tail` | `pre_compact` | `fallback`.

---

## 5. CLI and env surface

| Flag / env | Default | Behavior |
|------------|---------|----------|
| `--until` | auto | RFC3339-ish end of slice |
| `--last` | `8` | Message/turn count |
| `--agent` | newest | Transcript basename |
| `--format` | `fixed` | `fixed` = prose template; `json` = machine metadata only |
| `COMPACT_TRANSCRIPT_SOCK` | platform default | Unix socket for daemon |
| `COMPACT_TRANSCRIPT_DEFAULT_LAST` | (future) | Override 8 |
| `COMPACT_TRANSCRIPT_TAIL_BYTES` | (future) | Override 2MB tail |

**JSON output shape (tooling):** `{ "until", "last", "agent_id", "paths", "source" }` — not a substitute for 8-section prose.

---

## 6. Self-question protocol (quality gate)

Answer internally before writing markdown; do not dump full Q&A to user.

| # | Question | Section |
|---|----------|---------|
| 1 | Single primary goal? | Context |
| 2 | User constraints (scope, no-deploy, licenses)? | Context / Key decisions |
| 3 | Decisions vs discussion? | Key decisions |
| 4 | Exact paths, URLs, commands? | Key artifacts |
| 5 | Failures / interrupts? | Conversation arc / Still open |
| 6 | Open without closure? | Still open |
| 7 | Next agent’s first concrete step? | Suggested next steps |
| 8 | Rejected approaches? | Key decisions / arc |

**Reject:** theme-only summaries; dropped identifiers; “run compact-transcript again” loops.

---

## 7. Output template (stable headings)

File: `skills/compact-transcript/compact-transcript.md` (canonical). Headings fixed for grep/continuation:

```markdown
# Compact Transcript Summary

## Context
## Key decisions
## Key artifacts
## Conversation arc
## Still open
## Suggested next steps
## Auto range (if inferred)
- until: …
- last: …
- source: transcript-tail | flags | fallback | pre_compact

## Metadata
- Agent / transcript id
- Generated at (ISO)
```

Chat reply: path + one-line “continue from file”; optional single `#file:…` pointer.

---

## 8. Go implementation map (`cmd/compact-transcript/main.go`)

| Concern | Action |
|---------|--------|
| `defaultLast` | Keep `8`; wire env when added |
| `resolveAutoUntil` | Extend markers per §4; return `(time, source)` |
| Tail IO | Bounded read from EOF; share constants with docs (400 lines / 2MB) |
| `logResolvedRange` | Always log `source=` |
| Tests | Fixtures: ceremony present / absent / “Stage 2” in user text |
| `setup.ps1` / `setup.sh` | Install daemon binary; skill path unchanged |

**Second pass:** skill/doc alignment does not require Go changes; tail marker extensions are incremental in daemon.

---

## 9. Skill rules (non-bootstrap)

- Do **not** instruct future sessions to “run `compact-transcript` at start of every chat.”
- **Do** write durable state into `agent-transcript-summaries/*.md`.
- Defaults: empty `--until` and `--last` same as CLI (tail + 8).
- Triggers: user asks to compact/summarize; or rule after long task — not mandatory self-loop.

**Bad next step:** “Run compact-transcript again.”  
**Good next step:** “Paste log Y; confirm Z; then merge PR.”

---

## 10. Verification matrix

| Scenario | Expected |
|----------|----------|
| No args after Cursor compaction | `until` from ceremony, `last=8`, timestamped file + latest |
| `--until` + `--last` set | `source=flags` |
| No ceremony | `source=fallback`, last 8 |
| stdin → `compact-transcript.py` | Wrapped `latest-summary.md` only |
| Huge JSONL | Tail bounded; no full read |
| `--format json` | Metadata only; model still produces prose separately |
| Output body | No perpetual compact-transcript invocation |

---

## 11. Relation to repo docs

| Document | Role |
|----------|------|
| `skills/compact-transcript/architecture.md` | Second-pass narrative, mermaid, product alignment |
| **this file** | 300-line implementation map, sequences, tables |
| `architecture.md` (repo root) | Workspace layers; points here for compaction |
| `architecture-go.md` | Shared daemon patterns |
| `skills/compact-transcript/SKILL.md` | Operator procedure + “Before you write” checklist |
| `docs/commands/compact-transcript.md` | User-facing command help |

---

## 12. Non-goals

- Replacing Cursor `/summarize` or internal stage-two API.
- Long-term memory DB / vector store.
- Multi-repo transcript merge without explicit paths.
- Deploying transcript compaction as a remote service.

---

## 13. Example log + filename

```text
Auto range: until=2026-03-17T10:45:12Z last=8 source=transcript-tail
Wrote agent-transcript-summaries/20260317T104512Z-8.md
Updated agent-transcript-summaries/latest-summary.md
```

Skill invocation equivalent: `compact-transcript --last 8` with implicit `until` from tail.

---

*Line budget: implementation detail for stage-two-**like** behavior on disk + daemon + skill only.*
