import 'dart:async';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_inappwebview/flutter_inappwebview.dart';
import 'package:permission_handler/permission_handler.dart';
import 'package:shared_preferences/shared_preferences.dart';

const int serverHttpPort = 3000;
const int serverHttpsPort = 3443;
const String prefsServerKey = 'server_address';

Process? _serverProcess;

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();

  // Stop the embedded server when the Windows app is closed.
  AppLifecycleListener(
    onExitRequested: () async {
      _serverProcess?.kill();
      return AppExitResponse.exit;
    },
  );

  if (Platform.isAndroid) {
    try {
      await Permission.camera.request();
    } catch (_) {}
  }

  runApp(const ScannerApp());
}

class ScannerApp extends StatelessWidget {
  const ScannerApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'My Multi Functional Scanner',
      debugShowCheckedModeBanner: false,
      theme: ThemeData(
        useMaterial3: true,
        colorScheme: ColorScheme.fromSeed(
          seedColor: const Color(0xFF064E3B),
          primary: const Color(0xFF064E3B),
          secondary: const Color(0xFF059669),
          surface: const Color(0xFFF8FAFC),
        ),
      ),
      home: Platform.isWindows ? const WindowsHome() : const AndroidHome(),
    );
  }
}

// ---------------------------------------------------------------------------
// Windows: start the bundled Node server, then show it in a WebView.
// ---------------------------------------------------------------------------

Future<bool> _serverIsUp() async {
  final client = HttpClient()..connectionTimeout = const Duration(seconds: 1);
  try {
    final req = await client
        .getUrl(Uri.parse('http://127.0.0.1:$serverHttpPort/'))
        .timeout(const Duration(seconds: 2));
    final res = await req.close().timeout(const Duration(seconds: 2));
    await res.drain<void>();
    return res.statusCode < 500;
  } catch (_) {
    return false;
  } finally {
    client.close(force: true);
  }
}

/// Returns null on success, otherwise an error message.
Future<String?> startEmbeddedServer() async {
  if (await _serverIsUp()) return null;

  final exeDir = File(Platform.resolvedExecutable).parent.path;
  final root = '$exeDir${Platform.pathSeparator}server';
  final nodeExe = File('$root${Platform.pathSeparator}node.exe');
  final script = File('$root${Platform.pathSeparator}server.cjs');
  if (!nodeExe.existsSync() || !script.existsSync()) {
    return 'Server files not found in:\n$root';
  }

  final appData = Platform.environment['APPDATA'] ?? root;
  final dataDir = '$appData${Platform.pathSeparator}MyMultiFunctionalScanner${Platform.pathSeparator}data';
  Directory(dataDir).createSync(recursive: true);

  final errors = StringBuffer();
  try {
    _serverProcess = await Process.start(
      nodeExe.path,
      [script.path],
      workingDirectory: root,
      environment: {
        'NODE_ENV': 'production',
        'PORT': '$serverHttpPort',
        'HTTPS_PORT': '$serverHttpsPort',
        'APP_ROOT': root,
        'DATA_DIR': dataDir,
      },
    );
    _serverProcess!.stdout.drain<void>();
    _serverProcess!.stderr.transform(const SystemEncoding().decoder).listen(errors.write);
  } catch (e) {
    return 'Could not start server: $e';
  }

  for (var i = 0; i < 40; i++) {
    await Future.delayed(const Duration(milliseconds: 500));
    if (await _serverIsUp()) return null;
  }
  final tail = errors.toString();
  return 'Server did not start in time.\n${tail.length > 600 ? tail.substring(tail.length - 600) : tail}';
}

class WindowsHome extends StatefulWidget {
  const WindowsHome({super.key});

  @override
  State<WindowsHome> createState() => _WindowsHomeState();
}

class _WindowsHomeState extends State<WindowsHome> {
  late Future<String?> _start = startEmbeddedServer();

  @override
  Widget build(BuildContext context) {
    return FutureBuilder<String?>(
      future: _start,
      builder: (context, snap) {
        if (snap.connectionState != ConnectionState.done) {
          return const MessageScreen(message: 'Starting scanner server...', busy: true);
        }
        if (snap.data != null) {
          return MessageScreen(
            message: snap.data!,
            actionLabel: 'Retry',
            onAction: () => setState(() => _start = startEmbeddedServer()),
          );
        }
        return const ScannerWebView(url: 'http://localhost:$serverHttpPort/');
      },
    );
  }
}

// ---------------------------------------------------------------------------
// Android: connect to the scanner server running on the Windows PC.
// ---------------------------------------------------------------------------

String normalizeServerAddress(String input) {
  var v = input.trim();
  if (v.isEmpty) return '';
  if (v.startsWith('http://') || v.startsWith('https://')) return v;
  if (!v.contains(':')) v = '$v:$serverHttpsPort';
  return 'https://$v';
}

class AndroidHome extends StatefulWidget {
  const AndroidHome({super.key});

  @override
  State<AndroidHome> createState() => _AndroidHomeState();
}

class _AndroidHomeState extends State<AndroidHome> {
  String? _address;
  bool _loaded = false;

