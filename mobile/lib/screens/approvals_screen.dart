import 'package:flutter/material.dart';

import '../api/errors.dart';
import '../data/claim_repository.dart';
import '../data/fixtures.dart';
import '../models/models.dart';
import '../state/app_state.dart';
import '../theme/tokens.dart';
import '../util/currency.dart';
import '../widgets/common.dart';
import '../widgets/status_chip.dart';

/// Approver inbox.
///
/// SLA badges and exception flags sit on the card itself, so a manager can
/// decide from the list without opening each claim — the single biggest
/// difference between approving on a phone and approving at a desk.
class ApprovalsScreen extends StatelessWidget {
  const ApprovalsScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final state = AppScope.of(context);
    final theme = Theme.of(context);
    final tokens = SpendFlowTokens.of(context);
    final items = state.inbox;

    return SafeArea(
      bottom: false,
      child: Column(
        children: <Widget>[
          Container(
            height: 64,
            padding: const EdgeInsets.only(left: 16, right: 12),
            decoration: BoxDecoration(
              color: tokens.surfaceContainerHigh,
              border: Border(
                bottom: BorderSide(color: theme.colorScheme.outlineVariant),
              ),
            ),
            child: Row(
              children: <Widget>[
                Expanded(
                  child: Column(
                    mainAxisAlignment: MainAxisAlignment.center,
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: <Widget>[
                      const Text(
                        'Approvals',
                        style: TextStyle(
                          fontSize: 17,
                          fontWeight: FontWeight.w600,
                          letterSpacing: -0.3,
                        ),
                      ),
                      const SizedBox(height: 1),
                      Text(
                        '${Fixtures.approverName} · Operations',
                        style: TextStyle(
                          fontSize: 11,
                          color: theme.colorScheme.onSurfaceVariant,
                        ),
                      ),
                    ],
                  ),
                ),
                ToneChip(
                  label: '${items.length} waiting',
                  tone: ChipTone.warning,
                ),
              ],
            ),
          ),
          Expanded(
            child: items.isEmpty
                ? _InboxZero(theme: theme, tokens: tokens)
                : ListView(
                    padding: const EdgeInsets.fromLTRB(16, 12, 16, 110),
                    children: <Widget>[
                      for (final item in items) ...<Widget>[
                        _InboxCard(item: item),
                        const SizedBox(height: 11),
                      ],
                    ],
                  ),
          ),
        ],
      ),
    );
  }
}

/// Push the verdict through the repository (#92). The item only leaves the
/// local list when the backend accepted the decision, so a failure keeps it
/// in front of the approver.
Future<void> _decide(
  BuildContext context,
  InboxItem item,
  Decision decision,
) async {
  final state = AppScope.read(context);
  final verb = switch (decision) {
    Decision.approve => 'Approved · ${item.title} → Finance payment run',
    Decision.reject => 'Rejected · ${item.title} returned to ${item.submitter}',
    Decision.returnForRevision => 'Returned to ${item.submitter} with a comment',
  };
  try {
    await state.decide(item.id, decision);
    if (context.mounted) showToast(context, verb);
  } on ApiException catch (error) {
    if (context.mounted) showToast(context, error.message);
  }
}

class _InboxZero extends StatelessWidget {
  const _InboxZero({required this.theme, required this.tokens});

  final ThemeData theme;
  final SpendFlowTokens tokens;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(32),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: <Widget>[
            Container(
              width: 64,
              height: 64,
              alignment: Alignment.center,
              decoration: BoxDecoration(
                color: tokens.successContainer,
                shape: BoxShape.circle,
              ),
              child: Icon(
                Icons.check,
                size: 30,
                color: tokens.onSuccessContainer,
              ),
            ),
            const SizedBox(height: 16),
            const Text(
              'Inbox zero',
              style: TextStyle(fontSize: 16, fontWeight: FontWeight.w600),
            ),
            const SizedBox(height: 6),
            Text(
              'Every claim waiting on you has been decided. '
              'Approved claims move to the Finance payment run.',
              textAlign: TextAlign.center,
              style: TextStyle(
                fontSize: 12.5,
                height: 1.5,
                color: theme.colorScheme.onSurfaceVariant,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _InboxCard extends StatelessWidget {
  const _InboxCard({required this.item});

  final InboxItem item;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final tokens = SpendFlowTokens.of(context);

    final slaTone = switch (item.slaTone) {
      SlaTone.info => ChipTone.info,
      SlaTone.error => ChipTone.error,
      SlaTone.ok => ChipTone.success,
    };

    return PanelCard(
      color: tokens.surfaceContainerLowest,
      padding: const EdgeInsets.all(13),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: <Widget>[
              CircleAvatar(
                radius: 17,
                backgroundColor: theme.colorScheme.primaryContainer,
                child: Text(
                  item.initials,
                  style: TextStyle(
                    fontSize: 11.5,
                    fontWeight: FontWeight.w600,
                    color: theme.colorScheme.onPrimaryContainer,
                  ),
                ),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: <Widget>[
                    Text(
                      item.title,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                        fontSize: 13.5,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                    const SizedBox(height: 2),
                    Text(
                      item.sub,
                      style: TextStyle(
                        fontSize: 11,
                        color: theme.colorScheme.onSurfaceVariant,
                      ),
                    ),
                  ],
                ),
              ),
              const SizedBox(width: 8),
              Column(
                crossAxisAlignment: CrossAxisAlignment.end,
                children: <Widget>[
                  Text(
                    formatIdr(item.amount),
                    style: const TextStyle(
                      fontSize: 14,
                      fontWeight: FontWeight.w700,
                      letterSpacing: -0.3,
                    ),
                  ),
                  const SizedBox(height: 4),
                  ToneChip(label: item.sla, tone: slaTone, dense: true),
                ],
              ),
            ],
          ),
          if (item.isFlagged) ...<Widget>[
            const SizedBox(height: 9),
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 7),
              decoration: BoxDecoration(
                color: tokens.warningContainer,
                borderRadius: Radii.md,
              ),
              child: Row(
                children: <Widget>[
                  Icon(
                    Icons.warning_amber_rounded,
                    size: 14,
                    color: tokens.onWarningContainer,
                  ),
                  const SizedBox(width: 7),
                  Expanded(
                    child: Text(
                      item.flagText!,
                      style: TextStyle(
                        fontSize: 10.5,
                        color: tokens.onWarningContainer,
                      ),
                    ),
                  ),
                ],
              ),
            ),
          ],
          const SizedBox(height: 11),
          Row(
            children: <Widget>[
              Expanded(
                child: OutlinedButton(
                  onPressed: () =>
                      _decide(context, item, Decision.returnForRevision),
                  style: OutlinedButton.styleFrom(
                    minimumSize: const Size(0, 46),
                    foregroundColor: theme.colorScheme.error,
                  ),
                  child: const Text('Return'),
                ),
              ),
              const SizedBox(width: 8),
              Expanded(
                child: FilledButton.icon(
                  onPressed: () => _decide(context, item, Decision.approve),
                  style: FilledButton.styleFrom(minimumSize: const Size(0, 46)),
                  icon: const Icon(Icons.check, size: 16),
                  label: const Text('Approve'),
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}
