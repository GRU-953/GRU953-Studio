---
name: lang-python
description: The Python ecosystem pack — the exact build, test, lint, format and dependency commands, plus the idioms, that the python-developer agent uses. Load when a task is implemented in Python. Covers pytest, ruff, black/ruff-format, mypy, and pip/requirements/pyproject dependency and licence norms.
---

# Python pack

The shared toolchain knowledge for Python work, so the `python-developer` agent
stays thin. Plain-English rule is as set in the `studio` skill.

## The five standard commands (used as acceptance-proving commands)

| Purpose | Command |
| :-- | :-- |
| build (env) | `python -m venv .venv && . .venv/bin/activate`; package with `python -m build` when a distributable is needed |
| test | `pytest -q` |
| lint | `ruff check .` (or `flake8`); optionally `mypy .` for typed code |
| format | `ruff format --check .` (or `black --check .`); apply without `--check` |
| deps | `pip install <pkg>`; record in `requirements.txt` or `pyproject.toml` (pin versions) |

## Idioms and gotchas

- Always work inside a virtual environment (`.venv`); never install into the
  system Python.
- Prefer the standard library first (the studio's zero-dependency instinct);
  every third-party package passes the `yagni-rules` ladder.
- Add type hints on public functions; keep functions small and pure where you
  can. Handle exceptions specifically, never a bare `except:`.
- Tests use `pytest`; a failing test written first fits the `tdd-workflow` skill.

## Dependencies & licences

- Dependencies are declared in `requirements.txt` or `pyproject.toml`, resolved
  into the venv.
- `hooks/licence-scan.mjs` inspects an installed venv (best-effort); a deeper
  pass uses `pip-licenses` when available. `security-compliance-auditor` runs
  the scan before Publish, and `pip-audit` covers known vulnerabilities.
