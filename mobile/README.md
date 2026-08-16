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

## Not built yet

Deliberate gaps, all front-end-only consequences of there being no mobile API:

- **No backend.** No HTTP client, no auth, no token storage. `Fixtures` is the
  seam to replace.
- **No camera.** The viewfinder is a drawn stand-in and the OCR pass is a timer.
  A camera plugin plus a real OCR call replaces `AppState.shoot()`.
- **No on-device persistence.** The queue is in memory and resets on restart.
- **No push notifications.** The bell is decorative.
- **Light theme only.** The mobile design specifies light; the web app's dark
  palette has no mobile counterpart yet.
