# Isolated SJ harness and quality gate

This is test infrastructure, never a normal application fallback. No frontend changes.

## Run

Read the runner and applicable repository instructions before invoking it:

```powershell
cd D:\backend-production
node --test src/integration/support/sj-disposable-guard.test.js src/integration/support/sj-contract-double.test.js
node scripts/run-sj-isolated-tests.js
node scripts/run-sj-isolated-tests.js --workflow
node scripts/run-sj-isolated-tests.js --workflow-central
node scripts/run-sj-isolated-tests.js --workflow-upgrade
node scripts/run-sj-isolated-tests.js --worker-resilience
node scripts/run-sj-isolated-tests.js --cross-app
```

Requires supported Node (tested with 24.13), installed BE dependencies and a local Docker Linux engine with `postgres:17-alpine` and `redis:7.4.11-alpine`. In double-based modes, the pure snapshot schema is imported read-only from the sibling `ruwang-control/src/domain/review-snapshot.ts` and its installed Zod dependency, without importing its server/configuration/database. Its SHA is recorded; missing schema is a failure, not a permissive fallback. Real-peer modes are described below. No dependency install is automatic.

The runner accepts no database URL override. It creates new, individually labelled containers with tmpfs data, no persistent host/volume mounts and ephemeral loopback ports. A random run capability, owner marker, exact container IDs/labels, DB marker and role checks establish ownership. Database names alone are not trusted. Remote Docker TCP/SSH targets are rejected.

The ownership guard's synchronous Docker CLI commands have a fixed 30-second
deadline and kill only that spawned CLI on timeout. Errors propagate without
automatic retry or a fabricated ownership/completion result. A client timeout
does not prove a Docker daemon operation was cancelled: re-inspect exact owned
resources before recovery. This bound does not change browser action/drain,
workflow deadlines, server authentication, or normal application behavior.

PostgreSQL/Redis creation also has a fixed 30-second CLI deadline. Before
`docker run`, the harness persists its random run/capability labels, exact name,
local Linux image ID/digests, tmpfs path and ephemeral loopback binding (never
the password). It runs the inspected image ID, not a mutable tag. A missing,
malformed or timed-out result fails the positive workflow; no creating retry
or successful adoption occurs. Cleanup may use the exact name only to discover
a full ID, then verifies ID, name, image, ownership labels, mounts and binding
twice before removing that ID. This cleanup-only proof cannot authorize a
database connection and does not relax the normal live-port guard.

An absent resource after an uncertain create, failed inspection, ownership
mismatch or uncertain removal remains `removed:false` and fails cleanup.
A single absent lookup cannot prove the daemon will not finish creation later.
Inspect saved attempts and actual resources before separate recovery; never
remove by name alone. The helper's injected-executor unit tests are Docker
test doubles, not evidence of real daemon timeout behavior.

DDL/bootstrap uses only the new container's temporary PostgreSQL owner. Runtime credentials are separate app and worker logins without superuser, BYPASSRLS, DDL ownership or privileged memberships. Historical migrations retain their existing NOLOGIN policy helper; that role is not assigned to runtime. Minimal read grants on source agunan and division identity support the actual SJ service. The system URL in this harness is the same restricted app role, not the operational system credential.

All existing migrations are deployed to an empty DB and their ledger checksums verified. Accounts, role-menu permissions and four source agunan are infrastructure prerequisites. Contact/profile/media/publication/review states are created through actual services and the worker's `runSyncCycle` in a separate process. No SJ business status is seeded through SQL. Maker/checker are distinct and a denied actor has no menus.

Every child has an empty owned cwd and an allowlisted environment; repository `.env` is not loaded. Storage/upload/temp directories belong to the run. Redis is a dedicated container with run-prefixed test keys. The SJ worker uses its actual database outbox; Redis connectivity/namespace evidence does not imply that this worker uses a Redis queue. HTTP egress and upload destinations are restricted to the run's local contract double and redirects are rejected.

