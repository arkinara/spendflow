/// Domain models for the mobile client.
///
/// These mirror the Phase 1 web app's shapes closely enough that swapping the
/// fixture source for the REST API later is a parsing change, not a redesign.
library;

import 'dart:ui' show Rect;

/// Claim lifecycle, same vocabulary as the backend's `ClaimStatus`.
enum ClaimStatus {
  draft('Draft'),
  pending('Pending Approval'),
  actionRequired('Action Required'),
  approved('Approved'),
  processing('Processing'),
  paid('Paid'),
  rejected('Rejected');

  const ClaimStatus(this.label);

  final String label;
}

/// Where a line item's data came from. OCR lines carry the "OCR confirmed"
/// marker so an approver can tell them from typed entries.
enum LineSource { ocr, manual }

class ExpenseCategory {
  const ExpenseCategory({
    required this.code,
    required this.name,
    this.cap,
    this.note,
  });

  /// Three-letter code shown in the square row icon.
  final String code;
  final String name;

  /// Per-item policy cap in IDR. Null means the category is uncapped.
  final int? cap;

  /// Extra policy detail, e.g. "per night" or the mileage rate.
  final String? note;
}

class ClaimLine {
  const ClaimLine({
    required this.code,
    required this.description,
    required this.meta,
    required this.amount,
    required this.source,
    this.file,
    this.flagText,
  });

  final String code;
  final String description;
  final String meta;
  final int amount;
  final LineSource source;
  final String? file;

  /// Set when the line breaches policy — it still submits, but routes to
  /// Finance for exception review.
  final String? flagText;

  bool get isFlagged => flagText != null;
}

/// One node of the claim's audit trail, mirroring the web timeline.
enum TimelineTone { done, waiting, pending }

class TimelineEntry {
  const TimelineEntry({
    required this.title,
    required this.actor,
    required this.time,
    required this.tone,
    this.body,
  });

  final String title;
  final String actor;
  final String time;
  final TimelineTone tone;
  final String? body;
}

class Claim {
  const Claim({
    required this.id,
    required this.code,
    required this.title,
    required this.place,
    required this.status,
    required this.amount,
    required this.dateLabel,
    required this.itemCount,
    required this.receiptCount,
    required this.headline,
    required this.lines,
    required this.timeline,
    this.slaLabel,
  });

  final String id;

  /// Two-letter badge on the claim row (Q3, VW, TC…).
  final String code;
  final String title;
  final String place;
  final ClaimStatus status;
  final int amount;
  final String dateLabel;
  final int itemCount;
  final int receiptCount;

  /// Sub-line on the detail header, e.g. "Jakarta · 14–16 Jul 2026".
  final String headline;
  final List<ClaimLine> lines;
  final List<TimelineEntry> timeline;
  final String? slaLabel;
}

/// Sync state of one locally-held capture.
enum QueueState { queued, syncing, synced }

class QueueItem {
  const QueueItem({
    required this.id,
    required this.title,
    required this.meta,
    required this.amount,
    required this.size,
  });

  final String id;
  final String title;
  final String meta;
  final int amount;

  /// On-device footprint, e.g. "JPG 0.8 MB".
  final String size;

  /// Plain-map serialization for the on-device store (#93) — no Hive type
  /// adapters, no codegen.
  Map<String, dynamic> toJson() => <String, dynamic>{
        'id': id,
        'title': title,
        'meta': meta,
        'amount': amount,
        'size': size,
      };

  factory QueueItem.fromJson(Map<String, dynamic> json) => QueueItem(
        id: json['id'] as String,
        title: json['title'] as String,
        meta: json['meta'] as String,
        amount: (json['amount'] as num).toInt(),
        size: json['size'] as String,
      );
}

enum SlaTone { info, error, ok }

class InboxItem {
  const InboxItem({
    required this.id,
    required this.submitter,
    required this.initials,
    required this.title,
    required this.sub,
    required this.amount,
    required this.sla,
    required this.slaTone,
    this.flagText,
  });

  final String id;
  final String submitter;
  final String initials;
  final String title;
  final String sub;
  final int amount;
  final String sla;
  final SlaTone slaTone;
  final String? flagText;

  bool get isFlagged => flagText != null;

