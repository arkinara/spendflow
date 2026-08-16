import '../models/models.dart';

/// Fixture data for the mobile front end.
///
/// Phase 1 ships no mobile API, so every screen reads from here. The rows are
/// the same ones the web app and the Claude Design prototype use — Aulia
/// Pratiwi submitting in IDR to approver Dewi Anggraeni — which keeps the two
/// clients comparable while the endpoints are still being built.
class Fixtures {
  const Fixtures._();

  /* ---------------------------------------------------------------- */
  /* Session                                                          */
  /* ---------------------------------------------------------------- */

  static const String userName = 'Aulia Pratiwi';
  static const String userInitials = 'AP';
  static const String userEmail = 'aulia.pratiwi@spendflow.example';
  static const String userRole = 'Operations Specialist';
  static const String approverName = 'Dewi Anggraeni';
  static const String approverRole = 'Operations Manager';

  /// Fixed "today" so the fixtures read the same on every run.
  static const String todayLabel = 'Monday, 28 July';

  /* ---------------------------------------------------------------- */
  /* Policy                                                           */
  /* ---------------------------------------------------------------- */

  /// The six expense categories with their per-item caps.
  static const List<ExpenseCategory> categories = <ExpenseCategory>[
    ExpenseCategory(code: 'MEL', name: 'Meals', cap: 350000),
    ExpenseCategory(code: 'TAX', name: 'Taxi / Ride-hailing', cap: 250000),
    ExpenseCategory(code: 'HTL', name: 'Hotel', cap: 1200000, note: 'per night'),
    ExpenseCategory(code: 'FLT', name: 'Flight'),
    ExpenseCategory(code: 'KIL', name: 'Mileage', note: 'Rp 1.200 / km'),
    ExpenseCategory(code: 'OTH', name: 'Other', cap: 500000),
  ];

  static ExpenseCategory categoryByName(String name) => categories.firstWhere(
        (c) => c.name == name,
        orElse: () => categories.last,
      );

  /* ---------------------------------------------------------------- */
  /* Receipt facsimile                                                */
  /* ---------------------------------------------------------------- */

  /// Width the receipt is drawn at. Every OCR crop is a window onto this same
  /// widget at a fixed offset, so field ↔ source-row alignment holds.
  static const double receiptWidth = 242;

  static const List<ReceiptLine> receiptLines = <ReceiptLine>[
    ReceiptLine('WARUNG SEDERHANA', 13, 700, 0xFF20202A),
    ReceiptLine('Jl. Sudirman Kav 52, Jakarta', 10, 400, 0xFF8A8578),
    ReceiptLine('--------------------------------', 10, 400, 0xFFB9B5A8),
    ReceiptLine('15/07/2026        19:42 WIB', 10.5, 400, 0xFF3A3830),
    ReceiptLine('Nasi Goreng x2          90.000', 10.5, 400, 0xFF3A3830),
    ReceiptLine('Ayam Bakar              75.000', 10.5, 400, 0xFF3A3830),
    ReceiptLine('Es Teh Manis x3         30.000', 10.5, 400, 0xFF3A3830),
    ReceiptLine('Sate Ayam               85.000', 10.5, 400, 0xFF3A3830),
    ReceiptLine('Kerupuk + Sambal        73.000', 10.5, 400, 0xFF3A3830),
    ReceiptLine('--------------------------------', 10, 400, 0xFFB9B5A8),
    ReceiptLine('Subtotal               353.000', 10.5, 500, 0xFF3A3830),
    ReceiptLine('PPN 11%                 38.830', 10.5, 500, 0xFF3A3830),
    ReceiptLine('TOTAL IDR              391.830', 12, 700, 0xFF20202A),
    ReceiptLine('--------------------------------', 10, 400, 0xFFB9B5A8),
    ReceiptLine('Terima kasih  ::  No. 0421', 10, 400, 0xFF8A8578),
  ];

  /* ---------------------------------------------------------------- */
  /* OCR extraction                                                   */
  /* ---------------------------------------------------------------- */

