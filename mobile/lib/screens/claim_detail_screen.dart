import 'package:flutter/material.dart';

import '../models/models.dart';
import '../state/app_state.dart';
import '../theme/tokens.dart';
import '../util/currency.dart';
import '../widgets/common.dart';
import '../widgets/status_chip.dart';

/// Read-only claim view: status, the audit trail, and every line item.
///
/// The timeline is the mobile mirror of the web app's audit trail — the point
/// is that an employee can answer "where is my money" without calling Finance.
class ClaimDetailScreen extends StatelessWidget {
  const ClaimDetailScreen({required this.claimId, super.key});

  final String claimId;

  static const String routeName = '/claim';

  @override
  Widget build(BuildContext context) {
    final state = AppScope.of(context);
    final theme = Theme.of(context);
    final tokens = SpendFlowTokens.of(context);
    final claim = state.claimById(claimId);

    if (claim == null) {
      return Scaffold(
        appBar: AppBar(title: const Text('Claim not found')),
        body: Center(
          child: Padding(
            padding: const EdgeInsets.all(24),
            child: Text(
              'No claim with reference $claimId.',
              textAlign: TextAlign.center,
              style: TextStyle(color: theme.colorScheme.onSurfaceVariant),
            ),
          ),
        ),
      );
    }

    return Scaffold(
      appBar: AppBar(
        titleSpacing: 0,
        title: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          mainAxisAlignment: MainAxisAlignment.center,
          children: <Widget>[
            Text(
              claim.title,
              overflow: TextOverflow.ellipsis,
              style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w600),
            ),
            Text(
              '${claim.id} · ${claim.itemCount} items',
              style: const TextStyle(fontSize: 11, fontWeight: FontWeight.w400),
            ),
          ],
        ),
      ),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(16, 14, 16, 32),
        children: <Widget>[
          PanelCard(
            padding: const EdgeInsets.all(15),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: <Widget>[
                StatusChip(claim.status),
                const SizedBox(height: 12),
                Text(
                  formatIdr(claim.amount),
                  style: const TextStyle(
                    fontSize: 27,
                    fontWeight: FontWeight.w700,
                    letterSpacing: -0.8,
                  ),
                ),
                const SizedBox(height: 4),
                Text(
                  claim.headline,
                  style: TextStyle(
                    fontSize: 12,
                    color: theme.colorScheme.onSurfaceVariant,
                  ),
                ),
                const SizedBox(height: 13),
                Wrap(
                  spacing: 7,
                  runSpacing: 7,
                  children: <Widget>[
                    if (claim.slaLabel != null)
                      ToneChip(
                        label: claim.slaLabel!,
                        tone: ChipTone.info,
                        icon: Icons.schedule,
                        dense: true,
                      ),
                    ToneChip(
                      label: '${claim.receiptCount} receipts',
                      bordered: true,
                      dense: true,
                    ),
                  ],
                ),
              ],
            ),
          ),
          const SizedBox(height: 16),
          const _SubHeading('Status'),
          const SizedBox(height: 12),
          ClaimTimeline(entries: claim.timeline),
          const SizedBox(height: 16),
          const _SubHeading('Line items'),
          const SizedBox(height: 12),
          Container(
            clipBehavior: Clip.hardEdge,
            decoration: BoxDecoration(
              color: tokens.surfaceContainerLowest,
              borderRadius: Radii.xl,
              border: Border.all(color: theme.colorScheme.outlineVariant),
            ),
            child: Column(
              children: <Widget>[
                for (var i = 0; i < claim.lines.length; i++)
                  _DetailLineRow(
                    line: claim.lines[i],
                    isLast: i == claim.lines.length - 1,
                  ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _SubHeading extends StatelessWidget {
  const _SubHeading(this.text);

  final String text;

  @override
  Widget build(BuildContext context) {
    return Text(
      text,
      style: const TextStyle(fontSize: 13.5, fontWeight: FontWeight.w600),
    );
  }
}

class _DetailLineRow extends StatelessWidget {
  const _DetailLineRow({required this.line, required this.isLast});

  final ClaimLine line;
  final bool isLast;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 13, vertical: 11),
      decoration: BoxDecoration(
        border: isLast
            ? null
            : Border(
                bottom: BorderSide(color: theme.colorScheme.outlineVariant),
              ),
      ),
      child: Row(
        children: <Widget>[
          CodeBadge(code: line.code, tone: ChipTone.neutral, size: 30),
          const SizedBox(width: 10),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: <Widget>[
                Text(
                  line.description,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                    fontSize: 12.5,
                    fontWeight: FontWeight.w500,
                  ),
                ),
                const SizedBox(height: 2),
                Text(
                  line.meta,
                  style: TextStyle(
                    fontSize: 10.5,
                    color: theme.colorScheme.onSurfaceVariant,
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(width: 8),
          Text(
            formatIdr(line.amount),
            style: const TextStyle(fontSize: 12.5, fontWeight: FontWeight.w600),
          ),
        ],
      ),
    );
  }
}