  /// Plain-map serialization for the on-device store (#93).
  Map<String, dynamic> toJson() => <String, dynamic>{
        'id': id,
        'submitter': submitter,
        'initials': initials,
        'title': title,
        'sub': sub,
        'amount': amount,
        'sla': sla,
        'slaTone': slaTone.name,
        if (flagText != null) 'flagText': flagText,
      };

  factory InboxItem.fromJson(Map<String, dynamic> json) => InboxItem(
        id: json['id'] as String,
        submitter: json['submitter'] as String,
        initials: json['initials'] as String,
        title: json['title'] as String,
        sub: json['sub'] as String,
        amount: (json['amount'] as num).toInt(),
        sla: json['sla'] as String,
        slaTone: SlaTone.values.byName(json['slaTone'] as String),
        flagText: json['flagText'] as String?,
      );
}

/// Confidence the OCR pass reports per field. Low-confidence fields get an
/// amber "CHECK THIS" chip and are never submitted unreviewed.
enum FieldConfidence { high, low }

enum OcrFieldKey { merchant, date, tax, amount }

class OcrFieldDef {
  const OcrFieldDef({
    required this.key,
    required this.label,
    required this.cropTop,
    required this.confidence,
    required this.helper,
  });

  final OcrFieldKey key;
  final String label;

  /// Vertical offset, in receipt-facsimile pixels, that scrolls this field's
  /// source row into the crop window beside the input.
  final double cropTop;
  final FieldConfidence confidence;
  final String helper;
}

/// The editable result of one scan, before it becomes a claim line.
class OcrDraft {
  const OcrDraft({
    required this.merchant,
    required this.date,
    required this.amount,
    required this.tax,
    required this.currency,
    required this.category,
    required this.description,
  });

  final String merchant;
  final String date;

  /// Kept as the raw "391.830" string so the user edits exactly what was read.
  final String amount;
  final String tax;
  final String currency;
  final String category;
  final String description;

  OcrDraft copyWith({
    String? merchant,
    String? date,
    String? amount,
    String? tax,
    String? currency,
    String? category,
    String? description,
  }) {
    return OcrDraft(
      merchant: merchant ?? this.merchant,
      date: date ?? this.date,
      amount: amount ?? this.amount,
      tax: tax ?? this.tax,
      currency: currency ?? this.currency,
      category: category ?? this.category,
      description: description ?? this.description,
    );
  }

  String valueOf(OcrFieldKey key) => switch (key) {
        OcrFieldKey.merchant => merchant,
        OcrFieldKey.date => date,
        OcrFieldKey.tax => tax,
        OcrFieldKey.amount => amount,
      };

  OcrDraft withField(OcrFieldKey key, String value) => switch (key) {
        OcrFieldKey.merchant => copyWith(merchant: value),
        OcrFieldKey.date => copyWith(date: value),
        OcrFieldKey.tax => copyWith(tax: value),
        OcrFieldKey.amount => copyWith(amount: value),
      };

  /// Plain-map serialization for the on-device store (#93) — a kill during
  /// capture must not lose the in-progress draft.
  Map<String, dynamic> toJson() => <String, dynamic>{
        'merchant': merchant,
        'date': date,
        'amount': amount,
        'tax': tax,
        'currency': currency,
        'category': category,
        'description': description,
      };

  factory OcrDraft.fromJson(Map<String, dynamic> json) => OcrDraft(
        merchant: json['merchant'] as String,
        date: json['date'] as String,
        amount: json['amount'] as String,
        tax: json['tax'] as String,
        currency: json['currency'] as String,
        category: json['category'] as String,
        description: json['description'] as String,
      );
}

/// One field read off a frame by an [OcrPass], with the OCR pass's own
/// confidence and the source-row box on the receipt it was read from.
///
/// The [bbox] is the source-row rectangle from the receipt facsimile. When it
/// is null the confirmation screen falls back to the hard-coded `cropTop` from
/// [OcrFieldDef] — back-compat until real OCR output is wired through.
class FieldResult {
  const FieldResult({
    required this.value,
    required this.confidence,
    this.bbox,
  });

  final String value;
  final FieldConfidence confidence;

  /// Null means "no box known — use the facsimile default".
  final Rect? bbox;

