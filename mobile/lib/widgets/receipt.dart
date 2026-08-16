import 'package:flutter/material.dart';

import '../data/fixtures.dart';
import '../theme/app_theme.dart';
import '../theme/tokens.dart';

/// The captured receipt, drawn rather than shipped as an image asset.
///
/// Every OCR crop on the confirmation screen is a window onto this same widget
/// at a fixed offset, so a field always lines up with the row it was read from
/// — no bitmaps, no per-device coordinate maths.
class ReceiptFacsimile extends StatelessWidget {
  const ReceiptFacsimile({super.key});

  @override
  Widget build(BuildContext context) {
    return Container(
      width: Fixtures.receiptWidth,
      color: SpendFlowTokens.of(context).receiptPaper,
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisSize: MainAxisSize.min,
        children: <Widget>[
          for (final line in Fixtures.receiptLines)
            SizedBox(
              height: 14,
              width: double.infinity,
              child: Text(
                line.text,
                maxLines: 1,
                softWrap: false,
                overflow: TextOverflow.clip,
                style: TextStyle(
                  fontSize: line.size,
                  height: 14 / line.size,
                  fontWeight: FontWeight.values[(line.weight ~/ 100) - 1],
                  color: Color(line.color),
                  letterSpacing: -0.2,
                  fontFamily: kMonoFallback.first,
                  fontFamilyFallback: kMonoFallback.sublist(1),
                ),
              ),
            ),
        ],
      ),
    );
  }
}

/// A fixed-height window onto the receipt, scrolled to [offsetY].
///
/// Used beside each extracted field so the number in the input can be checked
/// against the print it came from without leaving the screen.
class ReceiptCrop extends StatelessWidget {
  const ReceiptCrop({
    required this.offsetY,
    required this.borderColor,
    required this.borderWidth,
    this.tint,
    this.height = 46,
    super.key,
  });

  final double offsetY;
  final Color borderColor;
  final double borderWidth;

  /// Wash over the crop when the field is focused or low-confidence.
  final Color? tint;
  final double height;

  @override
  Widget build(BuildContext context) {
    final tokens = SpendFlowTokens.of(context);
    return Container(
      height: height,
      clipBehavior: Clip.hardEdge,
      decoration: BoxDecoration(
        color: tokens.receiptPaper,
        borderRadius: Radii.sm,
        border: Border.all(color: borderColor, width: borderWidth),
      ),
      child: Stack(
        children: <Widget>[
          Positioned(
            left: 6,
            top: offsetY,
            child: const ReceiptFacsimile(),
          ),
          if (tint != null)
            Positioned.fill(child: IgnorePointer(child: ColoredBox(color: tint!))),
        ],
      ),
    );
  }
}

/// Full-height receipt on a modal sheet, reached from the "Zoom" affordance.
class ReceiptSheet extends StatelessWidget {
  const ReceiptSheet({super.key});

  static Future<void> show(BuildContext context) {
    return showModalBottomSheet<void>(
      context: context,
      showDragHandle: true,
      isScrollControlled: true,
      builder: (_) => const ReceiptSheet(),
    );
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final tokens = SpendFlowTokens.of(context);
    return SafeArea(
      top: false,
      child: Padding(
        padding: const EdgeInsets.fromLTRB(16, 0, 16, 24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: <Widget>[
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: <Widget>[
                const Text(
                  'Captured receipt',
                  style: TextStyle(fontSize: 14, fontWeight: FontWeight.w600),
                ),
                Text(
                  '${Fixtures.capturedFileName} · ${Fixtures.capturedFileSize}',
                  style: TextStyle(
                    fontSize: 11,
                    color: theme.colorScheme.onSurfaceVariant,
                  ),
                ),
              ],
            ),
            const SizedBox(height: 12),
            Flexible(
              child: SingleChildScrollView(
                child: Container(
                  padding: const EdgeInsets.all(10),
                  decoration: BoxDecoration(
                    color: tokens.receiptPaper,
                    borderRadius: Radii.lg,
                    border: Border.all(color: theme.colorScheme.outlineVariant),
                  ),
                  child: const Center(child: ReceiptFacsimile()),
                ),
              ),
            ),
            const SizedBox(height: 10),
            Text(
              'Tap a field to jump to its region on the receipt',
              textAlign: TextAlign.center,
              style: TextStyle(
                fontSize: 11,
                color: theme.colorScheme.onSurfaceVariant,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// Small paper-stock thumbnail used in the queue rows.
class ReceiptThumbnail extends StatelessWidget {
  const ReceiptThumbnail({this.width = 42, this.height = 52, super.key});

  final double width;
  final double height;

  @override
  Widget build(BuildContext context) {
    final tokens = SpendFlowTokens.of(context);
    Widget bar(double widthFactor, Color color, double thickness) {
      return FractionallySizedBox(
        alignment: Alignment.centerLeft,
        widthFactor: widthFactor,
        child: Container(
          height: thickness,
          decoration: BoxDecoration(
            color: color,
            borderRadius: BorderRadius.circular(2),
          ),
        ),
      );
    }

    const ink = Color(0xFFC9C6BD);
    const inkLight = Color(0xFFDDD9D0);

    return Container(
      width: width,
      height: height,
      padding: const EdgeInsets.symmetric(horizontal: 5, vertical: 6),
      decoration: BoxDecoration(
        color: tokens.receiptPaper,
        borderRadius: Radii.sm,
        border: Border.all(color: Theme.of(context).colorScheme.outlineVariant),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          bar(0.8, ink, 3),
          const SizedBox(height: 3),
          bar(0.6, inkLight, 2),
          const SizedBox(height: 3),
          bar(0.74, inkLight, 2),
          const SizedBox(height: 3),
          bar(0.52, inkLight, 2),
          const Spacer(),
          bar(0.66, ink, 3),
        ],
      ),
    );
  }
}
