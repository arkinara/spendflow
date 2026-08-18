# Phase 2 mobile productionization epic (#104)

Type: Epic

## Sequence
Parent epic for #98, #76, #99, #100, #101, #102, #103.

## Parent epic
None — top-level epic. Successor to #97 ("Phase 2 mobile — wire to backend
and close gaps", covering #89-#97: repository seam, screen wiring,
persistence, camera + OCR contract, dark theme, debug gate). #97 wired the
mobile app's screens to a `ClaimRepository` abstraction and got the app
functionally complete against fixtures/mock data. This epic is the next
phase: make the wired app production-real — a genuine on-device OCR
pipeline instead of a server stub that was never built, real backend
endpoints for sync/decisions, real auth, and durable receipt image storage.

## Description
Three planning corrections were made before this epic was finalized, worth
recording so the reasoning isn't re-derived later:

1. Child count is 7 (6 children + this 1 parent), not 8.
2. #98's actual root cause is a one-line SDK constraint: `mobile/pubspec.yaml`
   pins `sdk: ^3.5.0`, but `mobile/lib/screens/home_screen.dart:655`
   already uses a duplicate-wildcard pattern
   (`separatorBuilder: (_, _) => ...`) that only analyzes clean under Dart
   3.8+. The fix is bumping the constraint, not touching the orthogonal
   uncommitted `mobile/analysis_options.yaml` exclude-list diff sitting in
   the working tree.
3. #99 is on-device mobile OCR (`google_mlkit_text_recognition`), not a
   backend endpoint. The originally-planned `/api/mobile/ocr` BE endpoint
   is cut entirely — `ServerOcrPass` (`mobile/lib/data/server_ocr_pass.dart`),
   which POSTs to that never-built endpoint, is dead code and gets deleted
   as part of #99.

With that locked, the remaining tickets close the gap between "wired to an
abstraction" (#97's outcome) and "usable by a real employee with a real
receipt": real OCR, real backend persistence for drafts/sync/decisions, a
verified data-shape contract between web and mobile, real authentication,
and durable receipt image storage.

## Reference
- #97 — predecessor epic, screens wired to `ClaimRepository`
- #94 — original `OcrPass` seam + `ServerOcrPass` stub (now being replaced)
- #88 — `POST /api/mobile/claims`, the claim-creation endpoint these
  tickets extend/map into
- `mobile/lib/data/claim_repository.dart` — the interface every mobile
  ticket in this epic is filling in against a real backend

## Sub-features
Each is its own ticket; see the child ticket bodies for full Goal/DoD.

### 1. #98 — bump Dart SDK constraint to ^3.8.0
**Goal**: fix 3 pre-existing analyzer errors with a 1-line pubspec change.
**DoD**: see #98.

### 2. #76 — S3/R2 receipt storage (already on the board, do first)
**Goal**: durable cloud storage for receipt attachments, replacing local
filesystem.
**DoD**: see #76 (pre-existing ticket, unchanged by this epic).

### 3. #99 — MlKitOcrPass, on-device OCR
**Goal**: real receipt text recognition without a server round trip;
removes dead `ServerOcrPass` code.
**DoD**: see #99.

### 4. #100 — BE mobile sync endpoints
**Goal**: drafts, offline-queue sync, and approver decisions persist
server-side.
**DoD**: see #100.

### 5. #101 — OcrDraft mapper + shape audit
**Goal**: on-device OCR output maps cleanly to the BE's typed line items;
web/mobile Claim and InboxItem shapes verified identical.
**DoD**: see #101.

### 6. #102 — real mobile auth
**Goal**: real email/password sign-in against the backend, demo sign-in
demoted behind `kDebugMenu`.
**DoD**: see #102.

### 7. #103 — receipt image round trip
**Goal**: captured image durably stored (via #76) and shown back on claim/
inbox detail screens.
**DoD**: see #103.

## Positive AC
- [ ] All 6 child tickets (#98, #99, #100, #101, #102, #103) merged and
      closed, plus #76 (pre-existing, tracked as a dependency)
- [ ] A real employee can sign in with real credentials, capture a real
      receipt, get it read on-device, submit it, have it durably stored
      with the image retrievable, and have an approver see and decide on it
      — all against the real backend, no fixtures
- [ ] `flutter analyze` and `flutter test` clean in `mobile/`; backend test
      suite green

## Negative AC
- [ ] No child ticket reintroduces a server-side OCR endpoint — the
      on-device decision is locked
- [ ] No child ticket is closed with the demo/fixture path still the
      default for the live app build

## Tasks
- [ ] Track child ticket merges in dependency order: #98 → #76 → #99 →
      #100 → #101 → #102 → #103
- [ ] Once all children are closed, do a full E2E pass on a real device
      (real camera, real backend, real S3/R2 bucket) covering: sign in,
      capture, confirm, submit, sync from offline, approver decide, receipt
      image visible throughout
- [ ] Close this epic once the E2E pass is clean and all children are merged

## Out of scope
- Any feature not already covered by one of the 6 child tickets or #76
- Multi-page receipt capture, receipt itemization beyond a single
  base+tax pair, SSO, password reset on mobile — each explicitly deferred
  in its owning child ticket's Out of scope section

## Honest caveats
- Several child tickets (#99's real recognizer behavior, #103's full S3
  round trip) cannot be fully verified without a physical device with a
  camera and a real or locally-emulated S3-compatible bucket. Each child
  ticket's own Honest caveats section flags this; the epic-level E2E QA
  pass (final task above) is where that verification actually has to
  happen, not in any individual child ticket's automated test suite.
- This epic assumes #76 lands cleanly on its own timeline — #103 is fully
  blocked on it and cannot start early. If #76 slips, #103 slips with it;
  the other 5 children (#98, #99, #100, #101, #102) do not depend on #76
  and can proceed regardless.