  Map<String, dynamic> toJson() => <String, dynamic>{
        'value': value,
        'confidence': confidence.name,
        if (bbox != null)
          'bbox': <String, double>{
            'left': bbox!.left,
            'top': bbox!.top,
            'right': bbox!.right,
            'bottom': bbox!.bottom,
          },
      };

  factory FieldResult.fromJson(Map<String, dynamic> json) => FieldResult(
        value: '${json['value'] ?? ''}',
        confidence: _confidenceByName(json['confidence']),
        bbox: _bboxFrom(json['bbox']),
      );

  static FieldConfidence _confidenceByName(Object? raw) {
    for (final value in FieldConfidence.values) {
      if (value.name == raw) return value;
    }
    return FieldConfidence.low;
  }

  static Rect? _bboxFrom(Object? raw) {
    if (raw is! Map<String, dynamic>) return null;
    return Rect.fromLTRB(
      (raw['left'] as num).toDouble(),
      (raw['top'] as num).toDouble(),
      (raw['right'] as num).toDouble(),
      (raw['bottom'] as num).toDouble(),
    );
  }
}

/// The full read of one captured frame: the flat field values plus the
/// per-field confidence/bbox the OCR pass reports.
class OcrResult {
  const OcrResult({
    required this.merchant,
    required this.date,
    required this.amount,
    required this.tax,
    required this.currency,
    required this.category,
    required this.description,
    this.fields = const <OcrFieldKey, FieldResult>{},
    this.receiptUrl,
  });

  final String merchant;
  final String date;
  final String amount;
  final String tax;
  final String currency;
  final String category;
  final String description;

  /// Per-field confidence + source box. The flat strings above stay the
  /// editable draft values; this map is the extra signal the confirm screen
  /// uses (currently ignored — `cropTop` still drives [ReceiptCrop]).
  final Map<OcrFieldKey, FieldResult> fields;

  /// Durable storage reference for the captured frame (#103) — the URL the
  /// BE returned after the image upload. Metadata about the source image, not
  /// an editable field: [toOcrDraft] deliberately drops it.
  final String? receiptUrl;

  OcrResult copyWith({String? receiptUrl}) => OcrResult(
        merchant: merchant,
        date: date,
        amount: amount,
        tax: tax,
        currency: currency,
        category: category,
        description: description,
        fields: fields,
        receiptUrl: receiptUrl ?? this.receiptUrl,
      );

  /// Flatten into the [OcrDraft] shape the capture → confirm flow edits and
  /// persists. The per-field confidence/bbox are not part of that shape yet,
  /// and neither is [receiptUrl] — the URL is source metadata, not an
  /// editable field (#103).
  OcrDraft toOcrDraft() => OcrDraft(
        merchant: merchant,
        date: date,
        amount: amount,
        tax: tax,
        currency: currency,
        category: category,
        description: description,
      );

  Map<String, dynamic> toJson() => <String, dynamic>{
        'merchant': merchant,
        'date': date,
        'amount': amount,
        'tax': tax,
        'currency': currency,
        'category': category,
        'description': description,
        'fields': <String, dynamic>{
          for (final entry in fields.entries)
            entry.key.name: entry.value.toJson(),
        },
        if (receiptUrl != null) 'receiptUrl': receiptUrl,
      };

  factory OcrResult.fromJson(Map<String, dynamic> json) {
    final fields = <OcrFieldKey, FieldResult>{};
    final rawFields = json['fields'];
    if (rawFields is Map<String, dynamic>) {
      for (final key in OcrFieldKey.values) {
        final raw = rawFields[key.name];
        if (raw is Map<String, dynamic>) {
          fields[key] = FieldResult.fromJson(raw);
        }
      }
    }
    return OcrResult(
      merchant: '${json['merchant'] ?? ''}',
      date: '${json['date'] ?? ''}',
      amount: '${json['amount'] ?? ''}',
      tax: '${json['tax'] ?? ''}',
      currency: '${json['currency'] ?? ''}',
      category: '${json['category'] ?? ''}',
      description: '${json['description'] ?? ''}',
      fields: fields,
      receiptUrl: json['receiptUrl'] is String ? json['receiptUrl'] as String : null,
    );
  }
}

/// One printed line of the receipt facsimile.
class ReceiptLine {
  const ReceiptLine(this.text, this.size, this.weight, this.color);

  final String text;
  final double size;
  final int weight;
  final int color;
}
