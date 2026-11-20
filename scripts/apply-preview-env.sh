#!/bin/bash
# Automatically switches project to the Test / Live Preview Database (ecomeweb-91a7e)
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

echo "🔄 Switching to Test / Preview Database (ecomeweb-91a7e)..."

if [ -f "$ROOT_DIR/phone-shop-manager/.env.preview" ]; then
  cp "$ROOT_DIR/phone-shop-manager/.env.preview" "$ROOT_DIR/phone-shop-manager/.env"
  echo "  ✅ phone-shop-manager/.env updated"
fi

if [ -f "$ROOT_DIR/phone-shop-manager/.firebaserc.preview" ]; then
  cp "$ROOT_DIR/phone-shop-manager/.firebaserc.preview" "$ROOT_DIR/phone-shop-manager/.firebaserc"
  echo "  ✅ phone-shop-manager/.firebaserc updated"
fi

if [ -f "$ROOT_DIR/phone-shop-manager/print-server/.env.preview" ]; then
  cp "$ROOT_DIR/phone-shop-manager/print-server/.env.preview" "$ROOT_DIR/phone-shop-manager/print-server/.env"
  echo "  ✅ phone-shop-manager/print-server/.env updated"
fi

if [ -f "$ROOT_DIR/technician-app/.env.preview" ]; then
  cp "$ROOT_DIR/technician-app/.env.preview" "$ROOT_DIR/technician-app/.env"
  echo "  ✅ technician-app/.env updated"
fi

echo ""
echo "🎉 Successfully configured for Live Preview / Test Database!"
echo "   Database: ecomeweb-91a7e"
