# Seputar Jaminan in Ruwang Arsip: workflow and maintenance guide

RA-SJ-13, 24 September 2026. This describes the implemented local workflow,
not production readiness. Stage evidence, screenshots, source hashes and local
credentials are deliberately not packaged in this repository. Do not treat a
successful build, connection setting, worker heartbeat or ACK as proof of public visibility.

Documentation reconciled 7 October 2026 against the later product decisions.
The RA-SJ-13 date describes the original guide, not a fresh application gate.
The bank's four active menus and removed help surface follow
`D:/frontend-production/docs/seputar-jaminan-operator-access.md`. Control's
retired manual identity/public observation/UI comparison and single internal
role follow `D:/ruwang-control/docs/control-simplification.md`. These decisions
do not remove bank/SJ public observation, bank Role–Menu, server validation or
historical audit. Different Control accounts do not prove different humans.

## Six distinct facts

| Fact | Source | Meaning and UI rule |
|---|---|---|
| Submission / decision | Immutable profile/contact/publication versions, review and change-request records | Draft, in review, revision requested or approved describes bank work. Keep reviewer notes and submitted version visible. |
| Bank application | Signed Control decision result / local-authority service transaction | A central decision can be rejected by the bank on version/authority conflict. Receipt of a command is not application. |
| Delivery | DB outbox event and validated protocol-specific response | Queued, sending, retrying, failed, quarantined and acknowledged are delivery facts, not asset counts. |
| Media | Media state, ownership, checksum and central media identity | A saved/uploaded file is not necessarily READY; a READY file alone cannot publish an asset. |
| Projection / eligibility | Validated reconciliation and public API eligibility | Matching cursor or accepted ingest is insufficient evidence of a healthy public publication. |
| Public observation | Identity/environment-bound observation, source event version where available | Last valid result and latest failed attempt remain separate. Display check time; do not promise current visibility. |

### State and action matrix

These are presentation conditions, not additional database enums.

| Condition | Show | Next action / constraint |
|---|---|---|
| Not submitted | Working bank version; missing fields/media/contact | Save draft and submit only if server action assessment permits. |
| In review | Submitted immutable version, submission time and delivery to reviewer | Wait; editing or duplicate decisions must not replace the submitted version. |
| Needs revision | Reviewer note and affected version | Edit and resubmit via existing contract; never invent cancellation/withdraw-submission. |
| Approved | Approved bank content and separate bank-application result | Inspect delivery, media and public observation; do not relabel as live. |
| Queued / sending / retrying | Delivery state and relevant attempt information | Wait or authorized retry only when server permits; do not create a replacement event. |
| ACK received | Receiver accepted the bound event according to its protocol | Not a public confirmation. Control signed ACK and SJ ingest ACK are different contracts. |
| No public evidence | Unknown / no check result | Check only with update permission. Never infer absence from lack of evidence. |
| Available at check time | Public API snapshot, source event version if present, check time and validated website link | Use plain copy such as “Tersedia saat dicek”. No arbitrary freshness TTL. |
| Latest check failed / timed out | Latest failure and time, alongside last valid fact | Retry a check if permitted; do not overwrite the prior fact with NOT_FOUND. |
| Pending changes while old version remains public | Working, submitted, approved bank versions separately from observed public snapshot | A rejected or failed change does not become the public version. |
| Withdrawal / hidden / revoked | Request, decision, bank application, delivery and observed result separately | Lifecycle outcome must come from its own contract. Profile hidden is not all assets archived. Contact has no public page. |
| Archived | Retained content and history; no invented delete success | Archive is not hard delete. Destruction/retention policy is separate. |
| Stale/conflicting read | Clear conflict and reload path; preserve entered work where supported | API revalidates lock/version, permissions and references. Never auto-overwrite with a stale decision. |

The precise observation fields, legacy behavior, website-origin validation and
snapshot allowlist are in [PUBLIC-OBSERVATION.md](PUBLIC-OBSERVATION.md).
`CHECK_TIME_ONLY` means evidence at that time, not a timer declaring absence.
An unavailable legacy public version stays `UNAVAILABLE`, never copied from a draft.

## Pages, components and API

Frontend paths below are relative to the sibling `frontend-production` repository.
API paths below are relative to `/api/v1/seputar-jaminan`; all bank routes require
authentication plus route permission and service/RLS enforcement.

| Page under `/dashboard/seputar-jaminan` | Main component in `src/components/seputar-jaminan` | Read surface |
|---|---|---|
| `profil` | `SeputarJaminanProfileContactClient`, `SeputarJaminanProfileContext` | `/profile`, `/profile/public-observation`, `/media` |
| `kontak` | `SeputarJaminanProfileContactClient` | `/contacts`, `/contacts/:id`; direct revision resolves by ID, not matching name |
| `publikasi` | `SeputarJaminanCatalogClient`, `SeputarJaminanPublicationContent` | `/publications`, `/publications/:id`, `/publications/:id/public-observation`, `/taxonomy`, `/eligible-collaterals` |
| `pengajuan` | `SeputarJaminanSubmissionsClient` | `/submissions`, `/change-requests`; selected resource detail only with permission |
| Existing `pemeriksaan` route | `SeputarJaminanReviewClient` | `/reviews` and existing decision commands; authority still enforced |

