import 'package:flutter/material.dart';

import '../api/errors.dart';
import '../models/models.dart';
import '../state/app_state.dart';
import '../theme/tokens.dart';
import '../util/currency.dart';
import '../widgets/common.dart';
import '../widgets/receipt.dart';
import '../widgets/status_chip.dart';

/// Offline queue: what is held on device, why, and an explicit way to push it.
///
/// Sync is never silent — each item carries its own badge and the button says
/// exactly what it will do, because a field engineer who is offline all day
/// needs to trust that nothing was quietly dropped.
class QueueScreen extends StatelessWidget {
  const QueueScreen({this.standalone = false, super.key});

  /// True when pushed as its own route (from the draft's "queue for
  /// submission" path) rather than shown as the Queue tab.
  final bool standalone;

  static const String routeName = '/queue';

  /// Push the queue through the repository (#92). A backend failure keeps
  /// the queue intact — the toast says exactly what went wrong so a retry is
  /// an informed decision, not a hope.
  Future<void> _sync(BuildContext context) async {
    final state = AppScope.read(context);
    if (!state.online) {
      showToast(context, 'Still offline — we will retry automatically');
      return;
    }
    if (state.synced) {
      showToast(context, 'Nothing left to sync');
      return;
    }
    final count = state.queuedItems.length;
    try {
      final done = await state.syncNow();
      if (done && context.mounted) {
        showToast(context, 'All synced — $count items uploaded');
      }
    } on ApiException catch (error) {
      if (context.mounted) showToast(context, error.message);
    }
  }

  @override
  Widget build(BuildContext context) {
    final state = AppScope.of(context);
    final theme = Theme.of(context);

    final content = Column(
      children: <Widget>[
        if (!standalone) _QueueHeader(state: state),
        Expanded(
          child: ListView(
            padding: const EdgeInsets.fromLTRB(16, 14, 16, 24),
            children: <Widget>[
              const _NetworkBanner(),
              const SizedBox(height: 11),
              for (var i = 0; i < state.queuedItems.length; i++) ...<Widget>[
                _QueueRow(
                  item: state.queuedItems[i],
                  queueState: state.queueStateAt(i),
                ),
                const SizedBox(height: 11),
              ],
              const SizedBox(height: 2),
              Text(
                'Queued items are stored on device with their receipt files. '
                'Editing a queued draft keeps it local until the next '
                'successful sync.',
                style: TextStyle(
                  fontSize: 11,
                  height: 1.5,
                  color: theme.colorScheme.onSurfaceVariant,
                ),
              ),
            ],
          ),
        ),
      ],
    );

    final syncButton = FilledButton.icon(
      onPressed: state.syncing ? null : () => _sync(context),
      icon: state.syncing
          ? const SizedBox(
              width: 16,
              height: 16,
              child: CircularProgressIndicator(strokeWidth: 2),
            )
          : Icon(state.synced ? Icons.check : Icons.sync, size: 18),
      label: Text(
        state.synced
            ? 'All synced'
            : state.syncing
                ? 'Syncing…'
                : state.online
                    ? 'Sync ${state.pendingQueueCount} items now'
                    : 'Waiting for network',
      ),
      style: FilledButton.styleFrom(
        backgroundColor: state.online && !state.synced
            ? theme.colorScheme.primary
            : SpendFlowTokens.of(context).surfaceContainerHigh,
        foregroundColor: state.online && !state.synced
            ? theme.colorScheme.onPrimary
            : theme.colorScheme.onSurfaceVariant,
      ),
    );

    if (standalone) {
      return Scaffold(
        appBar: AppBar(
          titleSpacing: 0,
          title: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            mainAxisAlignment: MainAxisAlignment.center,
            children: <Widget>[
              const Text(
                'Sync queue',
                style: TextStyle(fontSize: 15, fontWeight: FontWeight.w600),
              ),
              Text(
                state.queueSummary,
                style: const TextStyle(fontSize: 11, fontWeight: FontWeight.w400),
              ),
            ],
          ),
          actions: const <Widget>[_NetworkToggle(), SizedBox(width: 12)],
        ),
        body: content,
        bottomNavigationBar: BottomActionBar(
          children: <Widget>[Expanded(child: syncButton)],
        ),
      );
    }

    return SafeArea(
      bottom: false,
      child: Column(
        children: <Widget>[
          Expanded(child: content),
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 0, 16, 12),
            child: SizedBox(width: double.infinity, child: syncButton),
          ),
        ],
      ),
    );
  }
}

class _QueueHeader extends StatelessWidget {
  const _QueueHeader({required this.state});

