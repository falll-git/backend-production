# Public observation contract

An ACK is not evidence of public visibility. The bank records a completed read
of the public SJ API, bound to the expected identity, installation environment
and observation time. It does not promise current visibility, HTML rendering,
all image bytes, or visibility of every publication belonging to a profile.

## Profile content and versions

SJ institution detail can add `public_profile_version` from
`BprsProfile.sourceVersion`: the aggregate version of the applied profile event.
It is **not** the bank draft revision number. A successful bank observation
stores that value as `observed_version` and an allowlisted `profile_snapshot`:
public name, short description, city/province, published asset count and nullable
public page URL. Zero assets is valid. No bank-private fields or contacts are
copied into this snapshot.

The observation response uses `version_evidence: SOURCE_PROFILE_EVENT` only
when that version is present. Legacy peers/facts remain readable with a null
version and `UNAVAILABLE`; old facts are not backfilled from today's bank draft.
Publication detail optionally returns `public_asset_version` from the SJ
publication's applied `aggregateVersion`. This is an event version, not a bank
draft revision or a comparison of bank content checksums. The bank records it
with `version_evidence: SOURCE_PUBLICATION_EVENT` and an allowlisted
`publication_snapshot`: title, description, category, city/province, public
category attributes, photo count, public update time and nullable page URL.
Numbers including zero are retained. No WhatsApp number, raw image URL, internal
tenant ID or private payload is persisted in this snapshot. Missing legacy
version evidence remains null/UNAVAILABLE, never borrowed from the profile.
Approved, pending and working bank versions retain their separate semantics.

`last_success` is the latest valid completed observation, including a valid
NOT_FOUND result. `latest_attempt` is separate and may be FAILED or PENDING.
A timeout, offline response, invalid identity or malformed payload does not
replace the prior valid result. Freshness remains `CHECK_TIME_ONLY`: show the
actual time; no invented TTL or real-time claim. The existing observation
ownership, permission and conditional PENDING completion rules still apply.

## Website URL is separate from API origin

Set `SJ_PUBLIC_WEBSITE_ORIGIN` independently in the SJ API and bank API process
environments to the same actual public website origin for that environment.
This is an origin only: no credentials, path, query or fragment. HTTPS is
required except loopback HTTP used in local development. Never derive this
setting from `central_base_url` or an API listener port. No default/demo URL is
provided, and no frontend public environment variable is needed.

SJ detail returns a nullable `public_page_url` at `/bprs/{slug}` for profiles
or `/aset/{reference_code}` for publications. The bank checks
the independently configured origin plus the exact expected identity path
before storing it. If the bank's website environment changes, old facts remain
historical evidence but a mismatched old URL is withheld from the read response.
Absent configuration produces an honest unavailable-link state, not a fake
destination or a failed claim that all other profile evidence is absent.

Control-owned public observation was retired by user decision on 5 October
2026; do not restore its reader, DTO or UI from older documentation. This
bank/SJ observation contract remains active and separate from Control decisions,
signed ACKs and bank draft versions. Control's authority and acknowledgment
protocol remain unchanged. See `D:/ruwang-control/docs/control-simplification.md`.

## Schema and verification

Additive migration `20260922190000_sj_profile_observation_snapshot` introduces
the nullable JSON snapshot and valid observation/version constraint. Historical
migrations and existing observations are unchanged. Runtime ownership/RLS and
permissions remain enforced; migrations run only with the owner credential.

`20260923050000_sj_publication_observation_snapshot` adds the publication
snapshot, enforces mutually exclusive profile/publication evidence on AVAILABLE
records, and grants only column-scoped completion access. Existing facts are
not backfilled. A later NOT_FOUND fact has no public content snapshot. A FAILED
attempt cannot replace the last valid fact. The UI shows "Isi aset saat dicek"
separately from "Versi kerja di bank" and "Versi disetujui di bank".

Tests cover legacy absence, zero assets, invalid versions/URLs/private fields,
last-success retention, two actual approved profile events with a newer bank
draft in between, wrong website environment, and lifecycle withdrawal. Use the
guarded disposable harness described in
`../../integration/support/SJ-ISOLATED-TESTS.md`; never mutate an operational
database to make a public-observation test pass. Browser response fixtures are
additional UI evidence, not real multi-application integration evidence.