  /// Tax comes back low-confidence on purpose: the confirmation screen has to
  /// prove that nothing is submitted straight from raw OCR.
  static const List<OcrFieldDef> ocrFields = <OcrFieldDef>[
    OcrFieldDef(
      key: OcrFieldKey.merchant,
      label: 'Merchant',
      cropTop: -2,
      confidence: FieldConfidence.high,
      helper: 'Read from the header line',
    ),
    OcrFieldDef(
      key: OcrFieldKey.date,
      label: 'Date',
      cropTop: -38,
      confidence: FieldConfidence.high,
      helper: 'Receipt timestamp, 15 Jul 2026',
    ),
    OcrFieldDef(
      key: OcrFieldKey.tax,
      label: 'Tax (PPN 11%)',
      cropTop: -150,
      confidence: FieldConfidence.low,
      helper: 'Faint print — please verify against the receipt',
    ),
    OcrFieldDef(
      key: OcrFieldKey.amount,
      label: 'Total amount',
      cropTop: -164,
      confidence: FieldConfidence.high,
      helper: 'IDR · matches subtotal + tax',
    ),
  ];

  static const OcrDraft initialDraft = OcrDraft(
    merchant: 'Warung Sederhana',
    date: '15/07/2026',
    amount: '391.830',
    tax: '38.830',
    currency: 'IDR',
    category: 'Meals',
    description: 'Team dinner with PT Nusantara',
  );

  static const String capturedFileName = 'IMG_0421';
  static const String capturedFileSize = '1.2 MB';

  static const String categoryConfidence =
      'High confidence · matched "Warung" + food items';

  /* ---------------------------------------------------------------- */
  /* Open draft claim                                                 */
  /* ---------------------------------------------------------------- */

  static const String draftClaimId = 'EXP-2026-1013';
  static const String draftClaimTitle = 'Q3 Client Visit – Jakarta';
  static const String draftClaimTrip = 'Jakarta · 12–14 Aug 2026';

  /// Lines already on the draft, before anything is captured.
  static const List<ClaimLine> draftBaseLines = <ClaimLine>[
    ClaimLine(
      code: 'FLT',
      description: 'Return flight CGK ⇄ SUB',
      meta: 'Flight · 12 Aug · Garuda Indonesia',
      amount: 2450000,
      file: 'eticket.pdf',
      source: LineSource.manual,
    ),
    ClaimLine(
      code: 'HTL',
      description: 'Hotel — 2 nights',
      meta: 'Hotel · 12 Aug · Rp 900.000 / night',
      amount: 1800000,
      file: 'hotel-invoice.pdf',
      source: LineSource.ocr,
    ),
  ];

  /* ---------------------------------------------------------------- */
  /* Claims                                                           */
  /* ---------------------------------------------------------------- */

