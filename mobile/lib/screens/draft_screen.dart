import 'package:flutter/material.dart';

import '../data/fixtures.dart';
import '../models/models.dart';
import '../state/app_state.dart';
import '../theme/tokens.dart';
import '../util/currency.dart';
import '../widgets/common.dart';
import '../widgets/status_chip.dart';
import 'capture_screen.dart';
import 'queue_screen.dart';
import 'success_screen.dart';

/// The open draft claim: its line items, the running total, and the submit
/// action — which becomes "Queue for submission" when there is no network.
class DraftScreen extends StatelessWidget {
  const DraftScreen({super.key});

  static const String routeName = '/draft';

  void _submit(BuildContext context) {
    final state = AppScope.read(context);
    final wentThrough = state.submitClaim();
    if (wentThrough) {
      Navigator.of(context).pushReplacementNamed(SuccessScreen.routeName);
      return;
    }
    showToast(context, 'Queued on device — will submit when you reconnect');
    Navigator.of(context).pushReplacementNamed(QueueScreen.routeName);
  }

  @override
  Widget build(BuildContext context) {
    final state = AppScope.of(context);
    final theme = Theme.of(context);
    final tokens = SpendFlowTokens.of(context);
    final lines = state.draftLines;

    return Scaffold(
      appBar: AppBar(
        titleSpacing: 0,
        title: const Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          mainAxisAlignment: MainAxisAlignment.center,
          children: <Widget>[
            Text(
              Fixtures.draftClaimTitle,
              style: TextStyle(fontSize: 15, fontWeight: FontWeight.w600),
            ),
            Text(
              '${Fixtures.draftClaimId} · Draft',
              style: TextStyle(fontSize: 11, fontWeight: FontWeight.w400),
            ),
          ],
        ),
      ),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(16, 14, 16, 24),
        children: <Widget>[
          PanelCard(
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: <Widget>[
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: <Widget>[
                      _MicroLabel('Trip'),
                      const SizedBox(height: 5),
                      const Text(
                        Fixtures.draftClaimTrip,
                        style: TextStyle(
                          fontSize: 13,
                          fontWeight: FontWeight.w500,
                        ),
                      ),
                    ],
                  ),
                ),
                Column(
                  crossAxisAlignment: CrossAxisAlignment.end,
                  children: <Widget>[
                    _MicroLabel('Total'),
                    const SizedBox(height: 5),
                    Text(
                      formatIdr(state.draftTotal),
                      style: const TextStyle(
                        fontSize: 16,
                        fontWeight: FontWeight.w700,
                        letterSpacing: -0.3,
                      ),
                    ),
                  ],
                ),
              ],
            ),
          ),
          const SizedBox(height: 14),
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: <Widget>[
              Text.rich(
                TextSpan(
                  text: 'Line items ',
                  style: const TextStyle(
                    fontSize: 13.5,
                    fontWeight: FontWeight.w600,
                  ),
                  children: <InlineSpan>[
                    TextSpan(
                      text: '(${lines.length})',
                      style: TextStyle(
                        fontWeight: FontWeight.w500,
                        color: theme.colorScheme.onSurfaceVariant,
                      ),
                    ),
                  ],
                ),
              ),
              TextButton.icon(
                onPressed: () =>
                    Navigator.of(context).pushNamed(CaptureScreen.routeName),
                icon: const Icon(Icons.photo_camera_outlined, size: 16),
                label: const Text('Scan receipt'),
                style: TextButton.styleFrom(
                  backgroundColor: theme.colorScheme.secondaryContainer,
                  foregroundColor: theme.colorScheme.onSecondaryContainer,
                  shape: const RoundedRectangleBorder(borderRadius: Radii.pill),
                  padding: const EdgeInsets.symmetric(horizontal: 13),
                ),
              ),
            ],
          ),
          const SizedBox(height: 10),
          for (final line in lines) ...<Widget>[
            _LineItemCard(line: line),
            const SizedBox(height: 10),
          ],
          PanelCard(
            padding: const EdgeInsets.all(13),
            borderRadius: Radii.lg,
            child: Column(
              children: <Widget>[
                _TotalRow(
                  label: 'Subtotal',
                  value: formatIdr(state.draftTotal),
                ),
                const SizedBox(height: 9),
                _TotalRow(
                  label: 'Policy flags',
                  value: state.flaggedCount == 0
                      ? 'None'
                      : '${state.flaggedCount} to review',
                  valueColor:
                      state.flaggedCount == 0 ? null : tokens.warning,
                ),
                const SizedBox(height: 9),
                Divider(color: theme.colorScheme.outlineVariant),
                const SizedBox(height: 9),
                Row(
                  crossAxisAlignment: CrossAxisAlignment.baseline,
                  textBaseline: TextBaseline.alphabetic,
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: <Widget>[
                    Text(
                      'Claim total (IDR)',
                      style: TextStyle(
                        fontSize: 12.5,
                        fontWeight: FontWeight.w500,
                        color: theme.colorScheme.onSurfaceVariant,
                      ),
                    ),
                    Text(
                      formatIdr(state.draftTotal),
                      style: const TextStyle(
                        fontSize: 18,
                        fontWeight: FontWeight.w700,
                        letterSpacing: -0.4,
                      ),
                    ),
                  ],
                ),
              ],
            ),
          ),
          const SizedBox(height: 12),
          Text(
            'Routes to ${Fixtures.approverName} for approval. Flagged lines go '
            'to Finance for exception review — you can still submit.',
            style: TextStyle(
              fontSize: 11,
              height: 1.5,
              color: theme.colorScheme.onSurfaceVariant,
            ),
          ),
        ],
      ),
      bottomNavigationBar: BottomActionBar(
        children: <Widget>[
          OutlinedButton(
            onPressed: () {
              showToast(context, 'Draft saved on device');
              Navigator.of(context).maybePop();
            },
            child: const Text('Save draft'),
          ),
          const SizedBox(width: 9),
          Expanded(
            child: FilledButton.icon(
              onPressed: () => _submit(context),
              icon: Icon(
                state.online ? Icons.send_outlined : Icons.save_outlined,
                size: 18,
              ),
              label: Text(
                state.online ? 'Submit claim' : 'Queue for submission',
              ),
            ),
          ),
        ],
      ),
    );
  }
}

