# My Multi Functional Scanner

Document scanning ecosystem: Quick Capture + Auto Capture, offline Hindi & English OCR,
PDF toolbox (merge / split / rotate / compress / image↔PDF), image editor, and real-time
mobile → PC transfer over WebSockets with QR pairing.

- **Web app / server**: React 19 + TypeScript + Tailwind v4 + Vite, Express + `ws`, IndexedDB (`idb`), Tesseract.js, `pdf-lib`, `pdfjs-dist`, Firebase Auth.
- **Native** (`native-ecosystem/`): Flutter project for Android APK and Windows EXE (+ Inno Setup installer).

## Run locally

```bash
npm install
cp .env.example .env   # fill GEMINI_API_KEY, SESSION_SECRET
npm run dev            # http://localhost:3000
```

## Production

```bash
npm run build
npm start              # serves dist/ + API + WebSocket on $PORT (default 3000)
```

Docker:

```bash
docker build -t my-scanner .
docker run -p 3000:3000 -v scanner-data:/app/data --env-file .env my-scanner
```

## Environment variables

| Variable | Purpose |
| --- | --- |
| `GEMINI_API_KEY` | Gemini API key (server side) |
| `APP_URL` | Public URL of the deployment |
| `PORT` | Server port (default 3000) |
| `SESSION_SECRET` | Session signing secret (random per start if unset) |

Runtime data (users, pairings, vault files) is stored in `data/` and is git-ignored.

## Firebase

`firebase-applet-config.json` holds the public web config. Deploy `firestore.rules` to your
Firebase project; see `security_spec.md` for the security model. (`DRAFT_firestore.rules` is an older draft.)

## Native builds

See [`native-ecosystem/docs/BUILD_AND_TEST.md`](native-ecosystem/docs/BUILD_AND_TEST.md).
GitHub Actions workflow **Native builds** (manual run or `v*` tag) produces the APK and the Windows EXE/installer as artifacts.

## CI

`.github/workflows/ci.yml` runs typecheck + build on every push/PR to `main`.
