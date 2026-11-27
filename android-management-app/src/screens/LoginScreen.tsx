import React, { useState, useEffect } from 'react';
import { View, StyleSheet, KeyboardAvoidingView, Platform, Image, Animated, TouchableOpacity } from 'react-native';
import { TextInput, Button, Text } from 'react-native-paper';
import { useAuthStore } from '../store/authStore';
import { useLockStore } from '../store/lockStore';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import appConfig from '../../app.json';
import { colors, fontSize, radius, spacing } from '../theme/tokens';

// The same read the About screen uses, so the version on the login page cannot
// drift from the build in staff's hands — it used to claim 1.2.0 permanently.
const APP_VERSION = appConfig?.expo?.version ?? '—';

export const LoginScreen = () => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [hidePassword, setHidePassword] = useState(true);
  const [loading, setLoading] = useState(false);
  const [bioLoading, setBioLoading] = useState(false);
  const [hasBiometrics, setHasBiometrics] = useState(false);
  const [savedBioEmail, setSavedBioEmail] = useState<string | null>(null);
  const [savedBioName, setSavedBioName] = useState<string | null>(null);

  const { login, error } = useAuthStore();
  const { authenticateForLogin, promptRegisterBiometricsIfNeeded, getBiometricCredentials } = useLockStore();
  const { t } = useTranslation();
  const scaleAnim = React.useRef(new Animated.Value(0.9)).current;
  const fadeAnim = React.useRef(new Animated.Value(0)).current;

  // Check saved biometric credentials on mount
  useEffect(() => {
    getBiometricCredentials().then((creds) => {
      if (creds && creds.email && creds.password) {
        setHasBiometrics(true);
        setSavedBioEmail(creds.email);
        setSavedBioName(creds.name || null);
        setEmail(creds.email);
      }
    }).catch(() => undefined);
  }, [getBiometricCredentials]);

  React.useEffect(() => {
    Animated.parallel([
      Animated.spring(scaleAnim, {
        toValue: 1,
        friction: 4,
        tension: 50,
        useNativeDriver: true,
      }),
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 400,
        useNativeDriver: true,
      })
    ]).start();
  }, [scaleAnim, fadeAnim]);

  // A blank field is not a wrong password: it is a tap that costs a round trip
  // and returns "invalid credential" for nothing.
  const canSubmit = email.trim().length > 0 && password.length > 0 && !loading && !bioLoading;

  const handleLogin = async () => {
    if (!canSubmit) return;
    setLoading(true);
    const typedEmail = email.trim();
    const typedPassword = password;
    try {
      await login(typedEmail, typedPassword);
      // Once logged in successfully, ask user if they want to register biometrics
      // if not yet registered on this device
      setTimeout(() => {
        void promptRegisterBiometricsIfNeeded(typedEmail, typedPassword);
      }, 500);
    } catch (e) {
      // Error handled by store
    } finally {
      setLoading(false);
    }
  };

  const handleBiometricLogin = async () => {
    if (loading || bioLoading) return;
    setBioLoading(true);
    try {
      const creds = await authenticateForLogin();
      if (creds && creds.email && creds.password) {
        setEmail(creds.email);
        await login(creds.email, creds.password);
      }
    } catch {
      // handled by store
    } finally {
      setBioLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView 
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      style={styles.container}
    >
      <View style={styles.header}>
        <Animated.View style={[styles.iconContainer, { transform: [{ scale: scaleAnim }], opacity: fadeAnim }]}>
          <Image source={require('../../assets/icon.png')} style={styles.logo} />
        </Animated.View>
        <Text style={styles.title}>Auto-Manager</Text>
        <Text style={styles.subtitle}>{t('login.subtitle', 'Sign in to your workspace')}</Text>
      </View>

      <View style={styles.formContainer}>
        {error ? (
          <View style={styles.errorContainer}>
            <MaterialCommunityIcons name="alert-circle" size={20} color={colors.danger} />
            <Text style={styles.errorText}>{error}</Text>
          </View>
        ) : null}

        {/* Biometric Quick Login Button if registered */}
        {hasBiometrics && (
          <View style={styles.biometricBox}>
            <TouchableOpacity
              style={styles.biometricBtn}
              onPress={handleBiometricLogin}
              disabled={loading || bioLoading}
              activeOpacity={0.8}
            >
              <View style={styles.bioIconWrap}>
                <MaterialCommunityIcons name="fingerprint" size={28} color={colors.brand} />
              </View>
              <View style={styles.bioTextWrap}>
                <Text style={styles.bioTitle}>{t('login.signInBiometrics', 'Sign in with Biometrics')}</Text>
                <Text style={styles.bioSub} numberOfLines={1}>
                  {savedBioName ? `${savedBioName} (${savedBioEmail})` : savedBioEmail}
                </Text>
              </View>
              <MaterialCommunityIcons name="chevron-right" size={22} color={colors.brand} />
            </TouchableOpacity>

            <View style={styles.dividerRow}>
              <View style={styles.dividerLine} />
              <Text style={styles.dividerText}>{t('login.orPassword', 'or sign in with password')}</Text>
              <View style={styles.dividerLine} />
            </View>
          </View>
        )}

        <TextInput
          label={t('login.email', 'Email Address')}
          value={email}
          onChangeText={setEmail}
          mode="outlined"
          keyboardType="email-address"
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="next"
          style={styles.input}
          outlineStyle={styles.inputOutline}
          left={<TextInput.Icon icon="email-outline" color={colors.textFaint} />}
        />
        
        <TextInput
          label={t('login.password', 'Password')}
          value={password}
          onChangeText={setPassword}
          mode="outlined"
          secureTextEntry={hidePassword}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="go"
          onSubmitEditing={handleLogin}
          style={styles.input}
          outlineStyle={styles.inputOutline}
          left={<TextInput.Icon icon="lock-outline" color={colors.textFaint} />}
          right={
            <TextInput.Icon
              icon={hidePassword ? 'eye-off-outline' : 'eye-outline'}
              color={colors.textFaint}
              onPress={() => setHidePassword((hide) => !hide)}
              accessibilityLabel={t('login.showPassword', 'Show password')}
            />
          }
        />

        <Button 
          mode="contained" 
          onPress={handleLogin} 
          loading={loading || bioLoading}
          disabled={!canSubmit}
          style={styles.button}
          contentStyle={styles.buttonContent}
          labelStyle={styles.buttonLabel}
        >
          {t('login.signIn', 'Sign In')}
        </Button>

        <View style={styles.sessionRow}>
          <MaterialCommunityIcons name="fingerprint" size={16} color={colors.textMuted} />
          <Text style={styles.sessionNote}>
            {t('login.staysSignedIn', 'This phone keeps you signed in, and you can ask it for a fingerprint instead.')}
          </Text>
        </View>
      </View>

      <View style={styles.footer}>
        <Text style={styles.versionText}>{t('login.poweredBy', 'Powered by Auto-Manager')} · v{APP_VERSION}</Text>
      </View>
    </KeyboardAvoidingView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
    justifyContent: 'center',
    padding: spacing.xxl,
  },
  header: {
    alignItems: 'center',
    marginBottom: spacing.xxxl,
  },
  iconContainer: {
    width: 80,
    height: 80,
    borderRadius: radius.circle,
    backgroundColor: colors.brandSoft,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: spacing.lg,
  },
  logo: {
    width: 60,
    height: 60,
    borderRadius: radius.lg,
  },
  title: {
    fontSize: fontSize.display,
    fontWeight: '800',
    color: colors.textPrimary,
    letterSpacing: -0.5,
  },
  subtitle: {
    fontSize: fontSize.bodyStrong,
    color: colors.textSecondary,
    marginTop: spacing.xs,
    textAlign: 'center',
  },
  formContainer: {
    width: '100%',
  },
  biometricBox: {
    marginBottom: spacing.xs,
  },
  biometricBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderWidth: 1.5,
    borderColor: colors.brand,
    borderRadius: radius.lg,
    padding: spacing.sm,
    gap: spacing.sm,
  },
  bioIconWrap: {
    width: 44,
    height: 44,
    borderRadius: radius.circle,
    backgroundColor: colors.brandSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bioTextWrap: {
    flex: 1,
  },
  bioTitle: {
    fontSize: fontSize.bodyStrong,
    fontWeight: '700',
    color: colors.brand,
  },
  bioSub: {
    fontSize: fontSize.caption,
    color: colors.textSecondary,
    marginTop: 2,
  },
  dividerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: spacing.md,
    gap: spacing.sm,
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: colors.border,
  },
  dividerText: {
    fontSize: fontSize.caption,
    color: colors.textFaint,
    textTransform: 'uppercase',
  },
  input: {
    marginBottom: spacing.lg,
    backgroundColor: colors.surface,
  },
  inputOutline: {
    borderRadius: radius.lg,
    borderColor: colors.border,
  },
  button: {
    marginTop: spacing.sm,
    borderRadius: radius.lg,
  },
  buttonContent: {
    paddingVertical: spacing.md,
  },
  buttonLabel: {
    fontSize: fontSize.bodyStrong,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  sessionRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    marginTop: spacing.lg,
    paddingHorizontal: spacing.xs,
  },
  sessionNote: {
    flex: 1,
    fontSize: fontSize.caption,
    color: colors.textMuted,
    lineHeight: 17,
  },
  errorContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.dangerSoft,
    padding: spacing.md,
    borderRadius: radius.md,
    marginBottom: spacing.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.dangerBorder,
  },
  errorText: {
    color: colors.dangerText,
    marginLeft: spacing.sm,
    flex: 1,
    fontSize: fontSize.body,
    fontWeight: '500',
  },
  footer: {
    position: 'absolute',
    bottom: spacing.xxl,
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  versionText: {
    color: colors.textFaint,
    fontSize: fontSize.caption,
    fontWeight: '600',
  }
});