/// One line on the draft, with its receipt file, provenance and policy flag.
class _LineItemCard extends StatelessWidget {
  const _LineItemCard({required this.line});

  final ClaimLine line;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final tokens = SpendFlowTokens.of(context);
    final isOcr = line.source == LineSource.ocr;

    return PanelCard(
      color: tokens.surfaceContainerLowest,
      padding: const EdgeInsets.all(12),
      borderRadius: Radii.lg,
      borderColor: line.isFlagged
          ? tokens.warning.withValues(alpha: 0.5)
          : theme.colorScheme.outlineVariant,
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          CodeBadge(
            code: line.code,
            tone: isOcr ? ChipTone.primary : ChipTone.neutral,
            size: 34,
          ),
          const SizedBox(width: 11),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: <Widget>[
                Text(
                  line.description,
                  style: const TextStyle(
                    fontSize: 13,
                    fontWeight: FontWeight.w600,
                  ),
                ),
                const SizedBox(height: 2),
                Text(
                  line.meta,
                  style: TextStyle(
                    fontSize: 11,
                    color: theme.colorScheme.onSurfaceVariant,
                  ),
                ),
                if (line.isFlagged) ...<Widget>[
                  const SizedBox(height: 7),
                  Container(
                    padding: const EdgeInsets.symmetric(
                      horizontal: 8,
                      vertical: 6,
                    ),
                    decoration: BoxDecoration(
                      color: tokens.warningContainer,
                      borderRadius: Radii.sm,
                    ),
                    child: Row(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: <Widget>[
                        Icon(
                          Icons.warning_amber_rounded,
                          size: 14,
                          color: tokens.onWarningContainer,
                        ),
                        const SizedBox(width: 6),
                        Expanded(
                          child: Text(
                            line.flagText!,
                            style: TextStyle(
                              fontSize: 10.5,
                              height: 1.4,
                              color: tokens.onWarningContainer,
                            ),
                          ),
                        ),
                      ],
                    ),
                  ),
                ],
                const SizedBox(height: 7),
                Wrap(
                  spacing: 6,
                  runSpacing: 4,
                  crossAxisAlignment: WrapCrossAlignment.center,
                  children: <Widget>[
                    if (line.file != null)
                      ToneChip(
                        label: line.file!,
                        icon: Icons.insert_drive_file_outlined,
                        bordered: true,
                        dense: true,
                      ),
                    Text(
                      isOcr ? 'OCR confirmed' : 'manual entry',
                      style: TextStyle(
                        fontSize: 10,
                        fontWeight: FontWeight.w500,
                        color: isOcr
                            ? tokens.success
                            : theme.colorScheme.onSurfaceVariant,
                      ),
                    ),
                  ],
                ),
              ],
            ),
          ),
          const SizedBox(width: 8),
          Text(
            formatIdr(line.amount),
            style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w700),
          ),
        ],
      ),
    );
  }
}

class _TotalRow extends StatelessWidget {
  const _TotalRow({required this.label, required this.value, this.valueColor});

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
            fontWeight: valueColor == null ? FontWeight.w500 : FontWeight.w600,
            color: valueColor ?? theme.colorScheme.onSurface,
          ),
        ),
      ],
    );
  }
}

class _MicroLabel extends StatelessWidget {
  const _MicroLabel(this.text);

  final String text;

  @override
  Widget build(BuildContext context) {
    return Text(
      text.toUpperCase(),
      style: TextStyle(
        fontSize: 10.5,
        fontWeight: FontWeight.w600,
        letterSpacing: 0.6,
        color: Theme.of(context).colorScheme.onSurfaceVariant,
      ),
    );
  }
}