  @override
  void initState() {
    super.initState();
    SharedPreferences.getInstance().then((p) {
      setState(() {
        _address = p.getString(prefsServerKey);
        _loaded = true;
      });
    });
  }

  Future<void> _save(String address) async {
    final p = await SharedPreferences.getInstance();
    await p.setString(prefsServerKey, address);
    setState(() => _address = address);
  }

  Future<void> _changeAddress() async {
    final controller = TextEditingController(text: _address ?? '');
    final result = await showDialog<String>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('PC address'),
        content: TextField(
          controller: controller,
          autofocus: true,
          keyboardType: TextInputType.url,
          decoration: const InputDecoration(
            hintText: 'e.g. 192.168.1.5',
            helperText: 'Shown in the Windows app (Pairing panel). Same Wi-Fi required.',
          ),
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('Cancel')),
          FilledButton(
            onPressed: () => Navigator.pop(ctx, normalizeServerAddress(controller.text)),
            child: const Text('Connect'),
          ),
        ],
      ),
    );
    if (result != null && result.isNotEmpty) await _save(result);
  }

  @override
  Widget build(BuildContext context) {
    if (!_loaded) return const MessageScreen(message: 'Loading...', busy: true);
    if (_address == null || _address!.isEmpty) {
      return MessageScreen(
        message: 'Enter the address of the PC running\nMy Multi Functional Scanner (same Wi-Fi).',
        actionLabel: 'Enter PC address',
        onAction: _changeAddress,
      );
    }
    return ScannerWebView(
      key: ValueKey(_address),
      url: _address!,
      onChangeAddress: _changeAddress,
    );
  }
}

// ---------------------------------------------------------------------------
// Shared widgets
// ---------------------------------------------------------------------------

class ScannerWebView extends StatefulWidget {
  const ScannerWebView({super.key, required this.url, this.onChangeAddress});

  final String url;
  final VoidCallback? onChangeAddress;

  @override
  State<ScannerWebView> createState() => _ScannerWebViewState();
}

class _ScannerWebViewState extends State<ScannerWebView> {
  InAppWebViewController? _controller;
  String? _loadError;

  void _reload() {
    setState(() => _loadError = null);
    _controller?.loadUrl(urlRequest: URLRequest(url: WebUri(widget.url)));
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: SafeArea(
        child: Stack(
          children: [
            InAppWebView(
              initialUrlRequest: URLRequest(url: WebUri(widget.url)),
              initialSettings: InAppWebViewSettings(
                javaScriptEnabled: true,
                domStorageEnabled: true,
                databaseEnabled: true,
                mediaPlaybackRequiresUserGesture: false,
                allowsInlineMediaPlayback: true,
                useHybridComposition: true,
                mixedContentMode: MixedContentMode.MIXED_CONTENT_ALWAYS_ALLOW,
              ),
              onWebViewCreated: (c) => _controller = c,
              onPermissionRequest: (controller, request) async {
                return PermissionResponse(
                  resources: request.resources,
                  action: PermissionResponseAction.GRANT,
                );
              },
              // The PC server uses a self-signed certificate on the local network.
              onReceivedServerTrustAuthRequest: (controller, challenge) async {
                return ServerTrustAuthResponse(action: ServerTrustAuthResponseAction.PROCEED);
              },
              onReceivedError: (controller, request, error) {
                if (request.isForMainFrame ?? false) {
                  setState(() => _loadError = error.description);
                }
              },
            ),
            if (widget.onChangeAddress != null && _loadError == null)
              Positioned(
                right: 4,
                top: 4,
                child: IconButton(
                  tooltip: 'Change PC address',
                  icon: const Icon(Icons.settings, size: 20),
                  onPressed: widget.onChangeAddress,
                ),
              ),
            if (_loadError != null)
              MessageScreen(
                message: 'Could not open ${widget.url}\n$_loadError',
                actionLabel: 'Retry',
                onAction: _reload,
                secondaryLabel: widget.onChangeAddress != null ? 'Change PC address' : null,
                onSecondary: widget.onChangeAddress,
              ),
          ],
        ),
      ),
    );
  }
}

class MessageScreen extends StatelessWidget {
  const MessageScreen({
    super.key,
    required this.message,
    this.busy = false,
    this.actionLabel,
    this.onAction,
    this.secondaryLabel,
    this.onSecondary,
  });

  final String message;
  final bool busy;
  final String? actionLabel;
  final VoidCallback? onAction;
  final String? secondaryLabel;
  final VoidCallback? onSecondary;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: Container(
        width: double.infinity,
        padding: const EdgeInsets.all(24),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            if (busy) const CircularProgressIndicator(),
            if (busy) const SizedBox(height: 20),
            Text(message, textAlign: TextAlign.center),
            if (actionLabel != null) ...[
              const SizedBox(height: 16),
              FilledButton(onPressed: onAction, child: Text(actionLabel!)),
            ],
            if (secondaryLabel != null) ...[
              const SizedBox(height: 8),
              TextButton(onPressed: onSecondary, child: Text(secondaryLabel!)),
            ],
          ],
        ),
      ),
    );
  }
}
