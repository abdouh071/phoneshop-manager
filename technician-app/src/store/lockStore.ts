/**
 * A device lock for a phone that now remembers who signed in.
 *
 * The flag lives in AsyncStorage, never in the Firestore profile: it belongs to
 * the hands holding the phone, not to the account, and two technicians sharing a
 * counter phone can each decide for their own device. Nothing biometric is read
 * or stored here — the operating system answers yes or no.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as LocalAuthentication from 'expo-local-authentication';
import { create } from 'zustand';
import i18n from '../i18n';
import { biometricLockAvailable, lockDueAfterPause } from '../utils/deviceLock';
import { useAuthStore } from './authStore';

const REQUIRED_KEY = '@lock_biometric_required';
const LEFT_AT_KEY = '@lock_last_left_at';

interface LockState {
  /** This phone asks for a biometric when the app comes back to life. */
  required: boolean;
  /** The phone can honour the setting: sensor present, biometric enrolled. */
  canEnable: boolean;
  isLocked: boolean;
  /** The native prompt is on screen; the unlock button must not double-fire. */
  isAuthenticating: boolean;
  error: string | null;
  hydrate: (hadRestoredSession: boolean) => Promise<void>;
  refreshAvailability: () => Promise<void>;
  setRequired: (on: boolean) => Promise<boolean>;
  markLeft: () => Promise<void>;
  markReturned: () => Promise<void>;
  /** Signing off always ends the lock — the login screen must be reachable. */
  clearLock: () => void;
  unlock: () => Promise<boolean>;
}

const readRequired = async (): Promise<boolean> => {
  const raw = await AsyncStorage.getItem(REQUIRED_KEY).catch(() => null);
  return raw === '1';
};

const askPhone = async (promptMessage: string): Promise<boolean> => {
  try {
    const result = await LocalAuthentication.authenticateAsync({
      promptMessage,
      cancelLabel: i18n.t('common.cancel', 'Cancel'),
      // The device PIN is not what this is asking for; the way out is our own
      // "sign in with a password" button, which says what it costs.
      disableDeviceFallback: true,
      biometricsSecurityLevel: 'strong',
    });
    return result.success;
  } catch {
    return false;
  }
};

/**
 * Whether this phone could honour the setting. A build that predates the native
 * module, or a ROM that refuses the query, answers "no" rather than throwing —
 * the alternative is an app that cannot open its own Settings screen.
 */
const probeAvailability = async (): Promise<boolean> => {
  try {
    const [hasSensor, hasEnrolled] = await Promise.all([
      LocalAuthentication.hasHardwareAsync(),
      LocalAuthentication.isEnrolledAsync(),
    ]);
    return biometricLockAvailable(hasSensor, hasEnrolled);
  } catch {
    return false;
  }
};

export const useLockStore = create<LockState>((set, get) => ({
  required: false,
  canEnable: false,
  isLocked: false,
  isAuthenticating: false,
  error: null,

  // Runs once, when Firebase has said whether a session came back. A technician
  // who just typed their password is not asked for a fingerprint as well.
  hydrate: async (hadRestoredSession) => {
    const [required, canEnable] = await Promise.all([readRequired(), probeAvailability()]);
    // A phone that lost its enrolled fingerprint mid-week must not lock its own
    // user out of the till; the setting dies with the biometric instead.
    if (required && !canEnable) {
      await AsyncStorage.removeItem(REQUIRED_KEY).catch(() => undefined);
      set({ required: false, canEnable, isLocked: false });
      return;
    }
    set({ required, canEnable, isLocked: required && hadRestoredSession });
  },

  refreshAvailability: async () => {
    set({ canEnable: await probeAvailability() });
  },

  // Turning it on is itself proof that the phone answers, so a half-configured
  // device cannot lock its owner out on the next cold start.
  setRequired: async (on) => {
    if (on) {
      const confirmed = await askPhone(i18n.t('lock.enablePrompt', 'Confirm your fingerprint or face to turn this on'));
      if (!confirmed) {
        set({ error: i18n.t('lock.enableFailed', 'Your phone did not accept the biometric.') });
        return false;
      }
    }
    await AsyncStorage.setItem(REQUIRED_KEY, on ? '1' : '0').catch(() => undefined);
    set({ required: on, error: null });
    return true;
  },

  markLeft: async () => {
    await AsyncStorage.setItem(LEFT_AT_KEY, String(Date.now())).catch(() => undefined);
  },

  markReturned: async () => {
    if (!get().required) return;
    const raw = await AsyncStorage.getItem(LEFT_AT_KEY).catch(() => null);
    await AsyncStorage.removeItem(LEFT_AT_KEY).catch(() => undefined);
    const lastLeftAt = raw === null ? null : Number(raw);
    const signedIn = useAuthStore.getState().isAuthenticated;
    if (signedIn && lockDueAfterPause(lastLeftAt, Date.now())) set({ isLocked: true });
  },

  // A signed-out phone has nothing to protect. Whichever way the session ended
  // — this overlay's link, the Settings button, an expired credential — the
  // login screen has to be visible.
  clearLock: () => {
    set({ isLocked: false, isAuthenticating: false, error: null });
  },

  unlock: async () => {
    if (get().isAuthenticating) return false;
    set({ isAuthenticating: true });
    const ok = await askPhone(i18n.t('lock.prompt', 'Unlock PhoneShop'));
    if (ok) {
      await AsyncStorage.removeItem(LEFT_AT_KEY).catch(() => undefined);
      set({ isLocked: false, error: null, isAuthenticating: false });
      return true;
    }
    set({ isAuthenticating: false, error: i18n.t('lock.notMatched', 'That did not match. Try again.') });
    return false;
  },
}));
