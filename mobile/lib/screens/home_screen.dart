import 'package:flutter/material.dart';

import '../data/fixtures.dart';
import '../models/models.dart';
import '../state/app_state.dart';
import '../theme/tokens.dart';
import '../util/currency.dart';
import '../util/debug_menu.dart';
import '../widgets/common.dart';
import '../widgets/status_chip.dart';
import 'claim_detail_screen.dart';
import 'draft_screen.dart';

/// Employee home: who you are, what is in flight, and the claim ledger.
class HomeScreen extends StatefulWidget {
  const HomeScreen({required this.onSeeAllClaims, super.key});

  final VoidCallback onSeeAllClaims;

  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> {
  /// Null means "All". Filters the ledger without leaving the screen.
  ClaimStatus? _filter;

  /// Guards the one-shot repository load (#91): home pulls its claims through
  /// [AppState.loadClaims] instead of reading fixtures directly.
  bool _claimsLoaded = false;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (_claimsLoaded) return;
    _claimsLoaded = true;
    AppScope.of(context).loadClaims();
  }

  @override
  Widget build(BuildContext context) {
    final state = AppScope.of(context);
    final theme = Theme.of(context);

    final claims = state.homeClaims;
    final visible = _filter == null
        ? claims
        : claims.where((c) => c.status == _filter).toList();

    final compact = state.variant == AppVariant.homeCompact;
    final editorial = state.variant == AppVariant.homeEditorial;
    // The quiet variant drops the banner: field engineers who are offline all
    // day get the nav badge and per-item chips instead of a standing alarm.
    final showBanner =
        state.offline && state.variant != AppVariant.syncQuiet;

    return SafeArea(
      bottom: false,
      child: Column(
        children: <Widget>[
          const _HomeHeader(),
          Expanded(
            child: ListView(
              padding: const EdgeInsets.only(bottom: 24),
              children: <Widget>[
                if (showBanner) const _OfflineBanner(),
                Padding(
                  padding: const EdgeInsets.fromLTRB(16, 18, 16, 0),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: <Widget>[
                      Text(
                        Fixtures.todayLabel,
                        style: TextStyle(
                          fontSize: 12.5,
                          color: theme.colorScheme.onSurfaceVariant,
                        ),
                      ),
                      const SizedBox(height: 3),
                      const Text(
                        Fixtures.userName,
                        style: TextStyle(
                          fontSize: 23,
                          fontWeight: FontWeight.w700,
                          letterSpacing: -0.5,
                        ),
                      ),
                      const SizedBox(height: 4),
                      Text(
                        '${Fixtures.userRole} · approver ${Fixtures.approverName}',
                        style: TextStyle(
                          fontSize: 12.5,
                          color: theme.colorScheme.onSurfaceVariant,
                        ),
                      ),
                    ],
                  ),
                ),
                if (editorial)
                  const Padding(
                    padding: EdgeInsets.fromLTRB(16, 18, 16, 0),
                    child: _EditorialSlab(),
                  )
                else
                  const Padding(
                    padding: EdgeInsets.fromLTRB(16, 16, 16, 0),
                    child: _MetricRow(),
                  ),
                SectionHeader(
                  title: 'My claims',
                  trailing: TextButton(
                    onPressed: widget.onSeeAllClaims,
                    child: const Text('See all'),
                  ),
                ),
                _FilterBar(
                  claims: claims,
                  selected: _filter,
                  onSelect: (status) => setState(() => _filter = status),
                ),
                Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 16),
                  child: Column(
                    children: <Widget>[
                      for (final claim in visible)
                        ClaimRow(
                          claim: claim,
                          compact: compact,
                          onTap: () => _openClaim(context, claim),
                        ),
                      if (visible.isEmpty)
                        Padding(
                          padding: const EdgeInsets.symmetric(vertical: 28),
                          child: Text(
                            'No claims with this status.',
                            style: TextStyle(
                              fontSize: 12.5,
                              color: theme.colorScheme.onSurfaceVariant,
                            ),
                          ),
                        ),
                    ],
                  ),
                ),
                if (compact)
                  Padding(
                    padding: const EdgeInsets.fromLTRB(16, 14, 16, 0),
                    child: Text(
                      'Dense ledger — status reads from the badge colour.',
                      style: TextStyle(
                        fontSize: 11,
                        color: theme.colorScheme.onSurfaceVariant,
                      ),
                    ),
                  ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

/// A draft opens its editor; anything submitted opens the read-only detail.
void _openClaim(BuildContext context, Claim claim) {
  if (claim.status == ClaimStatus.draft && claim.id == Fixtures.draftClaimId) {
    Navigator.of(context).pushNamed(DraftScreen.routeName);
    return;
  }
  Navigator.of(context).pushNamed(
    ClaimDetailScreen.routeName,
    arguments: claim.id,
  );
}

class _HomeHeader extends StatelessWidget {
  const _HomeHeader();

  @override
  Widget build(BuildContext context) {
    final state = AppScope.of(context);
    final theme = Theme.of(context);
    final tokens = SpendFlowTokens.of(context);

    return Container(
      height: 64,
      padding: const EdgeInsets.only(left: 14, right: 8),
      decoration: BoxDecoration(
        color: tokens.surfaceContainerHigh,
        border: Border(
          bottom: BorderSide(color: theme.colorScheme.outlineVariant),
        ),
      ),
      child: Row(
        children: <Widget>[
          GestureDetector(
            // Long-press the wordmark to switch design variants on device.
            // Debug-only (#96): production builds render the wordmark but do
            // not respond to the gesture.
            onLongPress:
                debugMenuEnabled ? () => _showVariantPicker(context) : null,
            child: Row(
              children: <Widget>[
                Container(
                  width: 36,
                  height: 36,
                  alignment: Alignment.center,
                  decoration: BoxDecoration(
                    color: theme.colorScheme.primary,
                    borderRadius: Radii.md,
                  ),
                  child: Icon(
                    Icons.receipt_long,
                    size: 19,
                    color: theme.colorScheme.onPrimary,
                  ),
                ),
                const SizedBox(width: 10),
                const Text(
                  'SpendFlow',
                  style: TextStyle(
                    fontSize: 17,
                    fontWeight: FontWeight.w600,
                    letterSpacing: -0.3,
                  ),
                ),
              ],
            ),
          ),
          const Spacer(),
          IconButton(
            onPressed: () {
              state.toggleOnline();
              showToast(
                context,
                state.offline
                    ? 'Airplane mode on — capture keeps working'
                    : 'Back online — ${Fixtures.queue.length} items ready to sync',
              );
            },
            tooltip: state.online ? 'Go offline' : 'Go online',
            icon: Icon(
              state.online ? Icons.wifi : Icons.wifi_off,
              size: 20,
              color: state.online
                  ? theme.colorScheme.onSurfaceVariant
                  : tokens.warning,
            ),
          ),
          IconButton(
            onPressed: () => showToast(context, 'Notifications land in Phase 2'),
            tooltip: 'Notifications',
            icon: Badge(
              label: const Text('2'),
              child: Icon(
                Icons.notifications_outlined,
                size: 20,
                color: theme.colorScheme.onSurfaceVariant,
              ),
            ),
          ),
          const SizedBox(width: 4),
          CircleAvatar(
            radius: 16,
            backgroundColor: theme.colorScheme.primaryContainer,
            child: Text(
              Fixtures.userInitials,
              style: TextStyle(
                fontSize: 12,
                fontWeight: FontWeight.w600,
                color: theme.colorScheme.onPrimaryContainer,
              ),
            ),
          ),
          const SizedBox(width: 6),
        ],
      ),
    );
  }
}

Future<void> _showVariantPicker(BuildContext context) async {
  final state = AppScope.read(context);
  await showModalBottomSheet<void>(
    context: context,
    showDragHandle: true,
    builder: (sheetContext) {
      return SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: <Widget>[
            const ListTile(
              title: Text(
                'Design variant',
                style: TextStyle(fontSize: 15, fontWeight: FontWeight.w600),
              ),
              subtitle: Text(
                'Alternatives from the design review, switchable on device.',
                style: TextStyle(fontSize: 12),
              ),
            ),
            for (final variant in AppVariant.values)
              ListTile(
                title: Text(variant.label, style: const TextStyle(fontSize: 14)),
                trailing: variant == state.variant
                    ? const Icon(Icons.check, size: 20)
                    : null,
                onTap: () {
                  state.variant = variant;
                  Navigator.of(sheetContext).pop();
                },
              ),
          ],
        ),
      );
    },
  );
}

class _OfflineBanner extends StatelessWidget {
  const _OfflineBanner();

  @override
  Widget build(BuildContext context) {
    final state = AppScope.of(context);
    final tokens = SpendFlowTokens.of(context);
    final colors = toneColors(context, ChipTone.warning);

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 11),
      color: tokens.warningContainer,
      child: Row(
        children: <Widget>[
          Icon(Icons.wifi_off, size: 18, color: colors.foreground),
          const SizedBox(width: 10),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: <Widget>[
                Text(
                  "You're offline — capture still works",
                  style: TextStyle(
                    fontSize: 12.5,
                    fontWeight: FontWeight.w600,
                    color: colors.foreground,
                  ),
                ),
                const SizedBox(height: 1),
                Text(
                  state.queueSummary,
                  style: TextStyle(
                    fontSize: 11,
                    color: colors.foreground.withValues(alpha: 0.85),
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

/// Two metric cards: what is waiting on an approver, and what has been paid.
class _MetricRow extends StatelessWidget {
  const _MetricRow();

  @override
  Widget build(BuildContext context) {
    final state = AppScope.of(context);
    // IntrinsicHeight so both cards match the taller one — a bare `stretch`
    // would ask for infinite height inside the scroll view.
    return IntrinsicHeight(
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: <Widget>[
          Expanded(
            child: _MetricCard(
              icon: Icons.hourglass_top_outlined,
              tone: ChipTone.warning,
              value: formatIdr(state.pendingTotal),
              label:
                  state.submitted ? '3 pending approval' : '2 pending approval',
            ),
          ),
          const SizedBox(width: 10),
          Expanded(
            child: _MetricCard(
              icon: Icons.receipt_long_outlined,
              tone: ChipTone.success,
              value: formatIdr(state.reimbursedTotal),
              label: 'Reimbursed in July',
            ),
          ),
        ],
      ),
    );
  }
}

class _MetricCard extends StatelessWidget {
  const _MetricCard({
    required this.icon,
    required this.tone,
    required this.value,
    required this.label,
  });

  final IconData icon;
  final ChipTone tone;
  final String value;
  final String label;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final colors = toneColors(context, tone);
    return PanelCard(
      padding: const EdgeInsets.fromLTRB(13, 13, 13, 14),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Container(
            width: 28,
            height: 28,
            alignment: Alignment.center,
            decoration: BoxDecoration(
              color: colors.background,
              borderRadius: BorderRadius.circular(9),
            ),
            child: Icon(icon, size: 15, color: colors.foreground),
          ),
          const SizedBox(height: 9),
          FittedBox(
            fit: BoxFit.scaleDown,
            alignment: Alignment.centerLeft,
            child: Text(
              value,
              style: const TextStyle(
                fontSize: 19,
                fontWeight: FontWeight.w700,
                letterSpacing: -0.4,
              ),
            ),
          ),
          const SizedBox(height: 2),
          Text(
            label,
            style: TextStyle(
              fontSize: 11,
              color: theme.colorScheme.onSurfaceVariant,
            ),
          ),
        ],
      ),
    );
  }
}

/// Editorial home: the money leads. One indigo slab with a perforated rule
/// instead of two metric cards.
class _EditorialSlab extends StatelessWidget {
  const _EditorialSlab();

  @override
  Widget build(BuildContext context) {
    final state = AppScope.of(context);
    final theme = Theme.of(context);
    final onSlab = theme.colorScheme.onPrimary;

    return Container(
      clipBehavior: Clip.hardEdge,
      decoration: BoxDecoration(
        color: theme.colorScheme.primary,
        borderRadius: Radii.xxl,
      ),
      child: Stack(
        children: <Widget>[
          Positioned(
            right: -30,
            top: -30,
            child: Container(
              width: 150,
              height: 150,
              decoration: BoxDecoration(
                color: onSlab.withValues(alpha: 0.09),
                shape: BoxShape.circle,
              ),
            ),
          ),
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 18, vertical: 20),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: <Widget>[
                Text(
                  'IN FLIGHT THIS MONTH',
                  style: TextStyle(
                    fontSize: 10.5,
                    fontWeight: FontWeight.w600,
                    letterSpacing: 1.4,
                    color: onSlab.withValues(alpha: 0.72),
                  ),
                ),
                const SizedBox(height: 8),
                FittedBox(
                  fit: BoxFit.scaleDown,
                  alignment: Alignment.centerLeft,
                  child: Text(
                    formatIdr(state.pendingTotal),
                    style: TextStyle(
                      fontSize: 38,
                      fontWeight: FontWeight.w700,
                      letterSpacing: -1.6,
                      height: 1,
                      color: onSlab,
                    ),
                  ),
                ),
                const SizedBox(height: 6),
                Text(
                  'across ${state.submitted ? 3 : 2} claims awaiting '
                  '${Fixtures.approverName.split(' ').first}'
                  '${state.submitted ? '' : ' · 1 draft unsent'}',
                  style: TextStyle(
                    fontSize: 12.5,
                    color: onSlab.withValues(alpha: 0.8),
                  ),
                ),
                const SizedBox(height: 16),
                _PerforationRule(color: onSlab.withValues(alpha: 0.5)),
                const SizedBox(height: 14),
                Row(
                  children: <Widget>[
                    _SlabStat(
                      value: formatIdr(state.reimbursedTotal),
                      label: 'reimbursed in July',
                      color: onSlab,
                    ),
                    const SizedBox(width: 22),
                    _SlabStat(
                      value: '${state.pendingQueueCount}',
                      label: 'waiting to sync',
                      color: onSlab,
                    ),
                  ],
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

/// Dashed rule that reads as a receipt's tear-off perforation.
class _PerforationRule extends StatelessWidget {
  const _PerforationRule({required this.color});

  final Color color;

  @override
  Widget build(BuildContext context) {
    return LayoutBuilder(
      builder: (context, constraints) {
        const dash = 6.0;
        final count = (constraints.maxWidth / (dash * 2)).floor();
        return Row(
          children: <Widget>[
            for (var i = 0; i < count; i++)
              Container(
                width: dash,
                height: 1,
                margin: const EdgeInsets.only(right: dash),
                color: color,
              ),
          ],
        );
      },
    );
  }
}

class _SlabStat extends StatelessWidget {
  const _SlabStat({
    required this.value,
    required this.label,
    required this.color,
  });

  final String value;
  final String label;
  final Color color;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: <Widget>[
        Text(
          value,
          style: TextStyle(
            fontSize: 19,
            fontWeight: FontWeight.w700,
            letterSpacing: -0.5,
            color: color,
          ),
        ),
        const SizedBox(height: 2),
        Text(
          label,
          style: TextStyle(
            fontSize: 10.5,
            color: color.withValues(alpha: 0.75),
          ),
        ),
      ],
    );
  }
}

/// Status filter chips with live counts.
class _FilterBar extends StatelessWidget {
  const _FilterBar({
    required this.claims,
    required this.selected,
    required this.onSelect,
  });

  final List<Claim> claims;
  final ClaimStatus? selected;
  final ValueChanged<ClaimStatus?> onSelect;

  @override
  Widget build(BuildContext context) {
    int countOf(ClaimStatus status) =>
        claims.where((c) => c.status == status).length;

    final entries = <(String, ClaimStatus?)>[
      ('All ${claims.length}', null),
      ('Pending ${countOf(ClaimStatus.pending)}', ClaimStatus.pending),
      ('Draft ${countOf(ClaimStatus.draft)}', ClaimStatus.draft),
      ('Paid ${countOf(ClaimStatus.paid)}', ClaimStatus.paid),
    ];

    return SizedBox(
      height: 46,
      child: ListView.separated(
        scrollDirection: Axis.horizontal,
        padding: const EdgeInsets.fromLTRB(16, 0, 16, 12),
        itemCount: entries.length,
        separatorBuilder: (_, _) => const SizedBox(width: 7),
        itemBuilder: (context, i) {
          final (label, status) = entries[i];
          return ChoiceChip(
            label: Text(label),
            selected: selected == status,
            showCheckmark: false,
            labelStyle: TextStyle(
              fontSize: 12,
              fontWeight: FontWeight.w500,
              color: selected == status
                  ? Theme.of(context).colorScheme.onPrimary
                  : Theme.of(context).colorScheme.onSurfaceVariant,
            ),
            selectedColor: Theme.of(context).colorScheme.primary,
            onSelected: (_) => onSelect(status),
          );
        },
      ),
    );
  }
}
