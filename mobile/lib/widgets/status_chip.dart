import 'package:flutter/material.dart';

import '../models/models.dart';
import '../theme/tokens.dart';

/// Semantic colour pairs a chip can take. Kept separate from M3's
/// [ColorScheme] because success / warning / info have no slot there.
enum ChipTone { primary, success, warning, error, info, neutral }

class ToneColors {
  const ToneColors(this.background, this.foreground);

  final Color background;
  final Color foreground;
}

ToneColors toneColors(BuildContext context, ChipTone tone) {
  final scheme = Theme.of(context).colorScheme;
  final tokens = SpendFlowTokens.of(context);
  return switch (tone) {
    ChipTone.primary =>
      ToneColors(scheme.primaryContainer, scheme.onPrimaryContainer),
    ChipTone.success =>
      ToneColors(tokens.successContainer, tokens.onSuccessContainer),
    ChipTone.warning =>
      ToneColors(tokens.warningContainer, tokens.onWarningContainer),
    ChipTone.error =>
      ToneColors(scheme.errorContainer, scheme.onErrorContainer),
    ChipTone.info => ToneColors(tokens.infoContainer, tokens.onInfoContainer),
    ChipTone.neutral =>
      ToneColors(tokens.surfaceContainerHigh, scheme.onSurfaceVariant),
  };
}

ChipTone toneForStatus(ClaimStatus status) => switch (status) {
      ClaimStatus.draft => ChipTone.neutral,
      ClaimStatus.pending => ChipTone.warning,
      ClaimStatus.actionRequired => ChipTone.error,
      ClaimStatus.approved => ChipTone.success,
      ClaimStatus.processing => ChipTone.info,
      ClaimStatus.paid => ChipTone.success,
      ClaimStatus.rejected => ChipTone.neutral,
    };

IconData iconForStatus(ClaimStatus status) => switch (status) {
      ClaimStatus.draft => Icons.edit_outlined,
      ClaimStatus.pending => Icons.hourglass_top_outlined,
      ClaimStatus.actionRequired => Icons.warning_amber_rounded,
      ClaimStatus.approved => Icons.check_circle_outline,
      ClaimStatus.processing => Icons.sync_outlined,
      ClaimStatus.paid => Icons.account_balance_wallet_outlined,
      ClaimStatus.rejected => Icons.cancel_outlined,
    };

/// Pill chip — the same shape the web app's `StatusChip` renders.
class ToneChip extends StatelessWidget {
  const ToneChip({
    required this.label,
    this.tone = ChipTone.neutral,
    this.icon,
    this.leading,
    this.dense = false,
    this.bordered = false,
    super.key,
  });

  final String label;
  final ChipTone tone;
  final IconData? icon;

  /// Custom leading widget — used for the queue spinner.
  final Widget? leading;
  final bool dense;

  /// Outline instead of a filled container, for the neutral filter chips.
  final bool bordered;

  @override
  Widget build(BuildContext context) {
    final colors = toneColors(context, tone);
    final fontSize = dense ? 10.0 : 11.5;
    return Container(
      padding: EdgeInsets.symmetric(
        horizontal: dense ? 8 : 10,
        vertical: dense ? 3 : 5,
      ),
      decoration: BoxDecoration(
        color: bordered ? Colors.transparent : colors.background,
        borderRadius: Radii.pill,
        border: bordered
            ? Border.all(color: Theme.of(context).colorScheme.outlineVariant)
            : null,
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: <Widget>[
          if (leading != null) ...<Widget>[
            leading!,
            const SizedBox(width: 5),
          ] else if (icon != null) ...<Widget>[
            Icon(icon, size: dense ? 11 : 13, color: colors.foreground),
            const SizedBox(width: 5),
          ],
          Text(
            label,
            style: TextStyle(
              fontSize: fontSize,
              fontWeight: FontWeight.w600,
              color: colors.foreground,
            ),
          ),
        ],
      ),
    );
  }
}

/// Claim status as a chip, label and icon derived from the status itself.
class StatusChip extends StatelessWidget {
  const StatusChip(this.status, {this.dense = false, super.key});

  final ClaimStatus status;
  final bool dense;

  @override
  Widget build(BuildContext context) {
    return ToneChip(
      label: status.label,
      tone: toneForStatus(status),
      icon: iconForStatus(status),
      dense: dense,
    );
  }
}