  static const List<Claim> claims = <Claim>[
    Claim(
      id: 'EXP-2026-1001',
      code: 'Q2',
      title: 'Q2 Client Visit – Jakarta',
      place: 'Jakarta',
      status: ClaimStatus.pending,
      amount: 4787000,
      dateLabel: '21 Jul',
      itemCount: 5,
      receiptCount: 3,
      headline: 'Jakarta · 14–16 Jul 2026 · submitted 21 Jul 2026',
      slaLabel: 'SLA 1 day left',
      lines: <ClaimLine>[
        ClaimLine(
          code: 'FLT',
          description: 'Return flight CGK ⇄ SUB',
          meta: '14 Jul · eticket.pdf',
          amount: 2450000,
          source: LineSource.manual,
        ),
        ClaimLine(
          code: 'HTL',
          description: 'Hotel — 2 nights',
          meta: '14 Jul · 2 × Rp 900.000',
          amount: 1800000,
          source: LineSource.ocr,
        ),
        ClaimLine(
          code: 'MEL',
          description: 'Meals during trip',
          meta: '15 Jul · meals-receipt.jpg',
          amount: 320000,
          source: LineSource.ocr,
        ),
        ClaimLine(
          code: 'TAX',
          description: 'Airport & city taxis',
          meta: '14 Jul · no receipt needed',
          amount: 145000,
          source: LineSource.manual,
        ),
        ClaimLine(
          code: 'KIL',
          description: 'Personal car to airport',
          meta: '60 km × Rp 1.200',
          amount: 72000,
          source: LineSource.manual,
        ),
      ],
      timeline: <TimelineEntry>[
        TimelineEntry(
          title: 'Created',
          actor: userName,
          time: '20 Jul, 08:10',
          tone: TimelineTone.done,
        ),
        TimelineEntry(
          title: 'Submitted for approval',
          actor: '$userName · 5 line items, 3 receipts',
          time: '21 Jul, 09:32',
          tone: TimelineTone.done,
        ),
        TimelineEntry(
          title: 'Awaiting $approverName',
          actor: '$approverRole · SLA 1 day left',
          time: 'now',
          tone: TimelineTone.waiting,
          body:
              'Mileage line has no receipt — allowed under policy, but Dewi may ask for the trip log.',
        ),
        TimelineEntry(
          title: 'Finance payment run',
          actor: 'Not started',
          time: '—',
          tone: TimelineTone.pending,
        ),
      ],
    ),
    Claim(
      id: 'EXP-2026-1003',
      code: 'VW',
      title: 'Vendor Workshop – Bandung',
      place: 'Bandung',
      status: ClaimStatus.actionRequired,
      amount: 1235000,
      dateLabel: '18 Jul',
      itemCount: 3,
      receiptCount: 3,
      headline: 'Bandung · 16–17 Jul 2026 · returned 19 Jul 2026',
      lines: <ClaimLine>[
        ClaimLine(
          code: 'HTL',
          description: 'Hotel — 1 night',
          meta: '16 Jul · hotel-invoice.pdf',
          amount: 890000,
          source: LineSource.ocr,
        ),
        ClaimLine(
          code: 'MEL',
          description: 'Working lunch',
          meta: '17 Jul · lunch.jpg',
          amount: 195000,
          source: LineSource.ocr,
        ),
        ClaimLine(
          code: 'TAX',
          description: 'Airport transfer',
          meta: '16 Jul · grab.pdf',
          amount: 150000,
          source: LineSource.manual,
        ),
      ],
      timeline: <TimelineEntry>[
        TimelineEntry(
          title: 'Created',
          actor: userName,
          time: '18 Jul, 07:55',
          tone: TimelineTone.done,
        ),
        TimelineEntry(
          title: 'Submitted for approval',
          actor: '$userName · 3 line items',
          time: '18 Jul, 08:20',
          tone: TimelineTone.done,
        ),
        TimelineEntry(
          title: 'Returned for changes',
          actor: approverName,
          time: '19 Jul, 15:40',
          tone: TimelineTone.waiting,
          body:
              'Hotel invoice is illegible — please re-scan page 2 and resubmit.',
        ),
      ],
    ),
    Claim(
      id: 'EXP-2026-1006',
      code: 'TC',
      title: 'Training Conference – Bali',
      place: 'Bali',
      status: ClaimStatus.paid,
      amount: 5450000,
      dateLabel: '20 Jun',
      itemCount: 6,
      receiptCount: 5,
      headline: 'Bali · 15–19 Jun 2026 · paid 26 Jun 2026',
      lines: <ClaimLine>[
        ClaimLine(
          code: 'FLT',
          description: 'Return flight CGK ⇄ DPS',
          meta: '15 Jun · eticket.pdf',
          amount: 2100000,
          source: LineSource.manual,
        ),
        ClaimLine(
          code: 'HTL',
          description: 'Hotel — 4 nights',
          meta: '15 Jun · 4 × Rp 620.000',
          amount: 2480000,
          source: LineSource.ocr,
        ),
        ClaimLine(
          code: 'MEL',
          description: 'Conference dinners',
          meta: '17 Jun · dinner.jpg',
          amount: 480000,
          source: LineSource.ocr,
        ),
        ClaimLine(
          code: 'TAX',
          description: 'Airport transfers',
          meta: '19 Jun · grab.pdf',
          amount: 210000,
          source: LineSource.manual,
        ),
        ClaimLine(
          code: 'OTH',
          description: 'Materials printing',
          meta: '16 Jun · print.jpg',
          amount: 120000,
          source: LineSource.ocr,
        ),
        ClaimLine(
          code: 'KIL',
          description: 'Home to airport',
          meta: '50 km × Rp 1.200',
          amount: 60000,
          source: LineSource.manual,
        ),
      ],
      timeline: <TimelineEntry>[
        TimelineEntry(
          title: 'Created',
          actor: userName,
          time: '20 Jun, 09:12',
          tone: TimelineTone.done,
        ),
        TimelineEntry(
          title: 'Submitted for approval',
          actor: '$userName · 6 line items',
          time: '20 Jun, 09:40',
          tone: TimelineTone.done,
        ),
        TimelineEntry(
          title: 'Approved',
          actor: approverName,
          time: '22 Jun, 11:04',
          tone: TimelineTone.done,
        ),
        TimelineEntry(
          title: 'Paid',
          actor: 'Finance payment run',
          time: '26 Jun, 16:20',
          tone: TimelineTone.done,
        ),
      ],
    ),
    Claim(
      id: 'EXP-2026-1005',
      code: 'SI',
      title: 'Site Inspection – Semarang',
      place: 'Semarang',
      status: ClaimStatus.processing,
      amount: 2435000,
      dateLabel: '12 Jun',
      itemCount: 4,
      receiptCount: 4,
      headline: 'Semarang · 8–10 Jun 2026 · approved 13 Jun 2026',
      lines: <ClaimLine>[
        ClaimLine(
          code: 'HTL',
          description: 'Hotel — 2 nights',
          meta: '8 Jun · hotel-invoice.pdf',
          amount: 1400000,
          source: LineSource.ocr,
        ),
        ClaimLine(
          code: 'MEL',
          description: 'Site team meals',
          meta: '9 Jun · meals.jpg',
          amount: 340000,
          source: LineSource.ocr,
        ),
        ClaimLine(
          code: 'TAX',
          description: 'Local transport',
          meta: '9 Jun · grab.pdf',
          amount: 335000,
          source: LineSource.manual,
        ),
        ClaimLine(
          code: 'KIL',
          description: 'Plant to hotel',
          meta: '300 km × Rp 1.200',
          amount: 360000,
          source: LineSource.manual,
        ),
      ],
      timeline: <TimelineEntry>[
        TimelineEntry(
          title: 'Created',
          actor: userName,
          time: '12 Jun, 16:31',
          tone: TimelineTone.done,
        ),
        TimelineEntry(
          title: 'Submitted for approval',
          actor: '$userName · 4 line items',
          time: '12 Jun, 17:02',
          tone: TimelineTone.done,
        ),
        TimelineEntry(
          title: 'Approved',
          actor: approverName,
          time: '13 Jun, 10:02',
          tone: TimelineTone.done,
        ),
        TimelineEntry(
          title: 'In the payment run',
          actor: 'Finance · settles in 2 days',
          time: 'now',
          tone: TimelineTone.waiting,
        ),
      ],
    ),
  ];

