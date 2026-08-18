# SpendFlow Mobile

Flutter front end for SpendFlow, targeting **Android and iOS** from one codebase.
It implements the mobile design captured in Claude Design
(`SpendFlow Mobile.dc.html`): OCR receipt capture, an explicit confirmation step,
offline drafts with a sync queue, and an approver inbox.

This is the front end only. There is **no backend wiring yet** — every screen
reads from `lib/data/fixtures.dart`. See [Not built yet](#not-built-yet).

## Run it

```bash
cd mobile
flutter pub get
flutter run                 # attached device or emulator
flutter run -d chrome       # not configured — Android/iOS only
```

```bash
flutter test        # 30 unit + widget tests
flutter analyze     # clean
```

Building for iOS requires macOS and Xcode; the Android target builds anywhere.

## The flow

```
login → home ──FAB──► capture ──shutter──► scan ──► confirm ──► draft ──► submit
                                                                  │          │
                                                       offline ───┘          ▼
                                                          ▼               success
                                                        queue ──sync──► submitted
```

| Screen | File | What it is for |
| --- | --- | --- |
| Sign in | `screens/login_screen.dart` | Pre-filled hand-off; no auth backend yet |
| Home | `screens/home_screen.dart` | Greeting, in-flight metrics, claim ledger, offline banner |
| Claims | `screens/claims_screen.dart` | All claims, split open / settled |
| Capture | `screens/capture_screen.dart` | Viewfinder, torch, auto-crop, multi-page strip, scan |
| Confirm | `screens/confirm_screen.dart` | Extracted fields beside their source crops |
| Draft | `screens/draft_screen.dart` | Line items, policy flags, running total, submit |
| Queue | `screens/queue_screen.dart` | What is held on device and an explicit sync |
| Success | `screens/success_screen.dart` | Reference, amount, approver, flags |
| Claim detail | `screens/claim_detail_screen.dart` | Status timeline + line items |
| Approvals | `screens/approvals_screen.dart` | Approver inbox with SLA and exception badges |

Three rules the screens exist to enforce:

- **Nothing submits from raw OCR.** The confirmation screen puts every field
  next to the receipt row it was read from. The tax field comes back
  low-confidence and carries an amber `CHECK THIS` chip.
- **Policy flags never block.** An over-cap line says so inline, then submits
  anyway and routes to Finance as an exception.
- **Sync is never silent.** Each queued item carries its own badge, and the
  sync button says exactly what it will do.

## Layout

```
lib/
  main.dart              entrypoint, portrait lock
  app.dart               MaterialApp + named routes
  state/app_state.dart   one ChangeNotifier for the whole session
  data/fixtures.dart     all fixture data (the future API boundary)
  models/models.dart     Claim, ClaimLine, OcrDraft, QueueItem, InboxItem…
  theme/                 M3 ColorScheme + SpendFlowTokens extension
  widgets/               receipt facsimile, chips, timeline, cards
  screens/               one file per screen
```

State lives in a single `AppState` because the capture → confirm → draft →
submit → sync journey spans routes but shares one context (the OCR draft, the
network mode, the local queue). `AppScope.of(context)` subscribes;
`AppScope.read(context)` fires actions without rebuilding.

## Design tokens

The Material 3 palette matches the web app's `frontend/app/globals.css`
one-for-one, so a claim card reads identically on either surface. Roles M3 has
no slot for — success / warning / info and the extra surface-container steps —
live in the `SpendFlowTokens` theme extension (`theme/tokens.dart`).

Inter is asked for by name but **not bundled**; the app falls back to the
platform UI font (Roboto on Android, SF on iOS). Bundle the TTFs under
`pubspec.yaml`'s `fonts:` section if exact brand metrics are needed.

## Design variants

The design review left five alternatives worth deciding between. Long-press the
**SpendFlow wordmark** on the home app bar to switch:

| Variant | What changes |
| --- | --- |
| Default | As designed |
| Capture · multi-page | Shutter stacks up to 3 pages into one expense |
| Offline · quiet | No standing banner; nav badge and per-item chips only |
| Home · dense ledger | Status moves to the badge colour, ~2× claims per screen |
| Home · editorial | One indigo slab with the money leading, no metric cards |

## Phase 2 status — productionized (2026-08-18)

The Phase 2 mobile productionization epic (#98-#104) is closed. The gaps
below from the original Phase 2 commit are all CLOSED:

| Original gap | Status | How |
|---|---|---|
| No backend / HTTP client / auth | ✅ CLOSED | `HttpClient` seam with httpOnly cookie jar (`lib/api/http_client.dart`, #89); real email+password form hitting `/api/auth/sign-in/email` (`lib/screens/login_screen.dart`, #102); `ClaimRepository` seam with `FixturesClaimRepository` (demo) + `RestClaimRepository` (live) (#90-#92) |
| No camera / real OCR | ✅ CLOSED | Live `CameraPreview` viewfinder (#94); on-device OCR via `google_mlkit_text_recognition` — `MlKitOcrPass` (#99). The old `ServerOcrPass` (server-OCR assumption) was deleted as dead code. |
| No on-device persistence | ✅ CLOSED | `LocalStore` seam: `shared_preferences` for settings, `hive_flutter` for queue/draft/inbox; `AppState.create()` hydrates before the first frame (#93) |
| Light theme only | ✅ CLOSED | Full M3 dark scheme + ThemeMode toggle in Settings (#95) |
| No push notifications | ⏳ still open | The bell is still decorative. Follow-up when push infra is decided. |
| No receipt storage | ✅ CLOSED | `POST /api/mobile/receipts` uploads JPEG (multipart) to the storage driver seam — local disk by default, S3/R2 when `SPENDFLOW_STORAGE_DRIVER=s3` (#76 + #103) |

## Not built yet (remaining follow-ups)

- **Push notifications** — decorative bell only.
- **Sync idempotency keys** — a retry after a network drop can
  double-submit (#100 caveat).
- **Receipt dedup** — re-uploading the same file creates a new key
  (#103 caveat).
- **1 latent test bug** — `capture_flow_test.dart` "the queue syncs
  and reports it": `FixturesClaimRepository.sync()` resolves
  instantly, so the intermediate "Syncing…" state is never observable
  in a frame. Not a product bug; flagged in #98.
- **Real-device pass** — camera permission flows, ML Kit on hardware,
  and an R2 bucket with real credentials are the user's
  laptop/device verification steps, not code.
