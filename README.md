# 📱 PhoneShop Manager Pro

A complete, open-source **phone repair shop management system** built with modern web technologies. Manage inventory, track repairs, handle point-of-sale transactions, print thermal receipts, and coordinate with technicians — all from one place.

![License](https://img.shields.io/badge/license-MIT-blue.svg)
![React](https://img.shields.io/badge/React-19-61dafb.svg)
![TypeScript](https://img.shields.io/badge/TypeScript-5-3178c6.svg)
![Firebase](https://img.shields.io/badge/Firebase-Firestore-ffca28.svg)

---

## ✨ Features

### 🖥️ Manager Dashboard (`phone-shop-manager`)
- **📊 Dashboard** — Real-time business overview with key metrics
- **🛒 Point of Sale (POS)** — Fast checkout with barcode support and thermal receipt printing
- **🔧 Repair Tracking** — Full repair lifecycle management with status updates
- **📦 Inventory Management** — Track stock levels, brands, models, and variants
- **🔩 Parts Management** — Manage spare parts inventory and pricing
- **👥 Customer Database** — Customer profiles with repair and purchase history
- **📋 Purchase Orders** — Track supplier purchases and costs
- **🧾 Custom Tickets** — Printable repair tickets and labels
- **📈 Reports** — Sales, repairs, and inventory analytics
- **🌅 End of Day** — Daily cash reconciliation and closing reports
- **📝 Activity Log** — Full audit trail of all system actions
- **⚙️ Settings** — System configuration, user roles, and preferences
- **🌍 Multi-language** — English, French, and Arabic (RTL) support
- **🖨️ Thermal Printing** — Direct receipt and label printing via local print server

### 📲 Technician App (`technician-app`)
- **Mobile companion** for technicians to view assigned repairs
- **Real-time updates** synced through Firebase
- Built with **Expo / React Native** for iOS and Android

---

## 🏗️ Architecture

```
Phones-workspace/
├── phone-shop-manager/        # React + Vite web application
│   ├── src/
│   │   ├── features/          # Feature modules (POS, repairs, inventory, etc.)
│   │   ├── components/        # Shared UI components
│   │   ├── store/             # Zustand state management
│   │   ├── services/          # Firebase service layer
│   │   ├── locales/           # i18n translations (en, fr, ar)
│   │   ├── hooks/             # Custom React hooks
│   │   ├── lib/               # Firebase config & utilities
│   │   ├── types/             # TypeScript type definitions
│   │   └── utils/             # Helper functions
│   ├── print-server/          # Express thermal print server
│   └── electron/              # Desktop app wrapper (optional)
│
├── technician-app/            # Expo / React Native mobile app
│   └── src/
│       ├── screens/           # App screens
│       ├── components/        # Shared components
│       ├── store/             # State management
│       └── lib/               # Firebase config
│
├── firestore.rules            # Firestore security rules
└── LICENSE
```

---

## 🚀 Getting Started

### Prerequisites

- **Node.js** 18+ and **npm**
- A **Firebase** project with Firestore and Authentication enabled
- (Optional) A thermal printer for receipt/label printing

### 1. Clone the Repository

```bash
git clone https://github.com/YOUR_USERNAME/phoneshop-manager.git
cd phoneshop-manager
```

### 2. Set Up Firebase

1. Create a new project at [console.firebase.google.com](https://console.firebase.google.com).
2. Enable **Authentication** (Email/Password provider).
3. Create a **Firestore Database** in test mode or deploy the included security rules.
4. Copy your web app Firebase config values.

#### 👤 Creating the First Account
Because this is a private shop management system, **there is no public "Sign Up" button** on the login screen (this prevents unauthorized strangers from registering accounts).
- Go to **Firebase Console → Authentication → Users → Add User**.
- Enter your admin email (e.g. `admin@example.com`) and choose a password.

#### 🛡️ Matching Email in `firestore.rules`
In [`firestore.rules`](phone-shop-manager/firestore.rules), the initial fallback bootstrap email is set to `admin@example.com`:
- **If you use `admin@example.com`** when adding your user in Firebase, no rule changes are required.
- **If you use a custom email** (e.g. `owner@yourshop.com`):
  1. Open `phone-shop-manager/firestore.rules` and replace `admin@example.com` with your email.
  2. In your `.env` file, set `VITE_SUPER_ADMIN_EMAIL=owner@yourshop.com`.
  3. Deploy your rules to Firebase (`npx firebase-tools deploy --only firestore:rules`).

### 3. Configure the Manager App

```bash
cd phone-shop-manager
npm install

# Create your environment file
cp .env.example .env
# Edit .env with your Firebase credentials
```

Your `.env` file should look like:
```env
VITE_FIREBASE_API_KEY=your_api_key
VITE_FIREBASE_AUTH_DOMAIN=your_project.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=your_project_id
VITE_FIREBASE_STORAGE_BUCKET=your_project.firebasestorage.app
VITE_FIREBASE_MESSAGING_SENDER_ID=your_messaging_sender_id
VITE_FIREBASE_APP_ID=your_app_id
VITE_SUPER_ADMIN_EMAIL=admin@example.com
```

### 4. Set Up the Print Server (Optional)

```bash
cd print-server
npm install

cp .env.example .env
# Edit .env — set PRINTER_NAME to your thermal printer's system name
# Run `lpstat -p -d` to find available printer names
```

### 5. Run the Application

```bash
# Terminal 1 — Start the print server (optional)
cd phone-shop-manager/print-server
node server.js

# Terminal 2 — Start the dev server
cd phone-shop-manager
npm run dev
```

Open **http://localhost:5173** in your browser.

### 6. First Login

1. Sign in with the administrator email you created in Firebase Authentication (which matches `VITE_SUPER_ADMIN_EMAIL`).
2. On first login, the system automatically detects your email and creates your **Super Admin** profile in Firestore with full privileges.
3. Once logged in, navigate to **Settings → Users** to create and invite additional staff members (Cashiers, Technicians, Store Managers) directly from the UI without needing to visit the Firebase Console again.

---

## 📱 Technician App Setup

```bash
cd technician-app
npm install

# Create your environment file
cp .env.example .env
# Edit .env with the SAME Firebase project credentials (using EXPO_PUBLIC_ prefix)

# Start the Expo dev server
npx expo start
```

Scan the QR code with **Expo Go** on your phone.

---

## 🖨️ Thermal Printing & Local Print Server

The application includes a lightweight, dedicated local print service in `phone-shop-manager/print-server/`. Built with **Node.js + Express.js**, it runs locally on port `3355` and bridges the web dashboard directly to hardware thermal printers — providing instantaneous 1-click silent printing without clumsy browser print dialog popups.

### ⚙️ How It Works
- The web app sends receipt, ticket, or label payloads via HTTP `POST` to `http://localhost:3355`.
- The print server formats the content using direct hardware protocols:
  - **ESC/POS** for 80mm cash receipts and daily closing reports (with auto-cutter).
  - **TSPL & 1-bit raster graphics** for adhesive repair ticket stickers and barcode labels.
- Jobs are dispatched directly to the OS printer spooler (`lpr` on macOS/Linux or Windows print subsystem).

### 🏷️ Hardware Compatibility & Tested Devices
The printing engine is **extensively tested and verified on Xprinter devices**:
- **Xprinter XP-T80Q / POS-80** — 80mm Thermal Receipt Printer (ESC/POS with automatic cutter).
- **Xprinter XP-420B** — High-speed Thermal Barcode & Label Printer (for device repair stickers).
- Also compatible with standard ESC/POS thermal printers connected via USB or network.

### 📋 Print Server Configuration (`print-server/.env`)

| Variable | Description | Default |
|---|---|---|
| `PRINTER_NAME` | System printer name for 80mm receipts (`lpstat -p -d`) | `XP_T80Q` |
| `LABEL_PRINTER_NAME` | System printer name for sticky repair labels | `XP_420B` |
| `PORT` | Local print server port (keep 3355 for web app integration) | `3355` |
| `HAS_CUTTER` | Automatically triggers paper cutter after printing | `true` |
| `LABEL_OFFSET_X` | Horizontal label margin offset calibration in dots | `12` |

---

## 🔐 Security

- **Firestore Security Rules** are included in [`firestore.rules`](firestore.rules) — deploy them to your Firebase project
- **Role-based access**: Super Admin, Owner, Manager, Seller, and Technician roles
- All credentials are loaded from environment variables — **never hardcoded**
- `.env` files are git-ignored to prevent accidental secret exposure

### Deploy Firestore Rules

```bash
npx firebase-tools deploy --only firestore:rules
```

---

## 🌍 Internationalization

The app supports three languages with full RTL layout for Arabic:

| Language | Code | Direction |
|---|---|---|
| English | `en` | LTR |
| French | `fr` | LTR |
| Arabic | `ar` | RTL |

Translations are in `phone-shop-manager/src/locales/`.

---

## 🛠️ Tech Stack

| Layer | Technology |
|---|---|
| **Frontend** | React 19, TypeScript 5, Vite |
| **State Management** | Zustand |
| **Backend** | Firebase Firestore, Firebase Auth |
| **Mobile** | Expo SDK 57, React Native |
| **Print Server** | Express.js, node-thermal-printer |
| **Desktop** | Electron (optional) |
| **Styling** | CSS Modules |
| **i18n** | i18next |

---

## 🤝 Contributing

Contributions are welcome! Please:

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

---

## 📄 License

This project is licensed under the **MIT License** — see the [LICENSE](LICENSE) file for details.

---

## 🙏 Acknowledgments

Built with ❤️ for independent phone repair shop owners everywhere.
