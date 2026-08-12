---
status: accepted
---

# Support macOS, Linux, and Windows on Node 22

The public CLI supports macOS, Linux, and Windows on Node.js `>=22.13.0`. Its
reconciliation core uses Node APIs and argument-array subprocess execution
rather than shell scripts or Unix-only commands. Platform adapters own standard
config and data locations, temporary files, atomic replacement, and the closest
available user-only permission semantics.

Pull requests and `main` run the full deterministic `pnpm check` on all three
operating systems. A Linux producer builds and verifies one exact npm tarball;
isolated Linux, macOS, and Windows consumers install that same artifact and run
the packed CLI smoke without workspace resolution. The public `--version` and
`-v` options print the installed package version, while help and version both
exit before authentication, file creation, or Cloudflare access. The real
Cloudflare release smoke runs once on Linux because the deployed control-plane
behavior is OS-independent. An unsupported Node version fails before those
effects as well.

CI may cache the pnpm content-addressable store by operating system and lockfile
for download efficiency. It never caches `node_modules`, build outputs, or the
candidate tarball, and every job runs `pnpm install --frozen-lockfile`; a cache
miss therefore has the same correctness contract as a hit.

CI assigns Wrangler's supported `WRANGLER_LOG_PATH` to a runner-temporary
directory instead of relying on a user-level log location. Logging remains
enabled for diagnosis, while help and version regression tests prove that
informational CLI commands do not start Wrangler.

The workflow sets `CI=true` for every job and always installs with
`pnpm install --frozen-lockfile`. It does not force installation or change the
repository-wide module-purge policy merely to suppress an interactive prompt;
clean jobs never restore `node_modules` in the first place.

The deploy package's verifier module owns real tarball creation and the exact
path allowlist, package and Release manifest version match, bundled artifact
digests, and tarball digest. Workflow YAML only orchestrates that interface and
artifact transfer; each consumer verifies the tarball digest again before its
isolated install and smoke.

Branch protection requires one stable `CI / Required` aggregate job rather than
matrix-generated check names. The aggregate runs even after failed or skipped
dependencies and succeeds only when the producer, every operating-system check,
and every packed consumer succeeded; matrix jobs do not fail fast.

The deterministic required checks live in a dedicated CI workflow. The
Security workflow retains registry-state-dependent advisory auditing as a
separate signal, rather than making a live advisory database part of the
branch-protection build contract.

The baseline jobs use explicit `ubuntu-24.04`, `macos-15`, and `windows-2025`
runner labels with Node `22.13.0` and pnpm `11.15.0`. Actions are pinned by
commit digest. Moving an operating-system image family or supported toolchain
is an intentional compatibility change rather than an implicit `latest` update.

Each operating-system consumer performs a normal lifecycle-script-enabled npm
install of the exact tarball in a temporary non-workspace project with its own
npm cache. It disables audit, funding output, and lockfile creation, then checks
the installed runtime dependency policy and invokes the installed CLI; using
`--ignore-scripts` here would hide platform-specific installation failures.

Unix-only support was rejected because a public `npx` installation interface
implies a portable Node CLI and would otherwise require a separate Windows
deployment path.