  final AppState state;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final tokens = SpendFlowTokens.of(context);
    return Container(
      height: 64,
      padding: const EdgeInsets.only(left: 16, right: 10),
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
                  'Sync queue',
                  style: TextStyle(
                    fontSize: 17,
                    fontWeight: FontWeight.w600,
                    letterSpacing: -0.3,
                  ),
                ),
                const SizedBox(height: 1),
                Text(
                  state.queueSummary,
                  style: TextStyle(
                    fontSize: 11,
                    color: theme.colorScheme.onSurfaceVariant,
                  ),
                ),
              ],
            ),
          ),
          const _NetworkToggle(),
        ],
      ),
    );
  }
}

/// Online / Offline switch — the same control the home app bar carries, so the
/// state is reachable from wherever the user notices it.
class _NetworkToggle extends StatelessWidget {
  const _NetworkToggle();

  @override
  Widget build(BuildContext context) {
    final state = AppScope.of(context);
    return TextButton.icon(
      onPressed: () {
        state.toggleOnline();
        showToast(
          context,
          state.offline
              ? 'Airplane mode on — capture keeps working'
              : 'Back online — ${state.pendingQueueCount} items ready to sync',
        );
      },
      icon: Icon(state.online ? Icons.wifi : Icons.wifi_off, size: 15),
      label: Text(state.online ? 'Online' : 'Offline'),
      style: TextButton.styleFrom(
        foregroundColor: Theme.of(context).colorScheme.onSurfaceVariant,
        backgroundColor: SpendFlowTokens.of(context).surfaceContainer,
        shape: const RoundedRectangleBorder(borderRadius: Radii.pill),
        padding: const EdgeInsets.symmetric(horizontal: 11),
        textStyle: const TextStyle(fontSize: 11, fontWeight: FontWeight.w600),
      ),
    );
  }
}

class _NetworkBanner extends StatelessWidget {
  const _NetworkBanner();

  @override
  Widget build(BuildContext context) {
    final state = AppScope.of(context);

    if (state.synced) {
      return NoticeBanner(
        tone: ChipTone.success,
        icon: Icons.cloud_done_outlined,
        title: 'Everything is synced',
        text: 'Last sync just now · ${state.lastSyncedCount} items uploaded',
      );
    }
    if (state.online) {
      return NoticeBanner(
        tone: ChipTone.info,
        icon: Icons.cloud_outlined,
        title: 'Back online',
        text: 'Tap sync to upload ${state.pendingQueueCount} queued items and their receipts.',
      );
    }
    return const NoticeBanner(
      tone: ChipTone.warning,
      icon: Icons.cloud_off_outlined,
      title: 'No connection',
      text: 'Captures are saved on device. We retry automatically the moment '
          'you reconnect.',
    );
  }
}

class _QueueRow extends StatelessWidget {
  const _QueueRow({required this.item, required this.queueState});

  final QueueItem item;
  final QueueState queueState;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final tokens = SpendFlowTokens.of(context);

    final (String label, ChipTone tone) = switch (queueState) {
      QueueState.synced => ('Synced', ChipTone.success),
      QueueState.syncing => ('Uploading…', ChipTone.info),
      QueueState.queued => ('Waiting for network', ChipTone.warning),
    };

    return PanelCard(
      color: tokens.surfaceContainerLowest,
      padding: const EdgeInsets.all(12),
      borderRadius: Radii.lg,
      child: Row(
        children: <Widget>[
          const ReceiptThumbnail(),
          const SizedBox(width: 11),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: <Widget>[
                Text(
                  item.title,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                    fontSize: 13,
                    fontWeight: FontWeight.w600,
                  ),
                ),
                const SizedBox(height: 2),
                Text(
                  item.meta,
                  style: TextStyle(
                    fontSize: 11,
                    color: theme.colorScheme.onSurfaceVariant,
                  ),
                ),
                const SizedBox(height: 7),
                ToneChip(
                  label: label,
                  tone: tone,
                  dense: true,
                  icon: queueState == QueueState.synced ? Icons.check : null,
                  leading: queueState == QueueState.syncing
                      ? SizedBox(
                          width: 10,
                          height: 10,
                          child: CircularProgressIndicator(
                            strokeWidth: 2,
                            color: tokens.info,
                          ),
                        )
                      : queueState == QueueState.queued
                          ? Icon(
                              Icons.schedule,
                              size: 11,
                              color: tokens.onWarningContainer,
                            )
                          : null,
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
                  fontSize: 13,
                  fontWeight: FontWeight.w700,
                ),
              ),
              const SizedBox(height: 3),
              Text(
                item.size,
                style: TextStyle(
                  fontSize: 10,
                  color: theme.colorScheme.onSurfaceVariant,
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}