The read API workflow also executes the pure TypeScript response validator from
the sibling `frontend-production/src/services/seputar-jaminan.response.ts` using
Node 24 type stripping. Its SHA is recorded before/after the read checks. A
missing consumer fails the test; no copied permissive schema is substituted.
Local workflow creates 105 additional contact submissions through the genuine
authenticated API, walks filtered/mixed deep pages and records local timings.
They remain unapproved and are removed with the owned database. These timings
are not a production SLA. Workflow child timeout is bounded at 900 seconds.

## Coverage and limitations

- Setup, all current migrations/status/checksums (148 at the 7 October 2026 Step 4 review; the runner enumerates actual files), real runtime role membership, fixture services and worker cycles, four categories, submitted/approved/ACK/revision fixtures, no-context/no-permission visibility, signed snapshot/ACK, explicit 503 injection and owned cleanup.
- Guard unit tests reject wrong targets **before any DB client is constructed**. Live-proof unit doubles cover corrupted marker and unsafe roles using read-only SQL. Real fresh-run role checks remain separate evidence.
- Contract double tests reject signature/checksum/key/institution/nonce/timestamp/replay/schema errors. SJ event/media schemas come from the actual vendored contract. Control snapshot validation uses its actual pure schema.
- Double media READY deliberately isolates the central scanner. This is **not** real scanner, central public visibility, login endpoint, browser or cross-application E2E evidence. ACK is not proof of public visibility. Workflow modes exercise the actual bank router, JWT/session middleware, RBAC, services and runtime DB roles with test-only sessions; Control is still a contract peer, not its real application.
- Broad legacy integration suites remain preserved but their activation is rejected before connections/mutations. They contain unsafe cleanup or SQL business-state fixtures and are not represented as passing tests.
- RA-SJ-03 fixes the duplicate-source aborted-transaction issue using a savepoint and verifies HTTP 409 without an extra publication. Aggregate locks protect concurrent edits/submits/decisions. Profile/contact expose separate approved and pending immutable content; submission ACK is not public confirmation.

## RA-SJ-03 workflow modes and runtime prerequisite

`--workflow` covers local authority, denied/cross-division accounts, field validation, two-tab edits/submits/approvals, revision/resubmit, stale decisions, maker/checker separation and preserved approved versions. `--workflow-central` uses signed commands against the real bank receiver; verifies signatures/expiry/checksum/contributors, duplicate/concurrent commands, nonce replay, changed submissions, limited decision-outcome projection and change-request resubmission/lifecycle. It uses a separate `sj_test_review` login, never the migration owner.

`--workflow-upgrade` copies the chronological first 145 migrations into the run directory without editing the repository. Official services create two contact drafts and their versions before applying the four reviewed additions: the three 30 September migrations (destination binding, decision lineage and scoped recovery receipts) and the 20 October debtor `INSERT RETURNING` RLS correction, ending at149. The baseline remains145; a missing/renamed addition, a changed baseline count or an unreviewed future migration fails before provisioning. Workers do not run before this upgrade: current delivery code requires the new columns. Every existing SJ table count/content fingerprint must remain unchanged, new receipt tables must be empty, and final checksums/status plus the full local API/publication/worker workflow after upgrade must pass. Updating this guard is not evidence that the145→149 populated SJ workflow has actually run. This is a populated contact-draft baseline, **not** proof of upgrading every historical published/media/outbox dataset. The old non-contiguous 136-migration selection became invalid when it admitted a later migration while omitting its review-role prerequisite; do not recreate that schema or alter historical migrations to accommodate it. `sj-upgrade-proof.test.js` rejects unordered/duplicate/future or prerequisite-missing baseline plans before provisioning.

Central runtime now requires `SJ_REVIEW_DATABASE_URL` (or `_FILE`) for a dedicated login in `ruwang_sj_review`, with no superuser/BYPASSRLS/DDL ownership or app/worker membership. No fallback to `DATABASE_SYSTEM_URL`. Only SJ tables/decision columns required by the receiver are granted; signed command ledger stays private. This bank-wide service role is authenticated by signed instance-bound commands, not a human bank account. Each normal deployment must separately apply the reviewed migrations and provision this credential against the same bank database; the harness does not alter operational environments. Do not pass reviewer credentials to worker processes. App/worker credentials and historical NOLOGIN policy helpers remain separate.

