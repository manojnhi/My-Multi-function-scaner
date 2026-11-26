# Oklivo Scanner — Build & Testing Guide

## 1. Live Web + Real-Time Sync Stack (Runs Immediately)
- Stack: React 19 + TypeScript + Tailwind CSS v4 + Express + WebSockets (`ws`) + IndexedDB (`idb`) + Tesseract.js (`eng`/`hin`) + `pdf-lib` + `pdfjs-dist`
- Run Development: `npm run dev` (Port 3000)
- Production Build: `npm run build` followed by `npm start`

## 2. Native Android APK & Windows EXE Compilation
The `/native-ecosystem` folder contains the Flutter multi-platform project configuration, Android Gradle script, SQLite schema, and Windows Inno Setup installer script. Compiling native binaries requires a local workstation with Flutter SDK, Android SDK, and Visual Studio 2022 (Desktop C++ workload):

1. Copy `/native-ecosystem` into a local Flutter workspace and run:
   `flutter pub get`
2. Build Android Release APK:
   `flutter build apk --release`
   Output: `build/app/outputs/flutter-apk/app-release.apk`
3. Build Windows Desktop EXE:
   `flutter build windows --release`
   Output: `build/windows/x64/runner/Release/my_multi_functional_scanner.exe`
4. Generate Windows Installer EXE:
   Compile `installer/my_scanner_setup.iss` with Inno Setup 6.

## 3. Verification Matrix
- Quick Capture latency: tap capture -> instant IndexedDB save -> background CV + WebSocket auto-transfer
- Auto Capture: verify steady/blur indicator transitions (`Searching` -> `Hold steady` -> `Ready` -> `Captured`)
- Offline Mode: toggle Offline Mode ON, capture 3 documents, verify queued transfers auto-deliver on reconnect
- Hindi + English OCR: run `eng+hin` OCR on sample bilingual circular and invoice
- PDF Toolbox: convert images to A4 PDF, merge, extract pages, rotate, compress, and convert PDF to JPEG
