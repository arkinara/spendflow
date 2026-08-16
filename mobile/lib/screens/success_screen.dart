import 'package:flutter/material.dart';

import '../data/fixtures.dart';
import '../state/app_state.dart';
import '../theme/tokens.dart';
import '../util/currency.dart';
import '../widgets/common.dart';
import 'claim_detail_screen.dart';
import 'shell.dart';

/// Submission receipt — what was sent, to whom, and what happens next.
class SuccessScreen extends StatelessWidget {
  const SuccessScreen({super.key});

  static const String routeName = '/success';

  @override
  Widget build(BuildContext context) {
    final state = AppScope.of(context);
    final theme = Theme.of(context);
    final tokens = SpendFlowTokens.of(context);

    return Scaffold(
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.fromLTRB(28, 32, 28, 24),
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: <Widget>[
              Center(
                child: Container(
                  width: 82,
                  height: 82,
                  alignment: Alignment.center,
                  decoration: BoxDecoration(
                    color: tokens.successContainer,
                    shape: BoxShape.circle,
                  ),
                  child: Icon(
                    Icons.check,
                    size: 40,
                    color: tokens.onSuccessContainer,
                  ),
                ),
              ),
              const SizedBox(height: 22),
              const Text(
                'Submitted for approval',
                textAlign: TextAlign.center,
                style: TextStyle(
                  fontSize: 22,
                  fontWeight: FontWeight.w700,
                  letterSpacing: -0.4,
                ),
              ),
              const SizedBox(height: 8),
              Text(
                '${Fixtures.approverName} has 2 working days to decide. '
                'We will notify you the moment she does.',
                textAlign: TextAlign.center,
                style: TextStyle(
                  fontSize: 13.5,
                  height: 1.55,
                  color: theme.colorScheme.onSurfaceVariant,
                ),
              ),
              const SizedBox(height: 22),
              PanelCard(
                child: Column(
                  children: <Widget>[
                    const _SummaryRow(
                      label: 'Reference',
                      value: Fixtures.draftClaimId,
                    ),
                    const SizedBox(height: 9),
                    _SummaryRow(
                      label: 'Amount',
                      value: formatIdr(state.draftTotal),
                    ),
                    const SizedBox(height: 9),
                    const _SummaryRow(
                      label: 'Approver',
                      value: Fixtures.approverName,
                    ),
                    const SizedBox(height: 9),
                    _SummaryRow(
                      label: 'Flags',
                      value: state.flaggedCount == 0
                          ? 'None'
                          : '${state.flaggedCount} to review',
                      valueColor:
                          state.flaggedCount == 0 ? null : tokens.warning,
                    ),
                  ],
                ),
              ),
              const SizedBox(height: 22),
              FilledButton(
                onPressed: () => Navigator.of(context).pushNamedAndRemoveUntil(
                  ClaimDetailScreen.routeName,
                  (route) => route.settings.name == MainShell.routeName,
                  arguments: Fixtures.draftClaimId,
                ),
                child: const Text('Track this claim'),
              ),
              const SizedBox(height: 9),
              OutlinedButton(
                onPressed: () => Navigator.of(context).popUntil(
                  (route) => route.settings.name == MainShell.routeName,
                ),
                child: const Text('Back to home'),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _SummaryRow extends StatelessWidget {
  const _SummaryRow({
    required this.label,
    required this.value,
    this.valueColor,
  });

  final String label;
  final String value;
  final Color? valueColor;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Row(
      mainAxisAlignment: MainAxisAlignment.spaceBetween,
      children: <Widget>[
        Text(
          label,
          style: TextStyle(
            fontSize: 12.5,
            color: theme.colorScheme.onSurfaceVariant,
          ),
        ),
        Text(
          value,
          style: TextStyle(
            fontSize: 12.5,
            fontWeight: FontWeight.w600,
            color: valueColor ?? theme.colorScheme.onSurface,
          ),
        ),
      ],
    );
  }
}