Historical approved profile metadata that was never stored in the immutable public payload is not reconstructed from a newer mutable draft. Public observations prove an identity-bound API response at check time, not a freshness SLA. When the peer provides a valid `public_profile_version` or `public_asset_version`, the observation records that source event version and an allowlisted public snapshot. It is not the bank draft revision or a content-checksum comparison. Legacy missing versions remain unknown. Failed/latest attempts remain separate from the last valid observation. See [the observation contract](../../modules/seputar-jaminan/PUBLIC-OBSERVATION.md).

## Real Control/SJ mode and complete unit coverage

`--cross-app` provisions three databases within the run-owned PostgreSQL container, separate migration and runtime roles, actual Control ingress/decision dispatch, actual bank signed receiver, and actual SJ API/worker/storage. It verifies real ClamAV readiness with clean/EICAR samples. It creates test accounts/registry prerequisites, but positive profile/contact/publication/withdrawal transitions go through official services/API, never direct status SQL. It is not a normal-runtime fallback. Peer sources resolve from sibling checkouts (`ruwang-control`, `seputarjaminan-production`, `frontend-production`) with package identity checks, independent of drive letters.

The standalone command creates its own new ClamAV scanner, as do Control's existing cross-app test launchers; there is no default shared or legacy scanner. The local digest-pinned image must already exist. A supplied parent-owned scanner requires all four explicit proof fields: `SJ_TEST_SCANNER_NAME`, `SJ_TEST_SCANNER_MARKER`, `SJ_TEST_SCANNER_ID`, and `SJ_TEST_SCANNER_IMAGE_ID`. The expected resolved image ID and fixed digest reference must agree with local Docker image inspection and container configuration. Partial/invalid configuration and foreign live proof are rejected before creating the run directory, database, fixture or migration. Scanner proof requires exact ID, random name/capability, tmpfs-only signature storage, no bind/volume mount, no published port and no privileged/shared host networking. Readiness precedes database provisioning. The child never cleans a valid parent-owned scanner. A scanner created by the standalone run is recorded in its proof, removed by exact ID during normal cleanup and supported by the same owner/PID-checked interrupted-run recovery. A create failure without a captured ID is reported for manual inspection, never adopted by name.

## RA-SJ-12 companion CI gate

The Control peer registers the owned instance for the scenario, then uses the
official auth services to bootstrap, create and log in a separate test operator
with the single `internal_operator` role. The fixture username includes
"reviewer", but it is not a separate application role or a manual identity
verification step. Two different accounts do not prove two different humans;
qualified-subject contributor checks remain. The bootstrap session is logged out.
Random run-only credentials remain in memory/IPC and are never report fields.
No synthetic session or bypass of the current decision-principal guard is used.

An unsigned bank ACK is a separate negative contact scenario: the real bank
applies the decision, its response signature is stripped, and Control must keep
the command UNKNOWN and snapshot IN_REVIEW. Repeated/concurrent dispatch must
perform zero additional HTTP calls and retain one attempt. A restricted bank
review-role ledger read proves the remote application for this test only; it is
not a recovery endpoint. Positive cases retain signed ACK and APPLIED checks.
The harness does not resend UNKNOWN commands or manufacture acknowledgments.

`node scripts/run-sj-ci-gate.js` runs all five mandatory modes with an ephemeral,
digest-pinned ClamAV container and verifies every scenario and cleanup receipt.
The scanner requires signature download availability. All DB/storage/queue
resources still use the disposable harness guards; operational environment
variables are not propagated. Summaries export only allowlisted evidence, not
raw runtime logs, proof directories, passwords or private keys. The optional
Windows operator-browser mode is separate, not claimed as hosted browser proof.

`.github/workflows/sj-isolated.yml` provides a Docker-capable Ubuntu companion
workflow (manual/reusable) with exact 40-character frontend/Control/SJ revisions.
It deliberately does not use peer `main` as the candidate. Run this companion
in addition to Quality before a release containing SJ changes; generic Quality
alone is insufficient. Peer repositories must be readable by the checkout
identity. No production credentials or cross-repository token is embedded.
If private peer access is unavailable, checkout must fail, never skip a suite.
Uploading/publishing the local uncommitted candidate and arranging approved
repository read access belong to the separate authorized release/CI stage.
Static workflow validation and local execution are not a hosted CI result.

