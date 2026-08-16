import 'package:flutter/material.dart';

import '../data/fixtures.dart';
import '../models/models.dart';
import '../state/app_state.dart';
import '../theme/tokens.dart';
import '../util/currency.dart';
import '../widgets/common.dart';
import 'claim_detail_screen.dart';
import 'draft_screen.dart';

/// Every claim the employee owns, grouped by where it sits in the lifecycle.
class ClaimsScreen extends StatelessWidget {
  const ClaimsScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final state = AppScope.of(context);
    final theme = Theme.of(context);
    final tokens = SpendFlowTokens.of(context);
    final claims = state.homeClaims;

    final open = claims
        .where((c) =>
            c.status == ClaimStatus.draft ||
            c.status == ClaimStatus.pending ||
            c.status == ClaimStatus.actionRequired)
        .toList();
    final settled = claims.where((c) => !open.contains(c)).toList();
    final total = claims.fold<int>(0, (t, c) => t + c.amount);

    return SafeArea(
      bottom: false,
      child: Column(
        children: <Widget>[
          Container(
            height: 64,
            padding: const EdgeInsets.symmetric(horizontal: 16),
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
                        'My claims',
                        style: TextStyle(
                          fontSize: 17,
                          fontWeight: FontWeight.w600,
                          letterSpacing: -0.3,
                        ),
                      ),
                      const SizedBox(height: 1),
                      Text(
                        '${claims.length} claims · ${formatIdr(total)} lifetime',
                        style: TextStyle(
                          fontSize: 11,
                          color: theme.colorScheme.onSurfaceVariant,
                        ),
                      ),
                    ],
                  ),
                ),
              ],
            ),
          ),
          Expanded(
            child: ListView(
              padding: const EdgeInsets.only(bottom: 96),
              children: <Widget>[
                const SectionHeader(title: 'Open'),
                Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 16),
                  child: Column(
                    children: <Widget>[
                      for (final claim in open)
                        ClaimRow(
                          claim: claim,
                          onTap: () => _open(context, claim),
                        ),
                    ],
                  ),
                ),
                const SectionHeader(title: 'Settled'),
                Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 16),
                  child: Column(
                    children: <Widget>[
                      for (final claim in settled)
                        ClaimRow(
                          claim: claim,
                          onTap: () => _open(context, claim),
                        ),
                    ],
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  void _open(BuildContext context, Claim claim) {
    if (claim.status == ClaimStatus.draft && claim.id == Fixtures.draftClaimId) {
      Navigator.of(context).pushNamed(DraftScreen.routeName);
      return;
    }
    Navigator.of(context).pushNamed(
      ClaimDetailScreen.routeName,
      arguments: claim.id,
    );
  }
}
