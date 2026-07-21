# Password KDFs for Cloudflare Workers

Date: 2026-07-21

## Question

Which password key-derivation functions can Shortflare run in its Management
Worker, and what should the implementation benchmark before choosing one?

This note records the runtime and security constraints and the conclusions from
a one-off local workerd benchmark. The spike implementation and comparison-only
dependencies were removed after measurement. A production deployment still
needs a remote smoke test because local workerd does not reproduce Cloudflare's
production CPU limiter.

## Conclusions

1. Native `node:crypto` scrypt is the strongest practical first choice. It is
   memory-hard, implemented in workerd, and avoids the implementation-speed
   disadvantage of a pure-JavaScript KDF. It requires the `nodejs_compat` flag.
2. Do not infer native Argon2 support from Cloudflare's broad statement that
   `node:crypto` is supported. Node added `argon2` in v24.7.0, but current
   workerd Web Platform Tests explicitly mark Argon2 unsupported and the
   Workers Web Crypto support table does not list it. Probe the pinned runtime
   to catch a future implementation, but treat JavaScript or WASM as the only
   current Argon2 paths.
3. Native Web Crypto PBKDF2-SHA-256 is operationally simple. The pinned local
   runtime completed 600,000 iterations, but open-source workerd's production
   limit-enforcer default caps PBKDF2 at 100,000 iterations and calls that cap
   far below the recommended minimum. It remains a compatibility/control
   candidate until a deployed Worker proves the production behavior.
4. Do not select pure-JavaScript Argon2id merely because it runs. The
   `@noble/hashes` maintainers state that their Argon2 implementation is about
   five times slower than native code and recommend scrypt instead, because a
   slow verifier implementation gives native-code attackers a larger relative
   advantage.
5. Keep bcrypt only as a compatibility/control candidate. `bcryptjs` runs as
   JavaScript, but it is not memory-hard, is slower than the native bcrypt
   binding, and silently accepts only the first 72 UTF-8 bytes unless the
   caller rejects truncating input.
6. The stored verifier must be self-describing: algorithm and version, all
   work factors, salt, output length, and derived bytes. This is required for
   rehash-on-login and follows NIST's requirement to retain the scheme and cost
   factor alongside each salted hash.
7. A safe password KDF is unlikely to fit the Free plan's 10 ms request CPU
   budget. The selection decision must state whether Shortflare deployment
   requires a Paid Workers plan for password authentication.

## Runtime facts

- Workers Web Crypto supports `PBKDF2` for `deriveBits` and `importKey`, and
  exposes `crypto.subtle.timingSafeEqual`. It does not require
  `nodejs_compat`. [Cloudflare Web Crypto]
- Cloudflare documents `node:crypto` as fully supported except for DSA/DH key
  generation, Ed448/X448, and manual FIPS-mode changes. It requires the
  `nodejs_compat` flag. [Cloudflare Node crypto]
- The current Node API provides asynchronous and synchronous Argon2, PBKDF2,
  and scrypt APIs. Argon2 parameters are `parallelism`, `tagLength`, `memory`
  (KiB), and `passes`; scrypt parameters are `N`, `r`, `p`, and `maxmem`.
  [Node crypto]
- workerd's default limit enforcer permits at most 100,000 PBKDF2 iterations
  and at most `N * r * p = 2^20` for scrypt. The source calls the PBKDF2
  ceiling "WAY" below the recommended minimum. [workerd KDF limits]
- A Worker isolate has 128 MB total memory, including JavaScript heap and
  WebAssembly allocations, and one isolate may serve concurrent requests.
  Free-plan HTTP requests have 10 ms CPU time; paid Workers default to 30
  seconds and can be configured up to five minutes. [Workers limits]
- Workers are single-threaded and do not support Web Worker threads. A WASM
  implementation cannot assume browser worker threads for Argon2 lanes.
  [Workers WebAssembly]
- In production, `performance.now()` and `Date.now()` do not advance during
  CPU-only work. Cloudflare explicitly recommends local Wrangler/workerd for
  measuring CPU-intensive code. Production validation therefore needs
  externally measured request latency and Workers CPU logs, not an in-handler
  timer. [Workers timers]

## Candidate comparison