`--cross-app-browser` additionally requires `SJ_TEST_CONTROL_BUILD_ROOT` pointing to an isolated production Control build with `source.json` matching the current Control source. It uses a disposable operator login and Playwright CLI to inspect profile/withdrawal status at desktop/mobile sizes. This is not a claim that every bank mutation was performed by browser clicks, or that SJ ops operator login was tested. Core cross-app work has a 1200-second process timeout; browser work has 1800 seconds; double-based workflows retain 900 seconds.

`--cross-app-performance` is a separate, single runner flag. It includes the actual three-UI journey and bounded production-build measurements, and additionally requires `SJ_TEST_BANK_UI_BUILD_ROOT` and `SJ_TEST_PUBLIC_UI_BUILD_ROOT`. Each external build must have a successful result and a source manifest matching the live repository. Fixed previews are Control 4320, bank 3111, and SJ 4411, with bank API proxy 7111; an occupied port is rejected, not replaced by another preview port. The performance child timeout is 3600 seconds. An actual 2700-second local run completed only 12 of the 18 UI probes before the scenario deadline; the extra bounded budget retains the full coverage and lawful fixture cleanup. Individual read/action/drain deadlines, failure assertions and application authentication/token lifetimes are unchanged. Database, scanner, Redis, storage and integration targets remain owned disposable resources. PostgreSQL statement statistics use the owned container's diagnostic administrator only; application runtime roles stay non-superuser/non-BYPASSRLS. Only query fingerprints, kinds, counts and timings are exported, not SQL text/parameters. Browser response fault doubles are labelled separately from actual service integration. Warm local distributions, global run-database SQL windows and host resource samples are not production SLA or isolated application CPU measurements.

The long performance phase explicitly renews only the known API fixture actors
at two fixed phase boundaries: before fixture preparation and after read-only
measurements, before lawful API lifecycle cleanup. Both repeat the live ownership
guard and produce separate receipts; neither is triggered by a failed response.
It uses the existing access-token issuer and 30-minute lifetime with the same
seeded actor/session IDs. This is not browser session refresh evidence and is
never a fallback after HTTP401. The real bank authentication must reject an
expired signed fixture token with401 and accept the fresh fixture actor with200.
Renewal receipts record counts/lifetime/time only; HTTP mismatch diagnostics
record method, route family, expected/actual status and token validity only.
No token, payload, cursor, identifier or private application error is exported.
`performance.json` records the active measurement stage so an interrupted run
can be diagnosed without inventing results for stages not executed.

Before lawful performance fixture cleanup, the long-lived service harness also
re-authenticates its known Control fixture operator through real `loginOperator`
and `loadOperatorSession`, then retires the old session through official logout.
It verifies the same operator/issuer, a new session, current internal scope and
old-session rejection. The private token stays in the peer process; only
allowlisted booleans are returned. This is a fixed phase boundary, not a retry
after a failed decision. Control's30-minute idle/480-minute absolute defaults
are not changed and no session expiry/status is rewritten by harness SQL.
These service logins are not browser-session renewal evidence.

Three additional catalogue next/first-page repetitions run after the ordinary
18 UI probes, with their existing response.finished/CDP completion checks but
without native fetch/stream wrappers. Every failure remains a final gate issue;
the transport is not waived from HTTP200, DOM contents or native diagnostic EOF.
The opt-in native diagnostic remains separate and never final performance proof.

Idle measurements retain pathname strings for analysis compatibility **and**
structured GET/resource-type/start/completion/status/failure records. Origin is
compared with the already-owned fixed bank proxy (`127.0.0.1:7111`) or the exact
Control/SJ UI origin; the first observed request is never adopted as authority.
For bank role-menu refresh, one `role_id` must match the actual browser's stored
session/persisted user role privately. `users/me`, `menus` and unread-count have
no query according to their actual service callers. This isolated fixture's
single role-menu page uses exactly one each of `page=1`, `limit=100` and current
`role_id`, with no additional keys. Only `roleScoped` and
`queryContractVerified` booleans are exported, not role IDs, tokens, query values
or console business text. This is a local single-page fixture bound, not a claim
that an operational role with more than 100 menu entries needs only one page.

