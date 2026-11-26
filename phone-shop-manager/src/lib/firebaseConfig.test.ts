import { describe, expect, it } from 'vitest';
import { resolveFirebaseEnvironment } from './firebaseConfig';

describe('resolveFirebaseEnvironment', () => {
  it('connects strictly to loopback demo emulators and strips production credentials when enabled', () => {
    const resolved = resolveFirebaseEnvironment({
      VITE_USE_FIREBASE_EMULATOR: 'true',
      VITE_FIREBASE_PROJECT_ID: 'demo-phoneshop-ui',
      VITE_FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080',
      VITE_AUTH_EMULATOR_URL: 'http://127.0.0.1:9099',
      VITE_FIREBASE_API_KEY: 'AIzaSyRealProdKeyShouldBeIgnored',
      VITE_FIREBASE_APP_ID: '1:999:web:prod',
    });

    expect(resolved.useEmulator).toBe(true);
    expect(resolved.config.projectId).toBe('demo-phoneshop-ui');
    expect(resolved.config.apiKey).toBe('demo-phoneshop-emulator-api-key');
    expect(resolved.config.appId).not.toContain('999');
    expect(resolved.emulator).toEqual({
      firestoreHost: '127.0.0.1',
      firestorePort: 8080,
      authUrl: 'http://127.0.0.1:9099',
    });
  });

  it('refuses a non-demo project ID when emulator mode is enabled (never falls back to prod)', () => {
    expect(() =>
      resolveFirebaseEnvironment({
        VITE_USE_FIREBASE_EMULATOR: 'true',
        VITE_FIREBASE_PROJECT_ID: 'my-prod-project',
        VITE_FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080',
        VITE_AUTH_EMULATOR_URL: 'http://127.0.0.1:9099',
      })
    ).toThrow(/demo-/);
  });

  it('refuses missing or remote emulator hosts in emulator mode', () => {
    expect(() =>
      resolveFirebaseEnvironment({
        VITE_USE_FIREBASE_EMULATOR: 'true',
        VITE_FIREBASE_PROJECT_ID: 'demo-phoneshop-ui',
        VITE_FIRESTORE_EMULATOR_HOST: 'firestore.googleapis.com:443',
        VITE_AUTH_EMULATOR_URL: 'http://127.0.0.1:9099',
      })
    ).toThrow(/loopback/i);

    expect(() =>
      resolveFirebaseEnvironment({
        VITE_USE_FIREBASE_EMULATOR: 'true',
        VITE_FIREBASE_PROJECT_ID: 'demo-phoneshop-ui',
        VITE_FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080',
        VITE_AUTH_EMULATOR_URL: 'https://identitytoolkit.googleapis.com:443',
      })
    ).toThrow(/http:\/\//i);
  });
});
