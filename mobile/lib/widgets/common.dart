import 'package:flutter/material.dart';

import '../models/models.dart';
import '../theme/tokens.dart';
import '../util/currency.dart';
import 'status_chip.dart';

/// Section heading with an optional trailing action, e.g. "My claims / See all".
class SectionHeader extends StatelessWidget {
  const SectionHeader({
    required this.title,
    this.trailing,
    this.padding = const EdgeInsets.fromLTRB(16, 20, 16, 8),
    super.key,
  });

  final String title;
  final Widget? trailing;
  final EdgeInsets padding;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: padding,
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: <Widget>[
          Text(
            title,
            style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w600),
          ),
          ?trailing,
        ],
      ),
    );
  }
}

/// Rounded-square badge carrying a claim or category code.
class CodeBadge extends StatelessWidget {
  const CodeBadge({
    required this.code,
    required this.tone,
    this.size = 38,
    super.key,
  });

  final String code;
  final ChipTone tone;
  final double size;

  @override
  Widget build(BuildContext context) {
    final colors = toneColors(context, tone);
    return Container(
      width: size,
      height: size,
      alignment: Alignment.center,
      decoration: BoxDecoration(
        color: colors.background,
        borderRadius: BorderRadius.circular(size * 0.29),
      ),
      child: Text(
        code,
        style: TextStyle(
          fontSize: size * 0.29,
          fontWeight: FontWeight.w700,
          color: colors.foreground,
        ),
      ),
    );
  }
}

/// A claim in the home ledger.
///
/// The compact variant drops the status chip and halves the row padding, so
/// roughly twice as many claims fit on screen; status then reads from the
/// badge colour alone.
class ClaimRow extends StatelessWidget {
  const ClaimRow({
    required this.claim,
    required this.onTap,
    this.compact = false,
    super.key,
  });

  final Claim claim;
  final VoidCallback onTap;
  final bool compact;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final tone = toneForStatus(claim.status);
    return InkWell(
      onTap: onTap,
      child: Container(
        padding: EdgeInsets.symmetric(vertical: compact ? 9 : 13),
        decoration: BoxDecoration(
          border: Border(
            bottom: BorderSide(color: theme.colorScheme.outlineVariant),
          ),
        ),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.center,
          children: <Widget>[
            CodeBadge(code: claim.code, tone: tone),
            const SizedBox(width: 11),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: <Widget>[
                  Text(
                    claim.title,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(
                      fontSize: 13.5,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                  const SizedBox(height: 2),
                  Text(
                    '${claim.id} · ${claim.place} · ${claim.itemCount} items',
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: TextStyle(
                      fontSize: 11,
                      color: theme.colorScheme.onSurfaceVariant,
                    ),
                  ),
                  if (!compact) ...<Widget>[
                    const SizedBox(height: 6),
                    StatusChip(claim.status, dense: true),
                  ],
                ],
              ),
            ),
            const SizedBox(width: 8),
            Column(
              crossAxisAlignment: CrossAxisAlignment.end,
              children: <Widget>[
                Text(
                  formatIdr(claim.amount),
                  style: const TextStyle(
                    fontSize: 13,
                    fontWeight: FontWeight.w600,
                  ),
                ),
                const SizedBox(height: 2),
                Text(
                  claim.dateLabel,
                  style: TextStyle(
                    fontSize: 10.5,
                    color: theme.colorScheme.onSurfaceVariant,
                  ),
                ),
              ],
            ),
            Icon(
              Icons.chevron_right,
              size: 18,
              color: theme.colorScheme.outline,
            ),
          ],
        ),
      ),
    );
  }
}

/// Claim audit trail — the same node sequence the web app shows.
class ClaimTimeline extends StatelessWidget {
  const ClaimTimeline({required this.entries, super.key});

  final List<TimelineEntry> entries;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final tokens = SpendFlowTokens.of(context);

    Color dotColor(TimelineTone tone) => switch (tone) {
          TimelineTone.done => theme.colorScheme.primary,
          TimelineTone.waiting => tokens.warning,
          TimelineTone.pending => tokens.surfaceContainerHigh,
        };

    return Column(
      children: <Widget>[
        for (var i = 0; i < entries.length; i++)
          _TimelineNode(
            entry: entries[i],
            isLast: i == entries.length - 1,
            dotColor: dotColor(entries[i].tone),
          ),
      ],
    );
  }
}

class _TimelineNode extends StatelessWidget {
  const _TimelineNode({
    required this.entry,
    required this.isLast,
    required this.dotColor,
  });

  final TimelineEntry entry;
  final bool isLast;
  final Color dotColor;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final tokens = SpendFlowTokens.of(context);
    final pending = entry.tone == TimelineTone.pending;

