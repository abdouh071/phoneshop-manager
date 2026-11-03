import React, { useState } from 'react';
import { View, StyleSheet, KeyboardAvoidingView, Platform, Image, Animated } from 'react-native';
import { TextInput, Button, Text } from 'react-native-paper';
import { useAuthStore } from '../store/authStore';
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
  const { login, error } = useAuthStore();
  const { t } = useTranslation();
  const scaleAnim = React.useRef(new Animated.Value(0.9)).current;
  const fadeAnim = React.useRef(new Animated.Value(0)).current;

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
  const canSubmit = email.trim().length > 0 && password.length > 0 && !loading;

  const handleLogin = async () => {
    if (!canSubmit) return;
    setLoading(true);
    try {
      await login(email.trim(), password);
    } catch (e) {
      // Error handled by store
    } finally {
      setLoading(false);
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
          loading={loading}
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
