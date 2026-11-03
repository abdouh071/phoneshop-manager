/**
 * The screen a phone shows when it is not sure who is holding it.
 *
 * It covers the app rather than tearing it down, so the workbench the technician
 * was reading is still there after the fingerprint. The way out is honest:
 * signing off costs them the fast re-open they asked for, and says so.
 */
import React from 'react';
import { StyleSheet, TouchableOpacity, Vibration, View } from 'react-native';
import { Button, Text } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { useAuthStore } from '../store/authStore';
import { useLockStore } from '../store/lockStore';
import { colors, fontSize, radius, spacing } from '../theme/tokens';

export const AppLockOverlay = () => {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const { isLocked, isAuthenticating, error, unlock } = useLockStore();
  const logout = useAuthStore((state) => state.logout);

  if (!isLocked) return null;

  const handleUnlock = async () => {
    const ok = await unlock();
    if (!ok) Vibration.vibrate(120);
  };

  return (
    <View
      testID="app-lock"
      accessibilityLabel={t('lock.title', 'PhoneShop is locked')}
      style={[styles.container, { paddingTop: insets.top, paddingBottom: Math.max(insets.bottom, spacing.xl) }]}
    >
      <View style={styles.body}>
        <View style={styles.badge}>
          <MaterialCommunityIcons name="fingerprint" size={40} color={colors.brand} />
        </View>
        <Text style={styles.title}>{t('lock.title', 'PhoneShop is locked')}</Text>
        <Text style={styles.bodyText}>
          {t('lock.body', 'Unlock with your fingerprint or face to keep the till open.')}
        </Text>

        <Button
          mode="contained"
          buttonColor={colors.brand}
          textColor={colors.onBrand}
          loading={isAuthenticating}
          disabled={isAuthenticating}
          onPress={handleUnlock}
          style={styles.unlockBtn}
        >
          {t('lock.unlock', 'Unlock')}
        </Button>

        {error && <Text style={styles.error}>{error}</Text>}

        <TouchableOpacity
          onPress={() => {
            void logout();
          }}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
        >
          <Text style={styles.passwordLink}>{t('lock.usePassword', 'Sign in with a password instead')}</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    ...StyleSheet.absoluteFill,
    backgroundColor: colors.background,
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
  },
  body: { alignItems: 'center', gap: spacing.md },
  badge: {
    width: 84,
    height: 84,
    borderRadius: radius.circle,
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: { fontSize: fontSize.title, fontWeight: '800', color: colors.textPrimary, textAlign: 'center' },
  bodyText: {
    fontSize: fontSize.body,
    color: colors.textSecondary,
    textAlign: 'center',
    lineHeight: 21,
  },
  unlockBtn: { alignSelf: 'stretch', marginTop: spacing.sm, borderRadius: radius.md },
  error: { fontSize: fontSize.caption, color: colors.danger, textAlign: 'center' },
  passwordLink: { fontSize: fontSize.body, color: colors.brand, fontWeight: '600', textAlign: 'center' },
});