Only the four menus above are the active bank work navigation. The existing
`pemeriksaan` route is a separate authority-guarded compatibility surface, not
an instruction to add a fifth menu. `/bantuan` and `/ringkasan` were removed;
do not restore them as redirects, replacement menus or hidden help panels.
Private dashboard/sync/history APIs and audit can remain without a matching UI.
Preserve only compatibility routes actually present in source, not old diagrams.

Shared bank primitives include `FeatureHeader`, `SetupDataTable`,
`SetupTableScroll`, `SearchableSelect`, `SetupState`, detail sections and existing
buttons/modals/notifications. Module-specific Workflow, Observation,
ProfileContext and PublicationContent compose those primitives. Removed history
timelines, Ringkasan and technical delivery tabs are not UI requirements.
`useSjListQuery` and `SjCursorNavigation` retain URL/Back/filter/cursor context.
No extra marketplace skin, theme system or component library is needed.

Frontend contract layers: `src/services/seputar-jaminan.service.ts`,
`seputar-jaminan.response.ts`, `src/types/seputar-jaminan.types.ts`.
Backend source map:

- `seputarJaminan.route.js`, controller and validation: endpoint permissions and strict input.
- `profileContact.service.js`, `seputarJaminan.service.js`, `submission.service.js`,
  `changeRequest.service.js`: versioned bank workflow and authority.
- `actionRead.js`: permission/state assessments; `readContract.js`, `readCursor.js`,
  `history.service.js`: allowlisted read contracts, stable ordering and history.
- `workflowLock.js`, `publicationLifecycle.js`, `contactUsage.js`: concurrency
  and old-approved/cross-division reference protection, backed by additive migrations.
- `syncWorker.service.js`, `outboxLease.js`, `controlSnapshotTarget.js`:
  claim/fencing/retry/target identity; actual worker at `src/workers/seputar-jaminan.worker.js`.
- `controlReview*`, `controlMonitoring*`, `reconciliationResponse.js`:
  signed Control authority and validated transport/monitoring contracts.
- `publicObservation.contract.js`, `publicObservation.service.js`:
  public-read validation and independent latest-attempt / last-success persistence.
- `media.service.js`, `mediaReadiness.js`: scoped private bank preview/upload,
  dependency readiness and reference-safe removal.
- `prisma/schema.prisma` plus additive migrations: version/snapshot/outbox/observation
  persistence. Never rewrite migration history to match a local ledger.

## Permission, count and failure rules

`action_availability` describes starting an action, not a guarantee it will
succeed. UI must fail closed on absent/stale assessment; backend always checks
again. Local maker/checker differs from central signed commands. Dedicated
reviewer credentials must not fall back to migration owner or system credentials.

Use server-supported filters/sort/cursors only. Invalid input is an error, not
silent reset. A page count is not a global count; filtered accessible totals
exclude records the actor cannot read. Do not fetch details per row to invent a
public status. Zero is valid; distinguish null/missing from zero.

Preserve stale display with an explicit refresh failure when appropriate; never
show a healthy worker after failed refresh. Heartbeat proves process liveness,
not successful queue drain. Retry is feature/permission guarded. An old event
bound to another installation stays failed; do not fabricate an ACK or rebind it.
Delivery is at least once plus receiver idempotency, not distributed exactly once.

## Safe preview and tests

Read [the isolated harness guide](../../integration/support/SJ-ISOLATED-TESTS.md)
and the scripts before execution. The five-mode entry is
`node scripts/run-sj-ci-gate.js`, launched from backend root after checking local
Docker and peer source identities. It creates its own scanner, databases, Redis
and storage, validates ownership and cleans only those resources. Never point it
at an existing workflow database. Positive business states come through services/API.
Double-based results are not real cross-app results.

For a read-only local preview, use a production snapshot of current FE source,
not an old `.next` or dev compilation timing. Keep the copied project, its build
and credentials outside the release tree; Next `distDir` must stay inside that
copied project. Configure a verified loopback read-only bank API and bind the
preview to loopback. Inspect listener ownership before starting a second server.
Never enable a normal outbox worker simply to view the UI. Authentication/session
writes are distinct from business mutations. Test account credentials stay local.

The RA-SJ-13 external checkpoint records exact current build/wrapper commands,
URLs and evidence; this portable guide intentionally does not embed machine secrets.
After any code change, rerun affected unit/contract/browser tests and rebuild as
needed. Bind every result to a source hash; a prior green report is not proof for
new code. Keep pass/fail/skip/not-run separate. Generic legacy integration files
with unsafe cleanup remain prohibited, not relabelled as passing.

## Future UI/content changes and release boundary

- Use plain Indonesian with a source for every status, reason, count and action.
- Keep actual observation time visible; no unapproved “tayang sekarang” promise.
- Long words, notes and URLs must wrap. Keep modal actions reachable on small
  screens; preserve keyboard, Escape, focus return, scroll lock and reduced motion.
- Use supported application theme only. Test CSS widths 360, 390, 768, 1024,
  1440 and native zoom 200%; shared-component changes require non-SJ regression.
- Use explicit field allowlists; never render raw envelope, tokens or private keys.
- Do not introduce fixture imports into normal runtime or add a public admin retry.
- Control and SJ changes require separate repository authority. The public source
  event version is not a bank revision and SJ ACK has no invented signature/checksum echo.
- Hosted CI on frozen exact peer commits, deployment configuration, production
  backups/restore/observability and VPS checks are separate acceptance gates.
  Local application and service integration success is not production approval.
