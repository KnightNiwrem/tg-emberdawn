# Verification policy

Use checks that establish the requested change works. The final local requirements below apply
before committing or reporting completion; the documentation-only exception changes local
verification, not CI. The full workflow in [.github/workflows/ci.yml](../.github/workflows/ci.yml)
continues to run formatting, lint, type checking, the full test suite, and PostgreSQL tests on every
PR.

## Implementation and final verification

During implementation, run targeted checks that answer the current question. An affected test can
run on its own without triggering an immediate full-suite pass.

For code or mixed changes, complete one final pass of the four gates in
[AGENTS.md](../AGENTS.md#verification). Earlier successful results count when they still cover the
resulting change; a final pass does not require rerunning unchanged work just to repeat a command.
Persistence or schema behavior changes also require `deno task test:pg` against a confirmed
disposable database. Follow `emberdawn-persistence` for test targets and the local helper's resource
ownership; skipped PostgreSQL tests do not satisfy that requirement.

Later edits invalidate checks whose inputs or behavior they affect. Rerun those checks before
finishing. Passing a targeted regression test during development does not replace an outstanding
full test-suite gate. Changes to shared code, dependencies, or test configuration can invalidate
broad checks; a documentation follow-up need not repeat unaffected code checks.

Fix failures caused by the requested change and rerun affected checks. If a failure appears
unrelated, establish that from the baseline where practical and report it separately. Report failed,
blocked, or skipped requirements explicitly; they remain incomplete verification. Do not expand the
PR into unrelated repairs or claim all checks passed when they did not. Report local results and
pending or failed CI distinctly.

## Documentation-only local path

This path applies only when all changed files are Markdown documentation or agent instructions in
`AGENTS.md`, `README.md`, `docs/`, or `.agents/skills/`. It includes skill frontmatter and reference
edits. It excludes executable source (including prose edits in `.ts` files), authored gameplay data,
tests or fixtures, generated artifacts or snapshots, dependencies or lockfiles, and build,
deployment, or test configuration. A change containing any excluded work follows the
code/mixed-change gates. Classify the whole change, not just its most recent edit.

Run `deno task fmt:check` and the applicable existing documentation checks:

| Changed documentation                                                             | Existing check                                    |
| --------------------------------------------------------------------------------- | ------------------------------------------------- |
| `AGENTS.md`, skill Markdown under `.agents/skills/`, or `docs/narrative-guide.md` | `tests/agent_docs_test.ts`                        |
| `docs/world-topology.md`                                                          | The authoring-map check in `tests/routes_test.ts` |

From the repository root, run the applicable command or commands:

```bash
deno test --allow-import --allow-read tests/agent_docs_test.ts
deno test --allow-import --allow-read --filter='world topology: the authoring map' tests/routes_test.ts
```

If another changed document is covered by an existing test, run that check too. Documentation with
no automated check still requires reviewing the changed claims, examples, and links against their
sources. For changed instruction routes or decision boundaries, walk representative tasks through
the guidance. The agent-document tests validate structure and paths, not whether Astra selects the
right reference or interprets a policy correctly; do not add exact-wording tests as a substitute.

Under this path, unchanged local lint, project-wide type checking, and gameplay tests are not
required. Their CI jobs remain enabled. Changes to documentation that describe persistence do not by
themselves change persistence behavior or require a local PostgreSQL run.
