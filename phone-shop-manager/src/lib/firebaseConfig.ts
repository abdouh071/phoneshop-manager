import type { FirebaseOptions } from 'firebase/app';

export interface EmulatorConnectionSettings {
  firestoreHost: string;
  firestorePort: number;
  authUrl: string;
}

export interface ResolvedFirebaseEnvironment {
  useEmulator: boolean;
  config: FirebaseOptions;
  emulator?: EmulatorConnectionSettings;
}

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);

const assertLoopbackHostname = (hostname: string, label: string): string => {
  const normalized = hostname.trim().toLowerCase();
  if (!LOOPBACK_HOSTS.has(normalized)) {
    throw new Error(`${label} must target a loopback host (127.0.0.1 or localhost), got "${hostname}".`);
  }
  return normalized === '[::1]' ? '::1' : normalized;
};

export const parseEmulatorHostPort = (raw: string | undefined, label: string): { host: string; port: number } => {
  if (!raw || !raw.trim()) {
    throw new Error(`Missing ${label} while emulator mode is enabled.`);
  }
  const trimmed = raw.trim();
  const lastColon = trimmed.lastIndexOf(':');
  if (lastColon <= 0) {
    throw new Error(`Invalid ${label} "${raw}": expected host:port.`);
  }
  const rawHost = trimmed.slice(0, lastColon);
  const rawPort = trimmed.slice(lastColon + 1);
  const host = assertLoopbackHostname(rawHost, label);
  const port = Number(rawPort);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid port in ${label} "${raw}".`);
  }
  return { host, port };
};

export const parseAuthEmulatorUrl = (raw: string | undefined): string => {
  if (!raw || !raw.trim()) {
    throw new Error('Missing VITE_AUTH_EMULATOR_URL while emulator mode is enabled.');
  }
  let parsed: URL;
  try {
    parsed = new URL(raw.trim());
  } catch {
    throw new Error(`Invalid VITE_AUTH_EMULATOR_URL "${raw}".`);
  }
  if (parsed.protocol !== 'http:') {
    throw new Error(`VITE_AUTH_EMULATOR_URL must use http:// for local emulators, got "${parsed.protocol}".`);
  }
  assertLoopbackHostname(parsed.hostname, 'VITE_AUTH_EMULATOR_URL');
  if (!parsed.port) {
    throw new Error(`VITE_AUTH_EMULATOR_URL must include an explicit port, got "${raw}".`);
  }
  return parsed.origin;
};

/**
 * Resolves Firebase configuration cleanly and ensures emulator/test sessions can
 * never silently fall back to production credentials or endpoints.
 */
export const resolveFirebaseEnvironment = (
  env: Record<string, string | undefined>
): ResolvedFirebaseEnvironment => {
  const useEmulator = env.VITE_USE_FIREBASE_EMULATOR === 'true';

  if (useEmulator) {
    const projectId = env.VITE_FIREBASE_PROJECT_ID?.trim();
    if (!projectId || !projectId.startsWith('demo-')) {
      throw new Error(
        `Emulator mode requires VITE_FIREBASE_PROJECT_ID starting with "demo-" (received "${projectId || ''}"). Refusing to fall back to production.`
      );
    }

    const firestore = parseEmulatorHostPort(env.VITE_FIRESTORE_EMULATOR_HOST, 'VITE_FIRESTORE_EMULATOR_HOST');
    const authUrl = parseAuthEmulatorUrl(env.VITE_AUTH_EMULATOR_URL);

    return {
      useEmulator: true,
      config: {
        projectId,
        appId: `1:000000000000:web:${projectId}`,
        storageBucket: `${projectId}.appspot.com`,
        apiKey: 'demo-phoneshop-emulator-api-key',
        authDomain: `${projectId}.firebaseapp.com`,
        messagingSenderId: '000000000000',
      },
      emulator: {
        firestoreHost: firestore.host,
        firestorePort: firestore.port,
        authUrl,
      },
    };
  }

  return {
    useEmulator: false,
    config: {
      projectId: env.VITE_FIREBASE_PROJECT_ID || 'your-firebase-project-id',
      appId: env.VITE_FIREBASE_APP_ID || 'your-firebase-app-id',
      storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET || 'your-project-id.firebasestorage.app',
      apiKey: env.VITE_FIREBASE_API_KEY || 'your-firebase-api-key',
      authDomain: env.VITE_FIREBASE_AUTH_DOMAIN || 'your-project-id.firebaseapp.com',
      messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID || 'your-messaging-sender-id',
    },
  };
};