Bank shell source (`frontend-production/src/components/auth/AuthProvider.tsx`)
checks access freshness on a 15-second timer, with 60-second successful-refresh
freshness and 5-second failure cooldown. A successful refresh awaits `users/me`
before starting `menus` and the current role's `role-menus`; `Notification.tsx`
separately polls unread-count every 45 seconds. These are not SJ data/detail
polling. A 50s
bank idle window permits zero or one **complete**, same-origin, current-role,
successful GET group and at most two unread-count reads. Missing/repeated groups,
wrong roles/origins/methods/queries, non-200/incomplete/failed requests, unknown/SJ
routes, console/page errors or unbounded timing remain explicit failures.
Control/SJ 12s windows permit no background data requests. A finite 5s drain
lets the two RBAC follow-ups finish when `users/me` started within the window,
but only after that request completes; it cannot authorize a new drain-only
group. Raw timestamps and pending/error evidence stay retained. Scheduler
overrun beyond this drain stays a timeout failure rather than being waived.

Cross-request RBAC ordering uses completed Playwright `Request.timing()`
network timestamps (`startTime + requestStart` against `startTime + responseEnd`),
not the arrival order of external Node request/requestfinished callbacks. No
millisecond tolerance is added. Missing, negative, nonfinite or nonmonotonic
timing remains a failure; old callback-only records are not retrospectively
passed. Callback timestamps still bound the observation/drain and are retained.

Warm navigation captures response metadata only; it does not call image
`Response.body()` or `Request.sizes()` from a response event. A body can already
be unavailable after navigation and Chromium body retrieval may perform a
fallback resource fetch. Image response rows therefore retain request-window
ownership and `bytes:null` with `NOT_READ_BY_NAVIGATION_OBSERVER`, never zero or
an invented success. Browser Resource Timing remains recorded separately.
Actual byte counts, MIME, cache rules, dimensions and anonymous rejection still
come from the dedicated real public/private media reads. HTTP errors, pending
requests, unexpected transport failures and visible-image failures are unchanged
gate failures. The historical observer failure is retained, not relabelled PASS.

Performance runs require `SJ_TEST_PLAYWRIGHT_CLI_ROOT` and the JSON string
`SJ_TEST_PLAYWRIGHT_CLI_PIN`, from an explicitly inspected, already-installed
CLI tree. `sj-browser-toolchain` verifies exact package identities, versions,
entry/dependency resolution and pinned bytes before any run provisioning, then
again before/after browser work. The CLI is invoked directly with update
notifications disabled and an OS-only environment, never via an unpinned npx
download. Its resolved descriptor and actual Chromium version are recorded.
This local pin is not an application dependency update or a supply-chain audit
of every transitive file.

The installed stable Chromium155.0.8059.39 has an upstream completed no-store
stream reporting defect (Chromium568852319/commit62473ad0f747e245e514c93e741bb8e168a2a207).
A same-engine synthetic comparison must establish it independently of the app;
page success does not itself waive a request failure. A fixed portable CFT
browser can be selected explicitly for a local performance run via
`SJ_TEST_BROWSER_PROOF`. The proof pins official version/URL, owner marker,
archive object checksum, complete extracted file/pathset hashes, executable
and exact open-only CLI config. The runner verifies it before provisioning,
the browser reports its actual version, and bytes are checked again afterward.
No download/system browser update occurs in the runner; no fallback selection
is automatic. Normal app cache/auth/streaming and all failure gates are unchanged.

Chrome for Testing157.0.8099.0 is a Canary diagnostic artifact, not the installed
stable browser. Its Windows binary is unsigned; official HTTPS object checksum
and frozen SHA256 bytes are not an Authenticode publisher signature. Tests on
that explicit browser must not be reported as stable155 transport compatibility
or as permission to release/deploy. Preserve old failing evidence and note the
upstream stable-browser dependency until its fixed release is actually tested.

Baseline screenshots also wait for visible images, genuine route content,
active public main-media dimensions/source and finite reveal transitions;
bank publication captures wait for their observation UI to stop loading,
without assuming a public success. Only visible media is proven, not every
below-fold lazy image. Mobile public detail additionally checks native Tab
scrolling, focus and actual center hit-testing for the publisher/footer links
against the real header/contact dock; no forced click or CSS hiding is used.
Supplemental viewport screenshots are separate from full-page captures.

