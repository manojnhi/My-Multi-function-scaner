import 'dart:io';
import 'package:flutter/material.dart';
import 'package:sqflite_common_ffi/sqflite_ffi.dart';

void main() async {
  WidgetsFlutterBinding.ensureInitialized();
  if (Platform.isWindows || Platform.isLinux) {
    // Local database is optional at startup: never let a missing sqlite3.dll
    // stop the app window from opening.
    try {
      sqfliteFfiInit();
      databaseFactory = databaseFactoryFfi;
    } catch (e) {
      debugPrint('SQLite init skipped: $e');
    }
  }
  runApp(const MyMultiFunctionalScannerApp());
}

class MyMultiFunctionalScannerApp extends StatelessWidget {
  const MyMultiFunctionalScannerApp({super.key});

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
      home: Platform.isWindows
          ? const DesktopWorkbenchShell()
          : const MobileScannerShell(),
    );
  }
}

class MobileScannerShell extends StatelessWidget {
  const MobileScannerShell({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('My Multi Functional Scanner')),
      body: const Center(
        child: Text('Mobile Scanner Companion — Quick Capture & Auto Transfer'),
      ),
    );
  }
}

class DesktopWorkbenchShell extends StatelessWidget {
  const DesktopWorkbenchShell({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('My Multi Functional Scanner — Desktop')),
      body: const Center(
        child: Text('Windows Desktop Workbench — Live Receiver & PDF Manager'),
      ),
    );
  }
}