    return IntrinsicHeight(
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Column(
            children: <Widget>[
              Container(
                width: 30,
                height: 30,
                alignment: Alignment.center,
                decoration: BoxDecoration(color: dotColor, shape: BoxShape.circle),
                child: switch (entry.tone) {
                  TimelineTone.done => Icon(
                      Icons.check,
                      size: 15,
                      color: theme.colorScheme.onPrimary,
                    ),
                  TimelineTone.waiting => const Icon(
                      Icons.schedule,
                      size: 15,
                      color: Colors.white,
                    ),
                  TimelineTone.pending => Container(
                      width: 7,
                      height: 7,
                      decoration: BoxDecoration(
                        color: theme.colorScheme.outline,
                        shape: BoxShape.circle,
                      ),
                    ),
                },
              ),
              if (!isLast)
                Expanded(
                  child: Container(
                    width: 2,
                    constraints: const BoxConstraints(minHeight: 26),
                    color: theme.colorScheme.outlineVariant,
                  ),
                ),
            ],
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Padding(
              padding: EdgeInsets.only(bottom: isLast ? 0 : 16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: <Widget>[
                  Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: <Widget>[
                      Expanded(
                        child: Text(
                          entry.title,
                          style: TextStyle(
                            fontSize: 13,
                            fontWeight: FontWeight.w600,
                            color: pending
                                ? theme.colorScheme.onSurfaceVariant
                                : theme.colorScheme.onSurface,
                          ),
                        ),
                      ),
                      Text(
                        entry.time,
                        style: TextStyle(
                          fontSize: 10.5,
                          color: theme.colorScheme.onSurfaceVariant,
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 2),
                  Text(
                    entry.actor,
                    style: TextStyle(
                      fontSize: 11,
                      color: theme.colorScheme.onSurfaceVariant,
                    ),
                  ),
                  if (entry.body != null) ...<Widget>[
                    const SizedBox(height: 7),
                    Container(
                      width: double.infinity,
                      padding:
                          const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
                      decoration: BoxDecoration(
                        color: tokens.surfaceContainer,
                        borderRadius: Radii.md,
                      ),
                      child: Text(
                        entry.body!,
                        style: const TextStyle(fontSize: 11.5, height: 1.45),
                      ),
                    ),
                  ],
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }
}

/// Inline notice — used for the policy-cap warning and the OCR disclaimer.
class NoticeBanner extends StatelessWidget {
  const NoticeBanner({
    required this.text,
    required this.tone,
    this.icon,
    this.title,
    this.trailing,
    super.key,
  });

  final String text;
  final ChipTone tone;
  final IconData? icon;
  final String? title;
  final Widget? trailing;

  @override
  Widget build(BuildContext context) {
    final colors = toneColors(context, tone);
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 13, vertical: 11),
      decoration: BoxDecoration(
        color: colors.background,
        borderRadius: Radii.lg,
        border: Border.all(color: colors.foreground.withValues(alpha: 0.25)),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          if (icon != null) ...<Widget>[
            Icon(icon, size: 17, color: colors.foreground),
            const SizedBox(width: 10),
          ],
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: <Widget>[
                if (title != null) ...<Widget>[
                  Text(
                    title!,
                    style: TextStyle(
                      fontSize: 12.5,
                      fontWeight: FontWeight.w600,
                      color: colors.foreground,
                    ),
                  ),
                  const SizedBox(height: 2),
                ],
                Text(
                  text,
                  style: TextStyle(
                    fontSize: 11.5,
                    height: 1.45,
                    color: colors.foreground,
                  ),
                ),
              ],
            ),
          ),
          if (trailing != null) ...<Widget>[
            const SizedBox(width: 10),
            trailing!,
          ],
        ],
      ),
    );
  }
}

/// Bordered card matching the web app's surface-container-low panels.
class PanelCard extends StatelessWidget {
  const PanelCard({
    required this.child,
    this.padding = const EdgeInsets.all(14),
    this.borderColor,
    this.color,
    this.borderRadius = Radii.xl,
    super.key,
  });

  final Widget child;
  final EdgeInsets padding;
  final Color? borderColor;
  final Color? color;
  final BorderRadius borderRadius;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final tokens = SpendFlowTokens.of(context);
    return Container(
      padding: padding,
      decoration: BoxDecoration(
        color: color ?? tokens.surfaceContainerLow,
        borderRadius: borderRadius,
        border: Border.all(
          color: borderColor ?? theme.colorScheme.outlineVariant,
        ),
      ),
      child: child,
    );
  }
}

/// Sticky action bar pinned under the content, with the safe-area padding the
/// gesture bar and home indicator need.
class BottomActionBar extends StatelessWidget {
  const BottomActionBar({required this.children, super.key});

  final List<Widget> children;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Container(
      decoration: BoxDecoration(
        color: theme.colorScheme.surface,
        border: Border(
          top: BorderSide(color: theme.colorScheme.outlineVariant),
        ),
      ),
      child: SafeArea(
        top: false,
        child: Padding(
          padding: const EdgeInsets.fromLTRB(14, 12, 14, 12),
          child: Row(children: children),
        ),
      ),
    );
  }
}

/// Show a transient message. One helper so every screen's toast looks the same.
void showToast(BuildContext context, String message) {
  ScaffoldMessenger.of(context)
    ..hideCurrentSnackBar()
    ..showSnackBar(
      SnackBar(
        content: Text(message),
        duration: const Duration(milliseconds: 2600),
      ),
    );
}