| Candidate | Workers path | Security property | Parameters to store | Main constraint |
| --- | --- | --- | --- | --- |
| scrypt | `node:crypto.scrypt` with `nodejs_compat`, or `@noble/hashes/scrypt.js` | Memory-hard; designed to raise custom-hardware attack cost | `N`, `r`, `p`, salt, derived-key length, result; also enforce a local `maxmem` policy | Approximate core memory is `128 * N * r`; workerd's default limit also requires `N*r*p <= 2^20`; high settings compete with all requests in the isolate |
| Argon2id | Pure JS or WASM; re-probe `node:crypto.argon2` on runtime upgrades | Memory-hard; RFC 9106's required variant | algorithm/version, `memory`, `passes`, `parallelism`, salt, tag length, tag | Native path is currently unsupported; 64 MiB is already half of an isolate's total memory |
| PBKDF2-HMAC-SHA-256 | `crypto.subtle.importKey` + `deriveBits` | CPU-hard, not memory-hard; native runtime primitive | PRF/hash, iteration count, salt, derived-key length, result | workerd's default 100,000-iteration ceiling is explicitly below the recommended minimum |
| bcrypt | `bcryptjs` | Adaptive CPU cost, not memory-hard | bcrypt's 60-character modular hash includes version, cost, salt, and result | 72-byte password-input limit; pure-JS implementation; retain only for comparison or legacy verification |
| Argon2id, pure JS | `@noble/hashes/argon2.js` | Same algorithm, inefficient implementation | PHC Argon2 version, `m`, `t`, `p`, salt, tag | Library author recommends scrypt because pure JS is about 5x slower than native |
| Argon2id, WASM | Third-party WASM package | Memory-hard and potentially closer to native performance | PHC Argon2 version, `m`, `t`, `p`, salt, tag | Adds a binary/dependency and startup cost; WASM memory counts toward 128 MB and cannot use threads |

## Empirical results

The benchmark ran each candidate three times in the repository's Cloudflare
Vitest pool. That executes the KDF in workerd through a test-only Worker and
measures each request from the calling test isolate, because Workers timers do
not advance during CPU-only work. The numbers include a 1 ms median request
baseline and are local wall-clock latency, not production CPU billing values.

Environment:

- compatibility date: `2026-07-19`
- compatibility flag: `nodejs_compat`
- Wrangler: `4.112.0`
- Miniflare/workerd package: `4.20260714.0`
- host architecture: macOS `arm64`
- password: fixed ASCII test input; salt: fixed 16 bytes; output: 32 bytes

| Candidate | Parameters | Memory estimate | Median | Range | Result |
| --- | --- | ---: | ---: | ---: | --- |
| scrypt, native async | `N=32768, r=8, p=1` | 32 MiB | **57 ms** | 56–62 ms | Selected |
| scrypt, native sync | `N=32768, r=8, p=1` | 32 MiB | 57 ms | 56–58 ms | Compatible, but blocks the isolate |
| scrypt, native sync | `N=65536, r=8, p=1` | 64 MiB | 115 ms | 110–122 ms | Compatible, but consumes half the isolate limit before overhead |
| PBKDF2-HMAC-SHA-256 | 100,000 iterations | negligible | 10 ms | 9–11 ms | Control only |
| PBKDF2-HMAC-SHA-256 | 600,000 iterations | negligible | 45 ms | 45–46 ms | Local-only success; production limit still needs a remote probe |
| bcryptjs | cost 12 | negligible | 282 ms | 282–285 ms | Rejected: not memory-hard and truncates after 72 UTF-8 bytes |
| Argon2id, pure JS | `m=19456 KiB, t=2, p=1` | 19 MiB | 980 ms | 924–991 ms | Rejected: large native-attacker advantage |
| scrypt, pure JS | `N=32768, r=8, p=3` | 32 MiB | 3,460 ms | 3,446–3,500 ms | Rejected: excessive CPU latency |
| Argon2id, native | `m=19456 KiB, t=2, p=1` | 19 MiB | — | — | Unavailable: `node:crypto.argon2Sync` absent |

