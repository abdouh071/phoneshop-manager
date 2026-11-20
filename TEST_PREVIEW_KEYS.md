# Test / Live Preview Database & Environment Keys

This file contains all the database credentials, Vite variables, Expo variables, and Print Server configurations extracted from `phones-workspace-test`.

Use these keys whenever you create a clone of this repository for a **Live Preview / Test Demo** environment.

---

## 🔑 1. Quick Summary of Keys

| Service / Variable | Test / Preview Database Value | Production Database Value (Reference) |
|---|---|---|
| **Firebase Project ID** | `ecomeweb-91a7e` | `phoneshop-mgr-pro-2026` |
| **API Key** | `AIzaSyBUFHByGn2eHo_p1R7Y3fSzHnPOZm1dtiY` | `AIzaSyCYQopJt3Ppyd8BV-o0c1pd-AONwEqBFXw` |
| **Auth Domain** | `ecomeweb-91a7e.firebaseapp.com` | `phoneshop-mgr-pro-2026.firebaseapp.com` |
| **Storage Bucket** | `ecomeweb-91a7e.firebasestorage.app` | `phoneshop-mgr-pro-2026.firebasestorage.app` |
| **Messaging Sender ID**| `986711402448` | `382569044952` |
| **Web App ID** | `1:986711402448:web:cdb892f3dff879c1973bd5` | `1:382569044952:web:3081c612d39e1f7fc2f0ad` |
| **Super Admin Email** | `admin@example.com` | `adou4849@gmail.com` |
| **Print Server Port** | `3356` (`http://localhost:3356`) | `3355` (`http://localhost:3355`) |
| **EAS Project ID** | `f7f4d1c2-b95d-40c1-a983-a63e235cb403` | `f7f4d1c2-b95d-40c1-a983-a63e235cb403` |

---

## 📁 2. Ready-to-Use File Templates

All `.preview` template files have already been generated inside the project:

### A. Web / Desktop App (`phone-shop-manager/.env`)
File: `phone-shop-manager/.env.preview`
```env
# Test Demo Project Firebase Configuration (Vite)
VITE_FIREBASE_API_KEY=AIzaSyBUFHByGn2eHo_p1R7Y3fSzHnPOZm1dtiY
VITE_FIREBASE_AUTH_DOMAIN=ecomeweb-91a7e.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=ecomeweb-91a7e
VITE_FIREBASE_STORAGE_BUCKET=ecomeweb-91a7e.firebasestorage.app
VITE_FIREBASE_MESSAGING_SENDER_ID=986711402448
VITE_FIREBASE_APP_ID=1:986711402448:web:cdb892f3dff879c1973bd5
VITE_SUPER_ADMIN_EMAIL=admin@example.com

# Dynamic Print Server Port for Test App
VITE_PRINT_SERVER_URL=http://localhost:3356
```

### B. Mobile Technician App (`technician-app/.env`)
File: `technician-app/.env.preview`
```env
# Test Demo Project Firebase Configuration (Expo)
EXPO_PUBLIC_FIREBASE_API_KEY=AIzaSyBUFHByGn2eHo_p1R7Y3fSzHnPOZm1dtiY
EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN=ecomeweb-91a7e.firebaseapp.com
EXPO_PUBLIC_FIREBASE_PROJECT_ID=ecomeweb-91a7e
EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET=ecomeweb-91a7e.firebasestorage.app
EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=986711402448
EXPO_PUBLIC_FIREBASE_APP_ID=1:986711402448:web:cdb892f3dff879c1973bd5
```

### C. Print Server (`phone-shop-manager/print-server/.env`)
File: `phone-shop-manager/print-server/.env.preview`
```env
PORT=3356
PRINTER_NAME=XP_T80Q
LABEL_PRINTER_NAME=XP_420B
HAS_CUTTER=true
LABEL_OFFSET_X=12
```

### D. Firebase Project Target (`phone-shop-manager/.firebaserc`)
File: `phone-shop-manager/.firebaserc.preview`
```json
{
  "projects": {
    "default": "ecomeweb-91a7e"
  }
}
```

---

## 🚀 3. How to Apply These Keys When You Clone

When you clone this repo to create your preview copy, simply run this one-line command inside the root folder:

```bash
# Option 1: Using the provided switch script
chmod +x scripts/apply-preview-env.sh
./scripts/apply-preview-env.sh

# Option 2: Or manually copy the templates into place
cp phone-shop-manager/.env.preview phone-shop-manager/.env
cp phone-shop-manager/.firebaserc.preview phone-shop-manager/.firebaserc
cp phone-shop-manager/print-server/.env.preview phone-shop-manager/print-server/.env
cp technician-app/.env.preview technician-app/.env
```
