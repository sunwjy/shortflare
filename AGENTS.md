## Agent skills

### Issue tracker

Issues are tracked in GitHub Issues for `sunwjy/shortflare`. See `docs/agents/issue-tracker.md`.

### Triage labels

Use the default five-role triage label vocabulary. See `docs/agents/triage-labels.md`.

### Domain docs

This repository uses the single-context layout. See `docs/agents/domain.md`.

## Code quality contract

Optimize for future agents first, then people.

### Comments

- Comment decisions, invariants, failure modes, ordering, security, and
  non-obvious platform constraints—not syntax.
- Document important seams: guarantees, errors, side effects, and ordering.
- Add ADR/domain pointers where a locally reasonable change could be globally
  wrong. Update or delete stale comments with the code.
- In tests, explain only non-obvious fixtures, sequencing, and regressions.

### Architecture

- Dependencies point inward. Domain modules must not import frameworks, D1,
  HTTP/cookies, or transport DTOs.
- Entrypoints only compose modules and adapters; keep policy, validation, SQL,
  and route implementations elsewhere.
- Prefer deep modules with small interfaces. Add a seam only for real variation,
  not pass-through indirection.
- Group by capability and reason to change. Inject dependencies; keep effects in
  adapters and domain/application behavior result-based.
- Treat 400 production lines as a review trigger. Split mixed responsibilities,
  not cohesive implementations.
- Avoid circular imports, leaked internals, boolean control flags, duplicated
  policy, hidden globals, and speculative interfaces.
- Test through module interfaces, not private helpers.

### Lint and type safety

- Fix lint causes. Inline disables are last resort: one rule, one line, and a
  `--` reason. Never use file-wide or multi-rule disables.
- Configure a systematically unsuitable rule once instead of scattering
  disables.
- Never use `@ts-ignore`, `any`, or double casts to bypass types.
  `@ts-expect-error` is only for explained type tests.
- Validate and narrow unknown input. Handle or safely report rejected promises
  and unexpected errors.

### APIs and verification

- Do not use deprecated APIs. Check current Context7 docs and installed types;
  require an ADR when no replacement exists.
- Run focused tests while iterating and `pnpm check` before completion.
- Behavior changes need interface-level regression tests; refactors keep existing
  tests green.
- Never claim completion with failing checks. Report blocked checks and run all
  independent ones.
