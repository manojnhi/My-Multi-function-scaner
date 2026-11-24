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
  final script =