The selected starting policy is native asynchronous scrypt with `N=32768`,
`r=8`, `p=1`, a random 16-byte salt, and a 32-byte output. It is memory-hard,
has no third-party production dependency, and leaves materially more headroom
than the 64 MiB setting in a 128 MB isolate. Its approximately 57 ms local CPU
cost means password authentication requires a Paid Workers plan; it is not
compatible with the Free plan's 10 ms request CPU budget.

Before shipping authentication, run the same verifier through a temporary
deployed Management Worker, record Workers CPU time, and test concurrent login
requests. If the 64 MiB setting proves safe under production concurrency, it is
the preferred future strengthening target.

### Argon2id

RFC 9106 requires Argon2id support and recommends a 16-byte unique salt. Its
memory-constrained default is Argon2id with `m=65536` KiB, `t=3`, `p=4`, and a
32-byte tag. The RFC also says to select the maximum affordable memory first,
then tune passes to the maximum affordable time. Those defaults are inputs to a
benchmark, not an automatic Workers configuration: 64 MiB leaves less than 64
MiB for the isolate's JavaScript heap, runtime overhead, and concurrent
requests. [RFC 9106]

Current workerd marks Argon2 unsupported. A runtime probe remains useful because
Node now exposes the API and Cloudflare may add it later. For the JavaScript or
WASM candidates, benchmark at least `m=19456`, `32768`, and `65536` KiB with
`t=2` and `3`, `p=1`. A single-threaded Worker cannot realize multi-threaded
lane parallelism; higher `p` may alter the algorithm without improving wall
time. [workerd Web Crypto tests]

### scrypt

RFC 7914 defines `N` as a power-of-two CPU/memory cost, `r` as block size, and
`p` as parallelization. It warns implementers to bound attacker-supplied
parameters to avoid denial of service. Node documents the approximate memory
guard as `128 * N * r`; with `r=8`, `N=2^15` is about 32 MiB and `N=2^16` is
about 64 MiB before surrounding application overhead. [RFC 7914] [Node crypto]

For the pure-JavaScript fallback, `@noble/hashes` says JavaScript does not
provide actual parallel execution, so increasing `p` is not useful. Its async
function yields to the event loop but does not make the computation free in CPU
or memory terms. Benchmark `N=2^14`, `2^15`, and `2^16`, with `r=8`, `p=1`, a
32-byte output, and an explicit `maxmem` ceiling. [noble-hashes]

### PBKDF2-HMAC-SHA-256

The Web Crypto API accepts a salt, iteration count, and hash identifier for
PBKDF2 and derives an explicitly sized byte string. Use a random 16-byte salt,
SHA-256, and a 32-byte output in the benchmark. Its main operational advantage
is a small, native, compatibility-flag-free API; its security disadvantages are
the lack of a memory cost and workerd's 100,000-iteration ceiling. Since the
runtime itself calls that ceiling inadequate, a fast benchmark result does not
make this a suitable default. [Web Crypto spec] [workerd KDF limits]

### bcrypt

`bcryptjs` is a zero-dependency ECMAScript module and so is useful as a
runtime-compatible control. Its own documentation says it is about 30% slower
than the native binding and limits inputs to 72 UTF-8 bytes without implicitly
checking truncation. That conflicts with Shortflare's intent to accept normal
Unicode passwords without surprising equivalences. If retained for legacy
verification, reject truncating inputs explicitly. [bcryptjs]

## Storage and verification contract

NIST SP 800-63B-4 requires a suitable salted password hashing scheme with the
highest practical cost factor, increasing that factor over time. It requires
storing the salt and hash and recommends storing the scheme and cost factor for
each password. [NIST SP 800-63B-4]

Use one versioned string or equivalent typed columns with this logical shape:

```text
scheme | scheme-version | parameters | base64url(salt) | base64url(tag)
```

Examples of parameter payloads:

```text
argon2id: v=19,m=32768,t=3,p=1,tag=32
scrypt:   N=32768,r=8,p=1,dk=32
pbkdf2:   hash=sha256,i=<measured>,dk=32
bcrypt:   retain the library's standard 60-character encoded value
```

The parser must whitelist algorithms, parameter names, ranges, and encoded
lengths before performing expensive work. Never accept arbitrary cost values
from an untrusted verifier string without a configured maximum. Verification
must compare equal-length byte arrays with `crypto.subtle.timingSafeEqual` (or
the equivalent native API). After a successful login, hash again when the
stored scheme or parameters differ from the current policy.

