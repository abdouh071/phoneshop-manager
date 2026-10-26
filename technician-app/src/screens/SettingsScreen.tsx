import React, { useState } from 'react';
import { View, StyleSheet, KeyboardAvoidingView, Platform, Alert, ScrollView, TouchableOpacity, Image } from 'react-native';
import { TextInput, Button, Title, Text, useTheme, Card, Divider } from 'react-native-paper';
import { useSettingsStore } from '../store/settingsStore';
import { useAuthStore } from '../store/authStore';
import { useTranslation } from 'react-i18next';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import i18next from 'i18next';
import { doc, updateDoc } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { RoleBottomNav } from '../components/RoleBottomNav';

export const SettingsScreen = ({ navigation }: any) => {
  const theme = useTheme();
  const { profitPercentage, setProfitPercentage } = useSettingsStore();
  const { user, logout } = useAuthStore();
  const { t } = useTranslation();
  
  const [localPercentage, setLocalPercentage] = useState(profitPercentage);

  const [currentLang, setCurrentLang] = useState(i18next.language || 'en');

  const handleSave = () => {
    const parsed = parseFloat(localPercentage);
    if (isNaN(parsed) || parsed < 0 || parsed > 100) {
      Alert.alert(t('error.invalidInput', 'Invalid Input'), t('settings.invalidPercentage', 'Please enter a valid percentage between 0 and 100.'));
      return;
    }
    setProfitPercentage(localPercentage);
    Alert.alert(t('common.success', 'Success'), t('settings.saved', 'Settings saved successfully!'));
  };

  const changeLanguage = async (lang: string) => {
    i18next.changeLanguage(lang);
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
            <Button mode="contained" onPress={handleSave} style={styles.saveButton}>
              {t('settings.saveSettings', 'Save Settings')}
            </Button>
          </Card.Content>
        </Card>

        {/* About Section */}
        <Text style={styles.sectionTitle}>{t('settings.about', 'About')}</Text>
        <Card style={styles.card}>
          <Card.Content style={styles.aboutContent}>
            <Image source={require('../../assets/icon.png')} style={styles.aboutLogo} />
            <Text style={styles.aboutTitle}>Auto-Manager</Text>
            <Text style={styles.aboutVersion}>Version 1.2.0</Text>
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
    elevation: 1,
    shadowColor: '#0f172a',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 8,
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