  static Claim? claimById(String id) {
    for (final claim in claims) {
      if (claim.id == id) return claim;
    }
    return null;
  }

  /* ---------------------------------------------------------------- */
  /* Offline queue                                                    */
  /* ---------------------------------------------------------------- */

  static const List<QueueItem> queue = <QueueItem>[
    QueueItem(
      id: 'q1',
      title: 'Grab to client office',
      meta: 'Taxi · 26 Jul · captured offline',
      amount: 64000,
      size: 'JPG 0.8 MB',
    ),
    QueueItem(
      id: 'q2',
      title: 'Kopi Kenangan × 4',
      meta: 'Meals · 26 Jul · captured offline',
      amount: 112000,
      size: 'JPG 0.6 MB',
    ),
    QueueItem(
      id: 'q3',
      title: 'Warehouse Audit – Surabaya',
      meta: 'Draft claim · 2 line items',
      amount: 298000,
      size: 'draft',
    ),
  ];

  static int get queueHeldTotal =>
      queue.fold(0, (total, item) => total + item.amount);

  /* ---------------------------------------------------------------- */
  /* Approver inbox                                                   */
  /* ---------------------------------------------------------------- */

  static const List<InboxItem> inbox = <InboxItem>[
    InboxItem(
      id: 'EXP-2026-1001',
      submitter: userName,
      initials: 'AP',
      title: 'Q2 Client Visit – Jakarta',
      sub: '$userName · 5 items · 21 Jul',
      amount: 4787000,
      sla: '1d left',
      slaTone: SlaTone.info,
    ),
    InboxItem(
      id: 'EXP-2026-1005',
      submitter: 'Bima Nugroho',
      initials: 'BN',
      title: 'Site Inspection – Semarang',
      sub: 'Bima Nugroho · 4 items · 20 Jul',
      amount: 2435000,
      sla: 'Overdue',
      slaTone: SlaTone.error,
      flagText: '1 line over the meals cap · 1 missing receipt',
    ),
    InboxItem(
      id: 'EXP-2026-1009',
      submitter: 'Sari Wijaya',
      initials: 'SW',
      title: 'Regional Sales Sync – Medan',
      sub: 'Sari Wijaya · 7 items · 22 Jul',
      amount: 4510000,
      sla: '2d left',
      slaTone: SlaTone.ok,
    ),
  ];

  /* ---------------------------------------------------------------- */
  /* Home metrics                                                     */
  /* ---------------------------------------------------------------- */

  /// Pending total before the open draft is submitted.
  static const int pendingBaseTotal = 4787000;
  static const int reimbursedTotal = 5450000;
}
