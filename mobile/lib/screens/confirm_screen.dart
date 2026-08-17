import 'package:flutter/material.dart';

import '../api/errors.dart';
import '../data/fixtures.dart';
import '../models/models.dart';
import '../state/app_state.dart';
import '../theme/tokens.dart';
import '../widgets/common.dart';
import '../widgets/receipt.dart';
import '../widgets/status_chip.dart';
import 'capture_screen.dart';
import 'draft_screen.dart';

/// Confirm what the OCR read.
///
/// The rule this screen exists to enforce: nothing is submitted from raw OCR.
/// Every field sits beside the crop it came from, low-confidence fields carry
/// an amber CHECK THIS chip, and the only way onward is an explicit confirm.
class ConfirmScreen extends StatefulWidget {
  const ConfirmScreen({super.key});

  static const String routeName = '/confirm';

  @override
  State<ConfirmScreen> createState() => _ConfirmScreenState();
}

class _ConfirmScreenState extends State<ConfirmScreen> {
  final Map<OcrFieldKey, TextEditingController> _controllers =
      <OcrFieldKey, TextEditingController>{};
  late final TextEditingController _descriptionController;

  @override
  void initState() {
    super.initState();
    final draft = AppScope.read(context).draft;
    for (final field in Fixtures.ocrFields) {
      _controllers[field.key] =
          TextEditingController(text: draft.valueOf(field.key));
    }
    _descriptionController = TextEditingController(text: draft.description);
  }

  @override
  void dispose() {
    for (final controller in _controllers.values) {
      controller.dispose();
    }
    _descriptionController.dispose();
    super.dispose();
  }

  Future<void> _confirm() async {
    final state = AppScope.read(context);
    try {
      await state.saveDraft(state.draft);
    } on ApiException catch (error) {
      // Stay on the confirm screen — the edits are kept for a retry.
      if (mounted) showToast(context, error.message);
      return;
    }
    if (!mounted) return;
    state.confirmLine();
    // Toast first: the messenger lives above the navigator, so the message
    // survives the route swap.
    showToast(context, 'Added to ${Fixtures.draftClaimTitle}');
    Navigator.of(context).pushReplacementNamed(DraftScreen.routeName);
  }

