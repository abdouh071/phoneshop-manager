/**
 * Device lock and biometric login management.
 *
 * Biometrics are used for quick and secure login (signing in easily next time if you
 * log out or reinstall) rather than blocking the user on every app launch.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as LocalAuthentication from 'expo-local-authentication';
import { Alert } from 'react-native';
import { create } from 'zustand';
import i18n from '../i18n';
import { biometricLockAvailable } from '../utils/deviceLock';

const REQUIRED_KEY = '@lock_biometric_required';
const LEFT_AT_KEY = '@lock_last_left_at';
const BIOMETRIC_LOGIN_KEY = '@biometric_login_enabled';
const BIOMETRIC_CREDS_KEY = '@biometric_login_creds';
const BIOMETRIC_PROMPT_DONE_KEY = '@biometric_prompt_done';

export interface BiometricCredentials {
  email: string;
  password?: string;
  name?: string;
  savedAt: string;
}

interface LockState {
  required: boolean;
  canEnable: boolean;
  isLocked: boolean;
  isAuthenticating: boolean;
  error: string | null;
  // Biometric Login State
  isBiometricLoginEnabled: boolean;
  savedBiometricEmail: string | null;
  savedBiometricName: string | null;
  hydrate: (hadRestoredSession: boolean) => Promise<void>;
  refreshAvailability: () => Promise<void>;
  setRequired: (on: boolean) => Promise<boolean>;
  markLeft: () => Promise<void>;
  markReturned: () => Promise<void>;
  clearLock: () => void;
  unlock: () => Promise<boolean>;
  // Biometric Login Methods
  registerBiometrics: (email: string, password: string, name?: string) => Promise<boolean>;
  disableBiometrics: () => Promise<void>;
  promptRegisterBiometricsIfNeeded: (email: string, password: string, name?: string) => Promise<void>;
  getBiometricCredentials: () => Promise<BiometricCredentials | null>;
  authenticateForLogin: () => Promise<BiometricCredentials | null>;
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
      disableDeviceFallback: true,
      biometricsSecurityLevel: 'strong',
    });
    return result.success;
  } catch {
    return false;
  }
};

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
  isBiometricLoginEnabled: false,
  savedBiometricEmail: null,
  savedBiometricName: null,

  // Hydrate settings without locking out the user on normal app open.
  hydrate: async (_hadRestoredSession) => {
    const [canEnable, bioEnabledRaw, credsRaw] = await Promise.all([
      probeAvailability(),
      AsyncStorage.getItem(BIOMETRIC_LOGIN_KEY).catch(() => null),
      AsyncStorage.getItem(BIOMETRIC_CREDS_KEY).catch(() => null),
    ]);

    let savedEmail: string | null = null;
    let savedName: string | null = null;
    if (credsRaw) {
      try {
        const parsed = JSON.parse(credsRaw) as BiometricCredentials;
        savedEmail = parsed.email || null;
        savedName = parsed.name || null;
      } catch {
        // ignore malformed
      }
    }

    const isBiometricLoginEnabled = bioEnabledRaw === '1' && canEnable && Boolean(savedEmail);

    // Keep isLocked false on startup so active sessions enter smoothly without
    // annoying the user with biometric prompt on every single launch.
    set({
      required: false,
      canEnable,
      isLocked: false,
      isBiometricLoginEnabled,
      savedBiometricEmail: savedEmail,
      savedBiometricName: savedName,
    });
  },

  refreshAvailability: async () => {
    set({ canEnable: await probeAvailability() });
  },

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
    // Opening the app or switching back from background does NOT lock the app.
    await AsyncStorage.removeItem(LEFT_AT_KEY).catch(() => undefined);
  },

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

  // Register biometrics for login
  registerBiometrics: async (email: string, password: string, name?: string) => {
    const canEnable = await probeAvailability();
    if (!canEnable) {
      set({ error: i18n.t('lock.unavailable', 'Biometrics not available on this device.') });
      return false;
    }

    const confirmed = await askPhone(i18n.t('lock.registerPrompt', 'Verify your fingerprint or face to register biometric login'));
    if (!confirmed) {
      set({ error: i18n.t('lock.enableFailed', 'Your phone did not accept the biometric.') });
      return false;
    }

    const creds: BiometricCredentials = {
      email: email.trim(),
      password,
      name,
      savedAt: new Date().toISOString(),
    };

    await Promise.all([
      AsyncStorage.setItem(BIOMETRIC_CREDS_KEY, JSON.stringify(creds)),
      AsyncStorage.setItem(BIOMETRIC_LOGIN_KEY, '1'),
      AsyncStorage.setItem(BIOMETRIC_PROMPT_DONE_KEY, '1'),
    ]).catch(() => undefined);

    set({
      isBiometricLoginEnabled: true,
      savedBiometricEmail: creds.email,
      savedBiometricName: creds.name || null,
      error: null,
    });

    return true;
  },

  disableBiometrics: async () => {
    await Promise.all([
      AsyncStorage.removeItem(BIOMETRIC_CREDS_KEY),
      AsyncStorage.setItem(BIOMETRIC_LOGIN_KEY, '0'),
    ]).catch(() => undefined);

    set({
      isBiometricLoginEnabled: false,
      savedBiometricEmail: null,
      savedBiometricName: null,
    });
  },

  promptRegisterBiometricsIfNeeded: async (email: string, password: string, name?: string) => {
    const canEnable = await probeAvailability();
    if (!canEnable) return;

    const [alreadyPrompted, alreadyEnabled] = await Promise.all([
      AsyncStorage.getItem(BIOMETRIC_PROMPT_DONE_KEY).catch(() => null),
      AsyncStorage.getItem(BIOMETRIC_LOGIN_KEY).catch(() => null),
    ]);

    if (alreadyPrompted === '1' || alreadyEnabled === '1') return;

    Alert.alert(
      i18n.t('lock.registerTitle', 'Enable Biometric Login?'),
      i18n.t('lock.registerMessage', 'Would you like to register your fingerprint or face to quickly sign in next time if you log out?'),
      [
        {
          text: i18n.t('common.later', 'Not Now'),
          style: 'cancel',
          onPress: () => {
            void AsyncStorage.setItem(BIOMETRIC_PROMPT_DONE_KEY, '1');
          },
        },
        {
          text: i18n.t('common.enable', 'Enable'),
          onPress: () => {
            void get().registerBiometrics(email, password, name);
          },
        },
      ]
    );
  },

  getBiometricCredentials: async () => {
    const raw = await AsyncStorage.getItem(BIOMETRIC_CREDS_KEY).catch(() => null);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as BiometricCredentials;
    } catch {
      return null;
    }
  },

  authenticateForLogin: async () => {
    const creds = await get().getBiometricCredentials();
    if (!creds || !creds.email || !creds.password) return null;

    const ok = await askPhone(i18n.t('lock.loginPrompt', 'Sign in with Biometrics'));
    if (ok) {
      return creds;
    }
    return null;
  },
}));
