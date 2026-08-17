import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../api/errors.dart';
import '../state/app_state.dart';
import '../widgets/common.dart';
import 'confirm_screen.dart';

/// Receipt capture.
///
/// There is no camera plugin behind this yet — the viewfinder is a stand-in so
/// the framing, controls and the scan hand-off can be exercised on a device
/// before the platform channel lands.
class CaptureScreen extends StatefulWidget {
  const CaptureScreen({super.key});

  static const String routeName = '/capture';

  @override
  State<CaptureScreen> createState() => _CaptureScreenState();
}

class _CaptureScreenState extends State<CaptureScreen> {
  @override
  void initState() {
    super.initState();
    // Each visit starts a fresh capture — page 1, no leftover scan progress.
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) AppScope.read(context).resetCapture();
    });
  }

  Future<void> _shoot() async {
    final state = AppScope.read(context);
    final wasMultiPage =
        state.variant == AppVariant.captureMultishot && state.shots < 3;

    final bool finished;
    try {
      finished = await state.shoot();
    } on ApiException catch (error) {
      // Back to the viewfinder, message up top — the retake is the recovery.
      if (mounted) showToast(context, error.message);
      return;
    }

    if (!mounted) return;
    if (!finished) {
      showToast(
        context,
        wasMultiPage
            ? 'Page ${state.shots} captured — shoot the next one, or tap the shutter again to finish'
            : 'Page captured',
      );
      return;
    }
    await Navigator.of(context).pushReplacementNamed(ConfirmScreen.routeName);
  }

  @override
  Widget build(BuildContext context) {
    final state = AppScope.of(context);

    return AnnotatedRegion<SystemUiOverlayStyle>(
      value: SystemUiOverlayStyle.light,
      child: Scaffold(
        backgroundColor: const Color(0xFF111014),
        body: SafeArea(
          child: state.scanning || state.scanPercent >= 100
              ? const _ScanningView()
              : _ViewfinderView(onShoot: _shoot),
        ),
      ),
    );
  }
}

class _ViewfinderView extends StatelessWidget {
  const _ViewfinderView({required this.onShoot});

  final Future<void> Function() onShoot;

  @override
  Widget build(BuildContext context) {
    final state = AppScope.of(context);
    final multiPage = state.variant == AppVariant.captureMultishot;

    return Column(
      children: <Widget>[
        _CaptureTopBar(
          title: multiPage
              ? 'Multi-page receipt · page ${state.shots}'
              : 'Position the receipt',
        ),
        Expanded(
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 26),
            child: Center(
              child: AspectRatio(
                aspectRatio: 3 / 4,
                child: _Viewfinder(
                  hint: state.autoCrop
                      ? 'Edges locked · hold steady'
                      : 'Manual crop — drag the corners',
                ),
              ),
            ),
          ),
        ),
        if (multiPage) _PageStrip(shots: state.shots),
        _CaptureControls(onShoot: onShoot),
      ],
    );
  }
}

class _CaptureTopBar extends StatelessWidget {
  const _CaptureTopBar({required this.title});

  final String title;

  @override
  Widget build(BuildContext context) {
    final state = AppScope.of(context);
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 14),
      child: Row(
        children: <Widget>[
          _GlassButton(
            icon: Icons.close,
            tooltip: 'Cancel capture',
            onPressed: () => Navigator.of(context).maybePop(),
          ),
          Expanded(
            child: Text(
              title,
              textAlign: TextAlign.center,
              style: const TextStyle(
                fontSize: 13,
                fontWeight: FontWeight.w500,
                letterSpacing: 0.2,
                color: Colors.white,
              ),
            ),
          ),
          _GlassButton(
            icon: state.torch ? Icons.flash_on : Icons.flash_off,
            tooltip: state.torch ? 'Turn torch off' : 'Turn torch on',
            active: state.torch,
            onPressed: state.toggleTorch,
          ),
        ],
      ),
    );
  }
}