Generate a fresh 16-byte salt with `crypto.getRandomValues` for every password.
Treat passwords as UTF-8 bytes with one documented normalization policy; do not
let individual KDF libraries apply different string conversions.

## Benchmark protocol

1. Run the implementation inside the repository's Workers Vitest pool or a
   Wrangler-served Worker so the code executes in workerd, not ordinary Node.
2. Record the exact compatibility date, workerd/Wrangler version, package
   version, host CPU, plan target, and parameters.
3. Use the same fixed password bytes, random-sized 16-byte salts, and 32-byte
   outputs across candidates. Test ASCII and multi-byte Unicode inputs and a
   password longer than 72 bytes to expose bcrypt truncation.
4. Separate cold first-call measurements from warmed measurements. Report at
   least median and p95 over repeated hash and verify operations; verify both a
   match and a mismatch.
5. Exercise concurrent requests for memory-hard candidates. A single successful
   64 MiB call does not prove safety in a 128 MB isolate shared by requests.
6. Dry-run the bundle and report compressed size and startup time, especially
   for JavaScript/WASM libraries.
7. For remote smoke testing, measure end-to-end latency from the client and
   inspect Workers CPU/memory outcomes. Do not use an in-Worker timer as the
   production KDF measurement.

## Selection rule

Use native `node:crypto` scrypt with `N=2^15`, `r=8`, `p=1` as the initial
policy. Promote to `N=2^16` only after deployed concurrency-memory testing.
Select pure-JavaScript
scrypt only when avoiding `nodejs_compat` materially outweighs its runtime cost.
Native Argon2id should move ahead of scrypt if a future pinned workerd version
implements it and its memory behavior passes the same tests. Do not select
PBKDF2 at workerd's current ceiling, bcrypt, or pure-JavaScript Argon2id for new
hashes unless the preferred paths prove unavailable and the reason is
documented.

The final policy should name one default parameter set, a hard maximum accepted
by the verifier, and a `needsRehash` rule. Re-run the benchmark when the
compatibility date, workerd implementation, KDF package, or plan CPU budget
changes materially.

## Sources

- [Cloudflare Web Crypto][]
- [Cloudflare Node crypto][]
- [Node crypto][]
- [workerd KDF limits][]
- [workerd scrypt implementation][]
- [workerd Web Crypto tests][]
- [Workers limits][]
- [Workers WebAssembly][]
- [Workers timers][]
- [Web Crypto spec][]
- [RFC 9106][]
- [RFC 7914][]
- [NIST SP 800-63B-4][]
- [noble-hashes][]
- [bcryptjs][]

[Cloudflare Web Crypto]: https://developers.cloudflare.com/workers/runtime-apis/web-crypto/
[Cloudflare Node crypto]: https://developers.cloudflare.com/workers/runtime-apis/nodejs/crypto/
[Node crypto]: https://nodejs.org/api/crypto.html
[workerd KDF limits]: https://github.com/cloudflare/workerd/blob/main/src/workerd/io/limit-enforcer.h#L39-L96
[workerd scrypt implementation]: https://github.com/cloudflare/workerd/blob/main/src/workerd/api/node/crypto.c%2B%2B#L1139-L1203
[workerd Web Crypto tests]: https://github.com/cloudflare/workerd/blob/main/src/wpt/WebCryptoAPI-test.ts
[Workers limits]: https://developers.cloudflare.com/workers/platform/limits/
[Workers WebAssembly]: https://developers.cloudflare.com/workers/runtime-apis/webassembly/
[Workers timers]: https://developers.cloudflare.com/workers/runtime-apis/performance/
[Web Crypto spec]: https://www.w3.org/TR/WebCryptoAPI/#pbkdf2
[RFC 9106]: https://www.rfc-editor.org/rfc/rfc9106.html
[RFC 7914]: https://www.rfc-editor.org/rfc/rfc7914.html
[NIST SP 800-63B-4]: https://pages.nist.gov/800-63-4/sp800-63b.html#passwordver
[noble-hashes]: https://github.com/paulmillr/noble-hashes#readme
[bcryptjs]: https://github.com/dcodeIO/bcrypt.js#readme