Public profile and asset captures select only a unique **visible** actual route
heading and require opaque ancestors. A loading-route title or hidden streamed
copy cannot substitute for that heading. Missing content, wrong text, two
visible copies or transparent content remain failures. Safe before/after DOM
metadata distinguishes raw matches from rendered headings without interpreting
an ambiguous selector alone as a permanent application duplication.

For a separately labelled local cancellation diagnosis only,
`SJ_TEST_CATALOG_CANCEL_DIAGNOSTIC=1` may accompany `--cross-app-performance`.
The launcher rejects other values or other modes before provisioning. This
adds bounded native fetch/abort/stream and owned SJ HTTP event metadata, not
replacement responses, extra business requests or a success fallback. The
three targeted repetitions run separately after the ordinary UI probes. Native
receiver/arguments/promise identity are preserved, but wrappers remain
observable instrumentation; the run is **ineligible** as the final performance
PASS. Call-site metadata is hashed and does not export full URLs, bodies,
headers, tokens, stack text or private abort reasons. Raw failure evidence is
retained, and an uninstrumented final gate is required. A missing final observer
record does not prove zero dropped events or successful hook cleanup.

The separate browser diagnostic explicitly opts in to response/body/reader
ownership tracking. It observes only catalog fetch promises, actual body getter,
clone/tee/getReader calls, read done/rejection, closed, cancel and releaseLock
metadata; it never acquires a reader or drains a body itself. Response/stream/
reader identities are weak associations and exported rows contain no body bytes,
private URL, reason or stack text. Native return/promise/receiver/argument identity
is retained, but added Promise reactions and prototype hooks can alter timing and
rejection observation. This remains diagnostic evidence, not transparent runtime.
Outstanding Promise reactions are bounded, not lifetime read chunks, so EOF after
more than 200 sequential reads is still observable. Saturated pending tracking,
unsupported promises, lineage/event drops and restoration failures are explicit;
missing metadata is not a successful capture. Optional BYOB absence is supported.

Browser epoch/monotonic anchors and separate UI/CDP epoch anchors are retained
for correlation; callback arrival order or HTTP200 alone proves neither ownership
nor EOF. Each targeted repetition is persisted before browser preparation.
Preparation, context/evaluation or hook-close failure retains the failed attempt,
stops subsequent repetitions and does not claim restoration. Native primitive
unit regression runs in a bounded OS-only Node subprocess without HTTP/database:
it verifies long-stream EOF, clone/tee, default/BYOB readers, cancellation/error
identity and exact descriptor restoration. This is not Chromium or cross-app
transport proof. Only a later uninstrumented production-build gate may provide
final performance evidence.

`idleMeasurementIssues` collects all independent defects without stopping the
first idle window, so subsequent safe measurements and lawful fixture cleanup
still run before the final failing gate. This corrects incomplete harness
expectations, not application authentication policy. Historical pathname-only
failed runs are not reclassified as PASS. These short local windows do not prove
long-duration absence of polling, production load/capacity or freshness SLA.

The real-peer lifecycle matrix also covers suspension/reactivation and profile,
publication and cover-media quarantine/resolution through the actual SJ ops
service. The public-read role resolves the eligible cover; ops does not receive
a new publication-media grant. A specifically labelled negative time fault sets
only confirmation timestamps in the owned test publication to the past; it does
not change state/version/checksum or restore a positive state with SQL.
Signed Control decisions then archive all four categories, reject a referenced
contact removal, revoke the released contact/photo and hide the profile. Archive
keeps content/history. The reviewer role must be able to write archived_at but
must still lack source-rebinding and DELETE privileges. This exercises a real
archive-permission regression that earlier withdrawal-only coverage missed.

For a module-unit gate, run **all** `src/modules/seputar-jaminan/*.test.js` plus `src/workers/seputar-jaminan.worker.test.js`, not a handpicked list that can miss legacy tests. Use an empty test cwd/allowlisted environment and unreachable disposable unit connection URLs so repository `.env` cannot be loaded. These unit files do not substitute for the fresh-database/role/concurrency suites. Broad `npm test` also discovers unrelated/legacy integration files; inspect them before enabling it. Never enable unsafe legacy cleanup just to eliminate a skip.

