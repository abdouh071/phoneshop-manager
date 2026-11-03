import React, { useEffect, useState } from 'react';
import { View, StyleSheet, KeyboardAvoidingView, Platform, Alert, ScrollView, TouchableOpacity, Image } from 'react-native';
import { TextInput, Button, Title, Text, useTheme, Card, Divider, Switch } from 'react-native-paper';
import { useSettingsStore } from '../store/settingsStore';
import { useAuthStore } from '../store/authStore';
import { useLockStore } from '../store/lockStore';
import { useTranslation } from 'react-i18next';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import i18next from 'i18next';
import { doc, updateDoc } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { restartForDirection, setLanguage } from '../i18n';
import { RoleBottomNav } from '../components/RoleBottomNav';
import { colors } from '../theme/tokens';
import appConfig from '../../app.json';

// Read from app.json so the About screen can never drift from what is actually built.
// It used to say 1.2.0 while every build carried 1.0.0.
const APP_VERSION = appConfig?.expo?.version ?? '—';

export const SettingsScreen = ({ navigation }: any) => {
  const theme = useTheme();
  const { profitPercentage, personalPercentage, shopPercentage, saveProfitPercentage, followShopDefault } = useSettingsStore();
  const { user, logout } = useAuthStore();
  const { t } = useTranslation();
  
  const [localPercentage, setLocalPercentage] = useState(profitPercentage);
  const [saving, setSaving] = useState(false);

  const lockRequired = useLockStore((state) => state.required);
  const lockCanEnable = useLockStore((state) => state.canEnable);
  const lockError = useLockStore((state) => state.error);
  const setLockRequired = useLockStore((state) => state.setRequired);
  const refreshLockAvailability = useLockStore((state) => state.refreshAvailability);
  const [lockBusy, setLockBusy] = useState(false);

  // A fingerprint can be deleted in Settings any time, so the phone is asked again
  // on every visit rather than trusting what the launch-time check concluded.
  useEffect(() => {
    void refreshLockAvailability();
  }, [refreshLockAvailability]);

  // The store may resolve the personal number from the profile after this screen
  // mounted; re-seed the field so the input is never left showing a stale default.
  useEffect(() => {
    setLocalPercentage(profitPercentage);
  }, [profitPercentage]);

  const [currentLang, setCurrentLang] = useState(i18next.language || 'en');

  const handleSave = async () => {
    const parsed = parseFloat(localPercentage);
    if (isNaN(parsed) || parsed < 0 || parsed > 100) {
      Alert.alert(t('error.invalidInput', 'Invalid Input'), t('settings.invalidPercentage', 'Please enter a valid percentage between 0 and 100.'));
      return;
    }
    setSaving(true);
    const ok = await saveProfitPercentage(localPercentage);
    setSaving(false);
    if (!ok) {
      Alert.alert(
        t('common.error', 'Error'),
        t('settings.saveFailed', 'Saved on this device, but it could not be stored on your profile. It will not follow you to another phone.')
      );
      return;
    }
    Alert.alert(t('common.success', 'Success'), t('settings.saved', 'Settings saved successfully!'));
  };

  const handleFollowShop = async () => {
    setSaving(true);
    await followShopDefault();
    setSaving(false);
  };

  // Turning it on makes the phone prove it answers first, so the switch can never
  // be the thing that locks a technician out of their own till.
  const handleToggleLock = async (on: boolean) => {
    setLockBusy(true);
    await setLockRequired(on);
    setLockBusy(false);
  };

  const changeLanguage = async (lang: string) => {
    const needsRestart = await setLanguage(lang);
    setCurrentLang(lang);
    if (user?.id) {
      try {
        await updateDoc(doc(db, 'users', user.id), {
          preferredLanguage: lang,
        });
      } catch (err) {
        console.warn('Failed to update preferredLanguage in Firestore:', err);
      }
    }
    if (needsRestart) {
      Alert.alert(
        t('settings.languageChangedTitle', 'Restart required'),
        t('settings.languageChangedBody', 'The app must restart before the new reading direction applies.'),
        [
          { text: t('common.cancel', 'Cancel'), style: 'cancel' },
          {
            text: t('settings.restartNow', 'Restart now'),
            onPress: async () => {
              const restarted = await restartForDirection();
              if (!restarted) {
                Alert.alert(
                  t('settings.languageChangedTitle', 'Restart required'),
                  t('settings.restartManually', 'Close the app completely and open it again.')
                );
              }
            },
          },
        ]
      );
    }
  };

  return (
    <KeyboardAvoidingView 
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      style={styles.container}
    >
      <ScrollView contentContainerStyle={styles.scrollContent}>
        
        {/* Account Section */}
        <Text style={styles.sectionTitle}>{t('settings.account', 'Account')}</Text>
        <Card style={styles.card}>
          <Card.Content>
            <View style={styles.accountRow}>
              <View style={styles.avatar}>
                <Text style={styles.avatarText}>{user?.name?.charAt(0).toUpperCase() || 'U'}</Text>
              </View>
              <View style={styles.accountInfo}>
                <Text style={styles.accountName}>{user?.name}</Text>
                <Text style={styles.accountEmail}>{user?.email}</Text>
                <View style={styles.roleBadge}>
                  <Text style={styles.roleText}>{user?.role ? String(t(`roles.${user.role}`, { defaultValue: user.role.replace('_', ' ').toUpperCase() })) : ''}</Text>
                </View>
              </View>
            </View>
          </Card.Content>
        </Card>

        {/* Preferences Section */}
        <Text style={styles.sectionTitle}>{t('settings.preferences', 'Preferences')}</Text>
        <Card style={styles.card}>
          <Card.Content>
            <View style={styles.prefRow}>
              <MaterialCommunityIcons name="translate" size={24} color="#64748b" />
              <Text style={styles.prefLabel}>{t('settings.language', 'Language')}</Text>
            </View>
            <View style={styles.langRow}>
              <TouchableOpacity style={[styles.langBtn, currentLang.startsWith('en') && styles.langBtnActive]} onPress={() => changeLanguage('en')}>
                <Text style={[styles.langText, currentLang.startsWith('en') && styles.langTextActive]}>🇺🇸 EN</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.langBtn, currentLang.startsWith('fr') && styles.langBtnActive]} onPress={() => changeLanguage('fr')}>
                <Text style={[styles.langText, currentLang.startsWith('fr') && styles.langTextActive]}>🇫🇷 FR</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.langBtn, currentLang.startsWith('ar') && styles.langBtnActive]} onPress={() => changeLanguage('ar')}>
                <Text style={[styles.langText, currentLang.startsWith('ar') && styles.langTextActive]}>🇩🇿 AR</Text>
              </TouchableOpacity>
            </View>
            
            <Divider style={styles.divider} />
            
            <View style={styles.prefRow}>
              <MaterialCommunityIcons name="cash-multiple" size={24} color="#64748b" />
              <Text style={styles.prefLabel}>{t('settings.profitCalc', 'Profit Calculation')}</Text>
            </View>
            <TextInput
              label={t('settings.profitPercentage', 'Profit Percentage (%)')}
              value={localPercentage}
              onChangeText={setLocalPercentage}
              mode="outlined"
              keyboardType="numeric"
              style={styles.input}
              right={<TextInput.Affix text="%" />}
            />
            {shopPercentage !== null && (
              <Text style={styles.shopHint}>
                {personalPercentage
                  ? t('settings.usingOwn', { shop: shopPercentage, own: personalPercentage })
                  : t('settings.usingShop', { shop: shopPercentage })}
              </Text>
            )}
            <Button mode="contained" onPress={handleSave} loading={saving} disabled={saving} style={styles.saveButton}>
              {t('settings.saveSettings', 'Save Settings')}
            </Button>
            {personalPercentage && (
              <Button mode="text" onPress={handleFollowShop} disabled={saving} style={styles.followButton}>
                {t('settings.followShop', 'Use the shop default instead')}
              </Button>
            )}
          </Card.Content>
        </Card>

        {/* Security Section — this phone, not the account */}
        <Text style={styles.sectionTitle}>{t('settings.security', 'Security')}</Text>
        <Card style={styles.card}>
          <Card.Content>
            <View style={styles.lockRow}>
              <MaterialCommunityIcons name="fingerprint" size={24} color={colors.textSecondary} />
              <Text style={styles.lockLabel}>{t('settings.biometricTitle', 'Unlock with biometrics')}</Text>
              <Switch
                value={lockRequired}
                onValueChange={handleToggleLock}
                disabled={lockBusy || (!lockRequired && !lockCanEnable)}
                color={colors.brand}
              />
            </View>
            <Text style={styles.lockHint}>
              {lockCanEnable || lockRequired
                ? t('settings.biometricBody', 'This phone stays signed in, and asks for your fingerprint or face after about 5 minutes away.')
                : t('settings.biometricUnavailable', 'No fingerprint or face unlock is set up on this phone, so there is nothing to ask for.')}
            </Text>
            {Boolean(lockError) && <Text style={styles.lockError}>{lockError}</Text>}
          </Card.Content>
        </Card>

        {/* About Section */}
        <Text style={styles.sectionTitle}>{t('settings.about', 'About')}</Text>
        <Card style={styles.card}>
          <Card.Content style={styles.aboutContent}>
            <Image source={require('../../assets/icon.png')} style={styles.aboutLogo} />
            <Text style={styles.aboutTitle}>Auto-Manager</Text>
            <Text style={styles.aboutVersion}>Version {APP_VERSION}</Text>
            <Text style={styles.aboutFooter}>© 2026 Abdouh71. All rights reserved.</Text>
          </Card.Content>
        </Card>

      </ScrollView>

      {/* Logout Row at bottom */}
      <View style={styles.footer}>
        <TouchableOpacity style={styles.logoutRow} onPress={logout}>
          <MaterialCommunityIcons name="logout" size={24} color="#ef4444" />
          <Text style={styles.logoutText}>{t('sidebar.logout', 'Sign Out')}</Text>
        </TouchableOpacity>
      </View>

      <RoleBottomNav currentRoute="Settings" navigation={navigation} />
    </KeyboardAvoidingView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f1f5f9',
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 40,
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#64748b',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 8,
    marginTop: 8,
    marginLeft: 4,
  },
  card: {
    backgroundColor: '#ffffff',
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#e2e8f0',
    marginBottom: 16,
  },
  // Account Row
  accountRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  avatar: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#e0e7ff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    fontSize: 24,
    fontWeight: '800',
    color: '#4f46e5',
  },
  accountInfo: {
    marginLeft: 16,
    flex: 1,
  },
  accountName: {
    fontSize: 18,
    fontWeight: '700',
    color: '#0f172a',
  },
  accountEmail: {
    fontSize: 14,
    color: '#64748b',
    marginTop: 2,
  },
  roleBadge: {
    backgroundColor: '#f1f5f9',
    alignSelf: 'flex-start',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 8,
    marginTop: 6,
  },
  roleText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#475569',
  },
  // Preferences
  prefRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  prefLabel: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1e293b',
    marginLeft: 8,
  },
  langRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 8,
    gap: 8,
  },
  langBtn: {
    flex: 1,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 8,
    alignItems: 'center',
  },
  langBtnActive: {
    backgroundColor: '#e0e7ff',
    borderColor: '#818cf8',
  },
  langText: {
    fontSize: 16,
    color: '#64748b',
    fontWeight: '600',
  },
  langTextActive: {
    color: '#4f46e5',
    fontWeight: '700',
  },
  divider: {
    marginVertical: 16,
  },
  input: {
    backgroundColor: '#ffffff',
    marginBottom: 16,
  },
  saveButton: {
    borderRadius: 8,
  },
  followButton: {
    marginTop: 4,
  },
  shopHint: {
    fontSize: 12,
    color: '#64748b',
    marginBottom: 12,
    marginTop: -8,
  },
  // Security
  lockRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  lockLabel: {
    flex: 1,
    fontSize: 16,
    fontWeight: '600',
    color: colors.textPrimary,
    marginHorizontal: 8,
  },
  lockHint: {
    fontSize: 12,
    color: colors.textSecondary,
    marginTop: 8,
    lineHeight: 18,
  },
  lockError: {
    fontSize: 12,
    color: colors.danger,
    marginTop: 8,
    fontWeight: '600',
  },
  // About
  aboutContent: {
    alignItems: 'center',
    paddingVertical: 16,
  },
  aboutLogo: {
    width: 64,
    height: 64,
    borderRadius: 16,
    marginBottom: 12,
  },
  aboutTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: '#0f172a',
  },
  aboutVersion: {
    fontSize: 14,
    color: '#64748b',
    marginTop: 4,
  },
  aboutFooter: {
    fontSize: 12,
    color: '#94a3b8',
    marginTop: 16,
  },
  // Footer
  footer: {
    backgroundColor: '#ffffff',
    borderTopWidth: 1,
    borderTopColor: '#e2e8f0',
    paddingHorizontal: 16,
    paddingVertical: 16,
    paddingBottom: Platform.OS === 'ios' ? 32 : 16,
  },
  logoutRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#fef2f2',
    paddingVertical: 14,
    borderRadius: 12,
  },
  logoutText: {
    marginLeft: 8,
    fontSize: 16,
    fontWeight: '700',
    color: '#ef4444',
  }
});
