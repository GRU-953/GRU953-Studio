---
name: dev-memory
description: The GRU953-Studio memory protocol for reading and updating Dev-Memory files so any project resumes exactly where it stopped. Use at session start, at every stage boundary, and before hand-off or publish.
---

# Dev-Memory protocol

## Purpose

Dev-Memory keeps a plain-text project record in `Dev-Memory/` so work can
resume without loss in a new session.

## Read order (on resume)

If `Dev-Memory/` exists, read in this order before doing new work:

1. `PROGRESS.md`
2. Tail of `SESSION-LOG.md`
3. `INDEX.md`

Use the `▶ RESUME HERE` pointer as the current restart point and report it
to the user first.

## Update rules

At every meaningful stage boundary:

1. Update `PROGRESS.md` with what is done, what is next, and `verified:` evidence.
2. Append a concise entry to `SESSION-LOG.md` describing decisions and outcomes.
3. Update `INDEX.md` so referenced files and decisions are easy to find.

Never mark an item complete without real verification evidence.

## Safety rules

- Keep memory factual and plain; no secrets or private keys.
- Do not delete historical entries; append updates instead.
- If work pauses, write enough context that another session can continue
  immediately from `▶ RESUME HERE`.