The authoritative media-reference result is a scoped boolean from the database helper, not just the counts visible to one division. Unit coverage checks this distinction and fail-closed malformed results. `sj-media-reference-scenario.js` separately proves old approved photo/logo protection, cross-division access and binding/revoke races on real PostgreSQL roles.

## RA-SJ-04 delivery resilience

`--worker-resilience` uses separate real bank worker processes and PostgreSQL roles. It exercises atomic claims, expired SENDING recovery, renewal, stale owner success/failure, crash before delivery/after remote application/after local commit, ordered versions, newer draft preservation, malformed ACKs, socket interruption, timeout, retry/backoff/exhaustion, repeated abandoned leases, authorized concurrent API retry, upload reservation and revoke during upload. Only negative-test scheduling/lease timestamps are fault-injected; positive business transitions use official services/API.

The parent can pause/unpause only its exact owned PostgreSQL/Redis containers. Recovery checks immutable ID, ownership labels, tmpfs and configured loopback binding even when Docker Desktop temporarily omits live port data for a paused container. Normal runtime proof still requires live port data. Redis outage evidence concerns the DB-backed outbox, not Redis queue processing or heartbeat delivery.

Delivery is **at least once**, with immutable event identity/checksum and receiver idempotency; no distributed exactly-once guarantee is claimed. A lower aggregate version that failed/quarantined blocks later versions until an authorized retry succeeds. Eight failed/abandoned automatic attempts stop delivery. Manual retry preserves the event and monotonic attempt history and allows another attempt; it does not reset audit history or bypass permissions. Claims use unique per-claim tokens, not a reusable process name. Renewal and completion require the same token, attempt number and unexpired lease.

`SJ_OUTBOX_LEASE_MS` defaults to 300000; `SJ_CENTRAL_REQUEST_TIMEOUT_MS` defaults to 30000. Invalid bounds fail the cycle; configure them before starting the worker. Media reservation recovery waits at least five minutes and longer if the configured bounded calls require it. Cycle logs report work attempts and failures, not proof of public visibility; a heartbeat remains process-liveness evidence only.

SJ ACK validation follows actual `apps/api/src/app.ts`: request ID, APPLIED/DUPLICATE, event ID, active aggregate version, acknowledgment timestamp. The current response has **no aggregate ID or checksum echo**; outgoing schema/checksum validation plus event binding and the peer's duplicate checks are retained. Adding response echoes needs a separately approved SJ contract change. A DUPLICATE with a newer cursor confirms the old event only and does not update current aggregate delivery state. Control snapshot ACK still uses its distinct canonical signed protocol; no SJ signature requirement is fabricated. ACK never supplies public observation evidence.

## Evidence and recovery

Each run prints a temp evidence root `ra-sj-02-*` outside the release. `report.json` includes source manifest, checks, failure phase, safe role facts, peer schema SHA and cleanup; `proof.json` contains resource IDs and capability digest, **not passwords/private keys**. Raw app SQL/log output is suppressed. A source change during the scenario fails the run.

Normal success/failure removes only owned containers and storage/uploads/tmp, retaining reports, owner proof and migration logs. Cleanup preflights all paths and refuses junctions/foreign markers. Unexpected parent disconnect stops child workers. Never run `docker prune`, reset an existing database, delete a workspace root or force-remove a foreign container.

After an abnormal termination, first inspect the saved report, exact process IDs and labelled containers. Do not start a duplicate run blindly. Once the original parent is no longer alive:

```powershell
node scripts/run-sj-isolated-tests.js --cleanup C:\absolute\owned-run\proof.json
```

Recovery refuses a live/reused parent PID, mismatched proof or unverified container. Inspect failures manually; do not bypass ownership checks. It writes a separate `recovery.json` and does not turn a failed/interrupted test into a pass. Reports for older runs without parent PID require an explicit process inspection before cleanup. Cleanup is irreversible only for disposable test data; operational resources are never targets.
