# Multi-Brand Build System Design

Date: 2026-03-19

## Goal

Support building multiple branded variants (EvoClaw, HealthClaw, ...) from the same codebase. Each brand has its own name, logo, colors, data directory, and identifiers. Controlled via `BRAND=xxx` environment variable.

## Brand Config Structure

```
brands/
  evoclaw/
    brand.json
    icons/              (logo.svg, icon.png, 32x32.png, 128x128.png, 128x128@2x.png, icon.ico)
  healthclaw/
    brand.json
    icons/
```

### brand.json Schema

```json
{
  "name": "HealthClaw",
  "identifier": "com.healthclaw.app",
  "abbreviation": "HC",
  "dataDir": ".healthclaw",
  "dbFilename": "healthclaw.db",
  "configFilename": "health_claw.json",
  "keychainService": "com.healthclaw",
  "eventPrefix": "healthclaw",
  "colors": {
    "primary": "#3B82F6",
    "primaryDark": "#1D4ED8",
    "gradient": ["#60A5FA", "#2563EB"]
  },
  "windowTitle": "HealthClaw"
}
```

## Brand Apply Script (`scripts/brand-apply.mjs`)

Runs before build/dev. Reads `brands/${BRAND}/brand.json` and:

1. Generates `packages/shared/src/brand.ts` — exports typed brand constants
2. Patches `apps/desktop/src-tauri/tauri.conf.json` — productName, identifier, window title
3. Copies `brands/${BRAND}/icons/*` → `apps/desktop/src-tauri/icons/`
4. Updates `apps/desktop/index.html` `<title>`

Default BRAND = `evoclaw` when not specified.

## Code Changes

### packages/shared

- New `brand.ts` (generated) exports: `BRAND_NAME`, `BRAND_ABBREVIATION`, `BRAND_IDENTIFIER`, `BRAND_DATA_DIR`, `BRAND_DB_FILENAME`, `BRAND_CONFIG_FILENAME`, `BRAND_KEYCHAIN_SERVICE`, `BRAND_EVENT_PREFIX`, `BRAND_COLORS`
- `constants.ts` changes `DEFAULT_DATA_DIR` and `DB_FILENAME` to import from `brand.ts`

### packages/core

- `logger.ts`, `config-manager.ts`, `sqlite-store.ts` already use shared constants — no direct changes needed
- Event names using `evoclaw:` prefix read from brand constants

### apps/desktop (React)

- Hardcoded "EvoClaw" strings → `BRAND_NAME`
- Hardcoded "EC" → `BRAND_ABBREVIATION`
- Hardcoded color values → `BRAND_COLORS`
- Loading text, welcome text, settings label all use brand constants

### apps/desktop (Rust)

- `credential.rs` `SERVICE_PREFIX` reads from tauri.conf.json identifier (already patched by brand-apply)

## Commands

```bash
# Environment variable
BRAND=healthclaw pnpm dev
BRAND=healthclaw pnpm build

# Shortcut scripts (root package.json)
pnpm dev:healthclaw     → "BRAND=healthclaw pnpm dev"
pnpm build:healthclaw   → "BRAND=healthclaw pnpm build"

# Default
pnpm dev                → BRAND=evoclaw (default)
```

## Not Changed

- npm package names (`@evoclaw/core`, etc.) — internal organization
- Rust crate names — internal
- Code comments — project codename, not user-facing
- `scripts/dev.sh` — accepts BRAND env var, passes through

## File Inventory

| File | Change |
|------|--------|
| `brands/evoclaw/brand.json` | New |
| `brands/evoclaw/icons/*` | Move from `apps/desktop/src-tauri/icons/` |
| `brands/healthclaw/brand.json` | New |
| `brands/healthclaw/icons/*` | New (from user-provided logo) |
| `scripts/brand-apply.mjs` | New |
| `packages/shared/src/brand.ts` | New (generated) |
| `packages/shared/src/constants.ts` | Use brand.ts imports |
| `apps/desktop/src-tauri/tauri.conf.json` | Patched at build time |
| `apps/desktop/index.html` | Patched at build time |
| `apps/desktop/src/App.tsx` | Use brand constants |
| `apps/desktop/src/pages/SetupPage.tsx` | Use brand constants |
| `apps/desktop/src/pages/SettingsPage.tsx` | Use brand constants |
| `apps/desktop/src-tauri/src/credential.rs` | Read identifier from config |
| `scripts/dev.sh` | Add brand-apply call |
| `scripts/build-dmg.sh` | Add brand-apply call |
| `package.json` (root) | Add brand-specific scripts |
