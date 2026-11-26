// Windows entry point (built with: flutter build windows -t lib/main_windows.dart).
// Starts the bundled Node server and opens the scanner in an Edge "app" window.
// It deliberately has no WebView plugin dependency.
import 'dart:async';
import 'dart:io';

import 'package:flutter/material.dart';

const int serverHttpPort = 3000;
const int serverHttpsPort = 3443;
const String appUrl = 'http://localhost:$serverHttpPort/';

Process? _serverProcess;

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  AppLifecycleListener(onDetach: () => _serverProcess?.kill());
  runApp(const LauncherApp());
}

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
  final dataDir =
      '$appData${Platform.pathSeparator}MyMultiFunctionalScanner${Platform.pathSeparator}data';
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

Future<void> openScanner() async {
  try {
    final r = await Process.run('cmd', ['/c', 'start', '', 'msedge', '--app=$appUrl']);
    if (r.exitCode == 0) return;
  } catch (_) {}
  try {
    await Process.run('cmd', ['/c', 'start', '', appUrl]);
  } catch (_) {}
}

Future<List<String>> lanAddresses() async {
  final out = <String>[];
  try {
    for (final ni in await NetworkInterface.list(type: InternetAddressType.IPv4)) {
      for (final a in ni.addresses) {
        if (!a.isLoopback) out.add(a.address);
      }
    }
  } catch (_) {}
  return out;
}

class LauncherApp extends StatelessWidget {
  const LauncherApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'Oklivo Scanner',
      debugShowCheckedModeBanner: false,
      theme: ThemeData(
        useMaterial3: true,
        colorScheme: ColorScheme.fromSeed(seedColor: const Color(0xFF064E3B)),
      ),
      home: const LauncherPage(),
    );
  }
}

class LauncherPage extends StatefulWidget {
  const LauncherPage({super.key});

  @override
  State<LauncherPage> createState() => _LauncherPageState();
}

class _LauncherPageState extends State<LauncherPage> {
  String _status = 'Starting scanner server...';
  bool _ready = false;
  bool _failed = false;
  List<String> _ips = const [];

  @override
  void initState() {
    super.initState();
    _start();
  }

  Future<void> _start() async {
    setState(() {
      _status = 'Starting scanner server...';
      _ready = false;
      _failed = false;
    });
    final err = await startEmbeddedServer();
    final ips = await lanAddresses();
    if (!mounted) return;
    if (err != null) {
      setState(() {
        _status = err;
        _failed = true;
      });
      return;
    }
    setState(() {
      _status = 'Scanner is running';
      _ready = true;
      _ips = ips;
    });
    await openScanner();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: Center(
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 460),
          child: Padding(
            padding: const EdgeInsets.all(24),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                Image.asset('assets/logo/scanner_brand_logo.png', width: 120, height: 120),
                const SizedBox(height: 16),
                if (!_ready && !_failed) const CircularProgressIndicator(),
                if (!_ready && !_failed) const SizedBox(height: 16),
                Text(
                  _status,
                  textAlign: TextAlign.center,
                  style: Theme.of(context).textTheme.titleMedium,
                ),
                if (_ready) ...[
                  const SizedBox(height: 16),
                  FilledButton.icon(
                    onPressed: openScanner,
                    icon: const Icon(Icons.open_in_new),
                    label: const Text('Open scanner'),
                  ),
                  const SizedBox(height: 24),
                  const Text(
                    'Phone app mein ye PC address daalo (same Wi-Fi):',
                    textAlign: TextAlign.center,
                  ),
                  const SizedBox(height: 8),
                  if (_ips.isEmpty)
                    const Text('No Wi-Fi/LAN address found.')
                  else
                    for (final ip in _ips) SelectableText(ip, style: const TextStyle(fontSize: 20)),
                  const SizedBox(height: 16),
                  const Text(
                    'Close this window to stop the server.',
                    style: TextStyle(color: Colors.black54),
                  ),
                ],
                if (_failed) ...[
                  const SizedBox(height: 16),
                  FilledButton(onPressed: _start, child: const Text('Retry')),
                ],
              ],
            ),
          ),
        ),
      ),
    );
  }
}