class _GlassButton extends StatelessWidget {
  const _GlassButton({
    required this.icon,
    required this.onPressed,
    required this.tooltip,
    this.active = false,
  });

  final IconData icon;
  final VoidCallback onPressed;
  final String tooltip;
  final bool active;

  @override
  Widget build(BuildContext context) {
    return Tooltip(
      message: tooltip,
      child: Material(
        color: Colors.white.withValues(alpha: active ? 0.3 : 0.12),
        shape: const CircleBorder(),
        child: InkWell(
          customBorder: const CircleBorder(),
          onTap: onPressed,
          child: SizedBox(
            width: 40,
            height: 40,
            child: Icon(icon, size: 18, color: Colors.white),
          ),
        ),
      ),
    );
  }
}

/// Stand-in preview: a receipt lying on a dark surface with the auto-detected
/// edges locked on.
class _Viewfinder extends StatelessWidget {
  const _Viewfinder({required this.hint});

  final String hint;

  @override
  Widget build(BuildContext context) {
    final primary = Theme.of(context).colorScheme.primary;

    Widget corner(Alignment alignment) {
      final isLeft = alignment.x < 0;
      final isTop = alignment.y < 0;
      return Align(
        alignment: alignment,
        child: Container(
          width: 34,
          height: 34,
          decoration: BoxDecoration(
            border: Border(
              left: isLeft ? BorderSide(color: primary, width: 3) : BorderSide.none,
              right:
                  !isLeft ? BorderSide(color: primary, width: 3) : BorderSide.none,
              top: isTop ? BorderSide(color: primary, width: 3) : BorderSide.none,
              bottom:
                  !isTop ? BorderSide(color: primary, width: 3) : BorderSide.none,
            ),
            borderRadius: BorderRadius.only(
              topLeft: isLeft && isTop ? const Radius.circular(6) : Radius.zero,
              topRight: !isLeft && isTop ? const Radius.circular(6) : Radius.zero,
              bottomLeft:
                  isLeft && !isTop ? const Radius.circular(6) : Radius.zero,
              bottomRight:
                  !isLeft && !isTop ? const Radius.circular(6) : Radius.zero,
            ),
          ),
        ),
      );
    }

    return Container(
      clipBehavior: Clip.hardEdge,
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(14),
        gradient: const LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: <Color>[Color(0xFF3A3742), Color(0xFF22202A), Color(0xFF15141A)],
          stops: <double>[0, 0.55, 1],
        ),
      ),
      child: Stack(
        children: <Widget>[
          Positioned.fill(
            left: 40,
            right: 40,
            top: 34,
            bottom: 34,
            child: Transform.rotate(
              angle: -0.024,
              child: const _PaperSheet(),
            ),
          ),
          Padding(
            padding: const EdgeInsets.fromLTRB(22, 18, 22, 18),
            child: Stack(
              children: <Widget>[
                corner(Alignment.topLeft),
                corner(Alignment.topRight),
                corner(Alignment.bottomLeft),
                corner(Alignment.bottomRight),
              ],
            ),
          ),
          Positioned(
            left: 0,
            right: 0,
            bottom: 12,
            child: Center(
              child: Container(
                padding:
                    const EdgeInsets.symmetric(horizontal: 12, vertical: 5),
                decoration: BoxDecoration(
                  color: const Color(0xFF111014).withValues(alpha: 0.72),
                  borderRadius: BorderRadius.circular(999),
                ),
                child: Text(
                  hint,
                  style: const TextStyle(
                    fontSize: 11,
                    fontWeight: FontWeight.w500,
                    color: Colors.white,
                  ),
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

/// Blank receipt shape used inside the viewfinder and the scan animation.
class _PaperSheet extends StatelessWidget {
  const _PaperSheet();

  @override
  Widget build(BuildContext context) {
    Widget bar(double factor, Color color, double height) => FractionallySizedBox(
          alignment: Alignment.centerLeft,
          widthFactor: factor,
          child: Container(
            height: height,
            decoration: BoxDecoration(
              color: color,
              borderRadius: BorderRadius.circular(2),
            ),
          ),
        );

    const ink = Color(0xFF20202A);
    const faded = Color(0xFFC9C6BD);
    const rule = Color(0xFFDED9CF);

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 16),
      decoration: BoxDecoration(
        color: const Color(0xFFF6F4EF),
        borderRadius: BorderRadius.circular(4),
        boxShadow: <BoxShadow>[
          BoxShadow(
            color: Colors.black.withValues(alpha: 0.5),
            blurRadius: 30,
            offset: const Offset(0, 14),
          ),
        ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          bar(0.64, ink, 9),
          const SizedBox(height: 7),
          bar(0.82, faded, 5),
          const SizedBox(height: 7),
          bar(1, rule, 1),
          const SizedBox(height: 7),
          bar(0.92, faded, 5),
          const SizedBox(height: 7),
          bar(0.74, faded, 5),
          const SizedBox(height: 7),
          bar(0.86, faded, 5),
          const SizedBox(height: 7),
          bar(1, rule, 1),
          const SizedBox(height: 7),
          bar(0.56, ink, 8),
        ],
      ),
    );
  }
}

/// Guided page strip for folded or multi-sheet receipts — the shots merge into
/// one expense.
class _PageStrip extends StatelessWidget {
  const _PageStrip({required this.shots});

  final int shots;

  @override
  Widget build(BuildContext context) {
    final primary = Theme.of(context).colorScheme.primary;
    return Padding(
      padding: const EdgeInsets.fromLTRB(22, 14, 22, 0),
      child: Row(
        children: <Widget>[
          for (var i = 1; i <= shots; i++)
            Padding(
              padding: const EdgeInsets.only(right: 8),
              child: Container(
                width: 44,
                height: 56,
                padding: const EdgeInsets.all(3),
                alignment: Alignment.bottomRight,
                decoration: BoxDecoration(
                  color: const Color(0xFFF6F4EF),
                  borderRadius: BorderRadius.circular(7),
                  border: Border.all(color: primary, width: 2),
                ),
                child: Container(
                  width: 15,
                  height: 15,
                  alignment: Alignment.center,
                  decoration: BoxDecoration(color: primary, shape: BoxShape.circle),
                  child: Text(
                    '$i',
                    style: const TextStyle(
                      fontSize: 9,
                      fontWeight: FontWeight.w600,
                      color: Colors.white,
                    ),
                  ),
                ),
              ),
            ),
          Container(
            width: 44,
            height: 56,
            alignment: Alignment.center,
            decoration: BoxDecoration(
              borderRadius: BorderRadius.circular(7),
              border: Border.all(
                color: Colors.white.withValues(alpha: 0.4),
                width: 1.5,
              ),
            ),
            child: Icon(
              Icons.add,
              size: 16,
              color: Colors.white.withValues(alpha: 0.55),
            ),
          ),
          const SizedBox(width: 10),
          Expanded(
            child: Text(
              shots < 3
                  ? 'Shoot each page — they merge into one expense'
                  : 'Tap the shutter to finish',
              style: TextStyle(
                fontSize: 11,
                height: 1.4,
                color: Colors.white.withValues(alpha: 0.6),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _CaptureControls extends StatelessWidget {
  const _CaptureControls({required this.onShoot});

  final Future<void> Function() onShoot;

  @override
  Widget build(BuildContext context) {
    final state = AppScope.of(context);
    final primary = Theme.of(context).colorScheme.primary;

    return Padding(
      padding: const EdgeInsets.fromLTRB(34, 22, 34, 30),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: <Widget>[
          _ControlAction(
            icon: Icons.description_outlined,
            label: 'PDF / file',
            onTap: () {
              showToast(context, 'Choose a PDF or image from Files');
              onShoot();
            },
          ),
          Semantics(
            button: true,
            label: 'Capture receipt',
            child: GestureDetector(
              onTap: onShoot,
              child: Container(
                width: 74,
                height: 74,
                alignment: Alignment.center,
                decoration: BoxDecoration(
                  color: primary,
                  shape: BoxShape.circle,
                  border: Border.all(
                    color: Colors.white.withValues(alpha: 0.9),
                    width: 4,
                  ),
                  boxShadow: <BoxShadow>[
                    BoxShadow(
                      color: primary.withValues(alpha: 0.22),
                      blurRadius: 0,
                      spreadRadius: 6,
                    ),
                  ],
                ),
                child: const Icon(
                  Icons.photo_camera_outlined,
                  size: 26,
                  color: Colors.white,
                ),
              ),
            ),
          ),
          _ControlAction(
            icon: Icons.crop_free,
            label: state.autoCrop ? 'Auto-crop' : 'Manual',
            onTap: () {
              state.toggleAutoCrop();
              showToast(
                context,
                state.autoCrop
                    ? 'Auto edge detection on'
                    : 'Manual crop — drag the corners',
              );
            },
          ),
        ],
      ),
    );
  }
}

class _ControlAction extends StatelessWidget {
  const _ControlAction({
    required this.icon,
    required this.label,
    required this.onTap,
  });

  final IconData icon;
  final String label;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final tint = Colors.white.withValues(alpha: 0.75);
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(12),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: <Widget>[
          Container(
            width: 44,
            height: 44,
            alignment: Alignment.center,
            decoration: BoxDecoration(
              color: Colors.white.withValues(alpha: 0.12),
              borderRadius: BorderRadius.circular(12),
            ),
            child: Icon(icon, size: 20, color: tint),
          ),
          const SizedBox(height: 5),
          Text(label, style: TextStyle(fontSize: 10, color: tint)),
        ],
      ),
    );
  }
}

/// The OCR pass: an on-device read first, then a cloud check when there is a
/// network. Progress is staged so the wait explains itself.
class _ScanningView extends StatelessWidget {
  const _ScanningView();

  @override
  Widget build(BuildContext context) {
    final state = AppScope.of(context);
    final primary = Theme.of(context).colorScheme.primary;

    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 34),
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: <Widget>[
          SizedBox(
            width: 180,
            height: 230,
            child: Stack(
              children: <Widget>[
                const Positioned.fill(child: _PaperSheet()),
                // Sweep tracks progress rather than looping, so the bar and the
                // beam always agree on how far along the read is.
                Positioned(
                  left: 0,
                  right: 0,
                  top: (230 - 42) * (state.scanPercent / 100),
                  child: Container(
                    height: 42,
                    decoration: BoxDecoration(
                      gradient: LinearGradient(
                        begin: Alignment.topCenter,
                        end: Alignment.bottomCenter,
                        colors: <Color>[
                          primary.withValues(alpha: 0),
                          primary.withValues(alpha: 0.55),
                        ],
                      ),
                    ),
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(height: 26),
          ClipRRect(
            borderRadius: BorderRadius.circular(999),
            child: LinearProgressIndicator(
              value: state.scanPercent / 100,
              minHeight: 4,
              backgroundColor: Colors.white.withValues(alpha: 0.16),
              valueColor: AlwaysStoppedAnimation<Color>(primary),
            ),
          ),
          const SizedBox(height: 10),
          Text(
            state.scanStage.label,
            style: const TextStyle(
              fontSize: 14,
              fontWeight: FontWeight.w500,
              color: Colors.white,
            ),
          ),
          const SizedBox(height: 6),
          Text(
            state.scanSubtitle,
            textAlign: TextAlign.center,
            style: TextStyle(
              fontSize: 12,
              height: 1.5,
              color: Colors.white.withValues(alpha: 0.55),
            ),
          ),
        ],
      ),
    );
  }
}
