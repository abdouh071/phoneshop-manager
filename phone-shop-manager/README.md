# Phone Shop Manager — Web App

The main management dashboard. See the [root README](../README.md) for full documentation.

## Quick Start

```bash
npm install
cp .env.example .env   # Fill in your Firebase credentials
npm run dev             # http://localhost:5173
```

## Scripts

| Command | Description |
|---|---|
| `npm run dev` | Start Vite dev server |
| `npm run build` | Production build |
| `npm run lint` | Run linter |
| `npm run preview` | Preview production build |
| `npm run electron:dev` | Run as Electron desktop app |
| `npm run build && npm run electron:build:mac:arm64` | Apple Silicon DMG → `../releases/PhoneShopPro-<version>-mac-arm64.dmg` |
| `npm run build && npm run electron:build:mac:intel` | Intel DMG → `../releases/PhoneShopPro-<version>-mac-x64.dmg` |
| `npm run build && npm run electron:build:win` | Windows x64 → `../releases/PhoneShopPro-Setup-<version>-win-x64.exe` |
| `npm run build && npm run electron:build:win7` | Windows 7 / 32-bit (Electron 22) → `../releases/win7-ia32/` |