  @override
  Widget build(BuildContext context) {
    final state = AppScope.of(context);
    final theme = Theme.of(context);

    return Scaffold(
      appBar: AppBar(
        titleSpacing: 0,
        title: const Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          mainAxisAlignment: MainAxisAlignment.center,
          children: <Widget>[
            Text(
              'Confirm extraction',
              style: TextStyle(fontSize: 15, fontWeight: FontWeight.w600),
            ),
            Text(
              'Nothing is submitted until you confirm',
              style: TextStyle(fontSize: 11, fontWeight: FontWeight.w400),
            ),
          ],
        ),
        actions: <Widget>[
          Padding(
            padding: const EdgeInsets.only(right: 12),
            child: Center(
              child: ToneChip(
                label: Fixtures.capturedFileName,
                icon: Icons.photo_camera_outlined,
                bordered: true,
                dense: true,
              ),
            ),
          ),
        ],
      ),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(14, 14, 14, 24),
        children: <Widget>[
          NoticeBanner(
            tone: ChipTone.info,
            icon: Icons.info_outline,
            text: state.online
                ? 'Check every field before adding. Nothing reaches your approver until you tap confirm.'
                : 'Offline — extracted on device. Nothing reaches your approver until you tap confirm.',
          ),
          const SizedBox(height: 12),
          const _CategoryAndCurrency(),
          const SizedBox(height: 12),
          for (final field in Fixtures.ocrFields) ...<Widget>[
            _FieldCard(
              definition: field,
              controller: _controllers[field.key]!,
            ),
            const SizedBox(height: 12),
          ],
          if (state.overCap) ...<Widget>[
            NoticeBanner(
              tone: ChipTone.warning,
              icon: Icons.warning_amber_rounded,
              text: state.capMessage,
            ),
            const SizedBox(height: 12),
          ],
          PanelCard(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: <Widget>[
                const _FieldLabel('Description'),
                const SizedBox(height: 6),
                TextField(
                  controller: _descriptionController,
                  onChanged: state.setDescription,
                  style: const TextStyle(fontSize: 14),
                ),
                const SizedBox(height: 10),
                Text(
                  'Add to which claim?',
                  style: TextStyle(
                    fontSize: 10.5,
                    color: theme.colorScheme.onSurfaceVariant,
                  ),
                ),
                const SizedBox(height: 6),
                InkWell(
                  borderRadius: Radii.md,
                  onTap: () => showToast(
                    context,
                    'Pick an open claim, or create a new one',
                  ),
                  child: Container(
                    height: 48,
                    padding: const EdgeInsets.symmetric(horizontal: 12),
                    decoration: BoxDecoration(
                      color: SpendFlowTokens.of(context).surfaceContainerHigh,
                      borderRadius: Radii.md,
                      border: Border.all(color: theme.colorScheme.outline),
                    ),
                    child: Row(
                      children: <Widget>[
                        const Expanded(
                          child: Text(
                            '${Fixtures.draftClaimTitle} (draft)',
                            style: TextStyle(
                              fontSize: 13,
                              fontWeight: FontWeight.w500,
                            ),
                            overflow: TextOverflow.ellipsis,
                          ),
                        ),
                        Icon(
                          Icons.expand_more,
                          size: 18,
                          color: theme.colorScheme.onSurfaceVariant,
                        ),
                      ],
                    ),
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
      bottomNavigationBar: BottomActionBar(
        children: <Widget>[
          OutlinedButton(
            // Back to the viewfinder, not out of the flow — confirm replaced
            // the capture route, so a plain pop would land on home.
            onPressed: () => Navigator.of(context)
                .pushReplacementNamed(CaptureScreen.routeName),
            child: const Text('Retake'),
          ),
          const SizedBox(width: 9),
          Expanded(
            child: FilledButton.icon(
              onPressed: _confirm,
              icon: const Icon(Icons.check, size: 18),
              label: const Text('Confirm & add'),
            ),
          ),
        ],
      ),
    );
  }
}

/// Suggested category (tap to change) and the detected currency.
class _CategoryAndCurrency extends StatelessWidget {
  const _CategoryAndCurrency();

  @override
  Widget build(BuildContext context) {
    final state = AppScope.of(context);
    final theme = Theme.of(context);
    final category = state.draftCategory;

    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: <Widget>[
        SizedBox(
          width: 126,
          height: 124,
          child: Stack(
            children: <Widget>[
              Positioned.fill(
                child: Container(
                  clipBehavior: Clip.hardEdge,
                  decoration: BoxDecoration(
                    color: SpendFlowTokens.of(context).receiptPaper,
                    borderRadius: Radii.md,
                    border: Border.all(color: theme.colorScheme.outlineVariant),
                  ),
                  child: const FittedBox(
                    fit: BoxFit.fitWidth,
                    alignment: Alignment.topLeft,
                    child: ReceiptFacsimile(),
                  ),
                ),
              ),
              Positioned(
                right: 6,
                bottom: 6,
                child: Material(
                  color: const Color(0xFF111014).withValues(alpha: 0.72),
                  borderRadius: BorderRadius.circular(8),
                  child: InkWell(
                    borderRadius: BorderRadius.circular(8),
                    onTap: () => ReceiptSheet.show(context),
                    child: const Padding(
                      padding:
                          EdgeInsets.symmetric(horizontal: 7, vertical: 4),
                      child: Text(
                        'Zoom',
                        style: TextStyle(
                          fontSize: 10,
                          fontWeight: FontWeight.w500,
                          color: Colors.white,
                        ),
                      ),
                    ),
                  ),
                ),
              ),
            ],
          ),
        ),
        const SizedBox(width: 10),
        Expanded(
          child: Column(
            children: <Widget>[
              PanelCard(
                padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
                borderRadius: Radii.md,
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: <Widget>[
                    const _FieldLabel('Suggested category'),
                    const SizedBox(height: 7),
                    Row(
                      children: <Widget>[
                        CodeBadge(
                          code: category.code,
                          tone: ChipTone.primary,
                          size: 26,
                        ),
                        const SizedBox(width: 7),
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: <Widget>[
                              Text(
                                category.name,
                                overflow: TextOverflow.ellipsis,
                                style: const TextStyle(
                                  fontSize: 13,
                                  fontWeight: FontWeight.w600,
                                ),
                              ),
                              Text(
                                Fixtures.categoryConfidence,
                                maxLines: 2,
                                overflow: TextOverflow.ellipsis,
                                style: TextStyle(
                                  fontSize: 10,
                                  color: theme.colorScheme.onSurfaceVariant,
                                ),
                              ),
                            ],
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 9),
                    SizedBox(
                      width: double.infinity,
                      child: OutlinedButton(
                        onPressed: state.cycleCategory,
                        style: OutlinedButton.styleFrom(
                          minimumSize: const Size(0, 32),
                          textStyle: const TextStyle(fontSize: 12),
                        ),
                        child: const Text('Change category'),
                      ),
                    ),
                  ],
                ),
              ),
              const SizedBox(height: 8),
              PanelCard(
                padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
                borderRadius: Radii.md,
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: <Widget>[
                    const _FieldLabel('Detected currency'),
                    const SizedBox(height: 6),
                    Text(
                      '${state.draft.currency} · Indonesian Rupiah',
                      style: const TextStyle(
                        fontSize: 13,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                    const SizedBox(height: 2),
                    Text(
                      'Matches claim currency',
                      style: TextStyle(
                        fontSize: 10,
                        color: theme.colorScheme.onSurfaceVariant,
                      ),
                    ),
                  ],
                ),
              ),
            ],
          ),
        ),
      ],
    );
  }
}

/// One extracted field: its confidence chip, the receipt row it was read from,
/// and an editable input.
class _FieldCard extends StatelessWidget {
  const _FieldCard({required this.definition, required this.controller});

  final OcrFieldDef definition;
  final TextEditingController controller;

  @override
  Widget build(BuildContext context) {
    final state = AppScope.of(context);
    final theme = Theme.of(context);
    final tokens = SpendFlowTokens.of(context);

    final lowConfidence = definition.confidence == FieldConfidence.low;
    final focused = state.focusedField == definition.key;

    final borderColor = focused
        ? theme.colorScheme.primary
        : lowConfidence
            ? tokens.warning
            : theme.colorScheme.outlineVariant;

    return PanelCard(
      color: tokens.surfaceContainerLowest,
      padding: const EdgeInsets.all(10),
      borderRadius: Radii.lg,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Row(
            children: <Widget>[
              _FieldLabel(definition.label),
              const SizedBox(width: 6),
              ToneChip(
                label: lowConfidence ? 'CHECK THIS' : 'SCANNED',
                tone: lowConfidence ? ChipTone.warning : ChipTone.neutral,
                dense: true,
              ),
              const Spacer(),
              Text(
                'SOURCE ROW ↓',
                style: TextStyle(
                  fontSize: 9,
                  fontWeight: FontWeight.w500,
                  letterSpacing: 0.3,
                  color: theme.colorScheme.onSurfaceVariant,
                ),
              ),
            ],
          ),
          const SizedBox(height: 7),
          ReceiptCrop(
            offsetY: definition.cropTop,
            borderColor: borderColor,
            borderWidth: focused || lowConfidence ? 2 : 1,
            tint: focused
                ? theme.colorScheme.primary.withValues(alpha: 0.08)
                : lowConfidence
                    ? tokens.warning.withValues(alpha: 0.09)
                    : null,
          ),
          const SizedBox(height: 7),
          TextField(
            controller: controller,
            onTap: () => state.focusField(definition.key),
            onChanged: (value) => state.setField(definition.key, value),
            style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w500),
            decoration: InputDecoration(
              helperText: definition.helper,
              enabledBorder: OutlineInputBorder(
                borderRadius: Radii.md,
                borderSide: BorderSide(
                  color: lowConfidence ? tokens.warning : theme.colorScheme.outline,
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _FieldLabel extends StatelessWidget {
  const _FieldLabel(this.text);

  final String text;

  @override
  Widget build(BuildContext context) {
    return Text(
      text.toUpperCase(),
      style: TextStyle(
        fontSize: 11,
        fontWeight: FontWeight.w600,
        letterSpacing: 0.3,
        color: Theme.of(context).colorScheme.onSurfaceVariant,
      ),
    );
  }
}
