# Simpan draf / simpan dan ajukan

New endpoints under `/api/v1/seputar-jaminan`:

- `POST /profile/save-operations/:id`
- `POST /contacts/save-operations/:id`
- `POST /publications/save-operations/:id`
- `GET /save-operations/:id`

`:id` is a client-generated UUID for one immutable request. The POST body is
`{ intent: 'SAVE_DRAFT' | 'SAVE_AND_SUBMIT', resource_id?, draft }`. Profile
does not accept `resource_id`. Updates require the existing `expected_version`
inside `draft`. Existing draft validators remain authoritative.

Read plus create/update permission is required for the appropriate resource;
combined submission additionally requires update. Actor-bound receipts use
FORCE RLS and publication scope. Another actor cannot inspect a receipt even
when the operation UUID is known. No worker/admin retry endpoint is exposed.

## Atomicity and versions

The existing save and submit services share one RLS transaction. Submission
uses the ID and lock version returned by save, never the original form version.
Validation, media/contact readiness, authority, contributor and reviewer rules
are unchanged. A submission failure rolls back the save too. Uploaded files
remain separate existing media resources; saving does not bypass their scanner.

An actor + operation advisory lock serializes identical retries. The payload
checksum rejects a different payload with the same key. An immutable receipt is
inserted in the same transaction as the business changes. It contains only
operation/kind/intent/resource ID/lock version/state/completion time. It does not
claim delivery, public visibility or approval.

`SAVE_DRAFT` returns `DRAFT`; completed `SAVE_AND_SUBMIT` returns `IN_REVIEW`.
For a NEW publication only, photos need its committed ID before the existing
worker can process them. If dependencies are not ready, the transaction retains
the draft and returns `DRAFT` plus `submission_error` in its immutable receipt.
UI says “Draf tersimpan, tetapi belum diajukan” and opens that exact draft.
After media is ready the user submits that ID/version; no automatic submission,
replacement draft, or scanner bypass. Replaying the initial operation returns
the same DRAFT receipt even if the resource later advances. Other errors and
updates still roll back the whole operation. Standalone APIs are preserved.

## Lost responses

GET returns `COMPLETED` with the validated receipt, or `NOT_RECORDED` with null.
Absence alone is not proof that an in-flight request failed. The editor keeps
the original request/key while uncertain, blocks editing/closing, checks the
receipt, then retries the exact same request only after a successful check.
It never substitutes the latest edited fields into an unresolved operation.
Failed checking remains uncertain. A rejected same-key business replay plus an
absent receipt allows correction; a failed network/auth read does not.

There is no silent autosave and no background submission on upload/close.
Browser unload warns about unsaved/pending changes. Request payloads are held
in memory, not persisted in localStorage. Closing the tab discards unsaved form
contents; reopening requires reading current server data. Existing unique-source,
contact-identity and optimistic-lock constraints remain in force.

## Migration and verification

Apply additive `20260927010000_sj_save_operation_receipts` through the normal
reviewed migration workflow before enabling this frontend against a runtime.
The receipt is a SQL-only infrastructure table accessed with parameterized raw
queries; no Prisma business model or generated client change is required.
Do not alter a historical migration or reset an existing database.

Tests are in `saveOperation.test.js`, `transaction-boundary.test.js`, and the
ownership-verified `sj-save-operation-scenario.js`/workflow/central scenarios.
Run the disposable harness only after inspecting its guard and environment.
Contract peers are test doubles, not proof of real Control/SJ integration.
