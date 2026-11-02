import { useEffect, useState, useMemo } from 'react';
import { useLocation } from 'react-router-dom';
import { Save, ShieldAlert, Globe, AlertTriangle, Loader2, Palette, Check, Laptop, Monitor, TabletSmartphone } from 'lucide-react';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { Select } from '../../components/ui/Select';
import { useSettingsStore } from '../../store/settingsStore';
import { useToast } from '../../components/ui/Toast';
import { fetchPublicIP, useAuthStore } from '../../store/authStore';
import { usePosDensityStore, POS_DENSITY_OPTIONS } from '../../store/posDensityStore';
import { UsersTab } from './UsersTab';
import { ReceiptTab } from './ReceiptTab';
import { PrintersTab } from './PrintersTab';
import { BackupTab } from './BackupTab';
import { useTranslation } from 'react-i18next';
import i18n from '../../i18n';
import styles from './Settings.module.css';
import type { StoreSettings, ColorThemeKey } from '../../services/settingsService';
import { errorMessage } from '../../utils/errorUtils';

const COLOR_THEMES: {
  key: ColorThemeKey;
  name: string;
  tag: string;
  desc: string;
  primaryLight: string;
  surfaceLight: string;
  primaryDark: string;
  surfaceDark: string;
}[] = [
  {
    key: 'default',
    name: 'Precision Blue',
    tag: 'Default Store Theme',
    desc: 'Classic cobalt blue & clean cool slate surfaces. The original clean look.',
    primaryLight: '#0050cb',
    surfaceLight: '#f9f9ff',
    primaryDark: '#3b82f6',
    surfaceDark: '#111c2d',
  },
  {
    key: 'cyan',
    name: 'Titanium & Cyber Cyan',
    tag: 'Modern Tech',
    desc: 'Deep obsidian & carbon slate with glowing neon cyan accents.',
    primaryLight: '#0891b2',
    surfaceLight: '#f4f8fb',
    primaryDark: '#06b6d4',
    surfaceDark: '#0a111a',
  },
  {
    key: 'emerald',
    name: 'Emerald Mint & Fintech',
    tag: 'Financial Growth',
    desc: 'Crisp emerald green with mint highlights and deep spruce dark mode.',
    primaryLight: '#059669',
    surfaceLight: '#f4faf6',
    primaryDark: '#10b981',
    surfaceDark: '#061810',
  },
  {
    key: 'purple',
    name: 'Royal Velvet & Nebula',
    tag: 'Boutique Luxury',
    desc: 'Elegant royal violet with soft lavender containers and twilight slate.',
    primaryLight: '#7c3aed',
    surfaceLight: '#f9f6fc',
    primaryDark: '#8b5cf6',
    surfaceDark: '#120922',
  },
  {
    key: 'amber',
    name: 'Warm Amber & Crimson Gold',
    tag: 'Warm Workshop',
    desc: 'High-energy golden amber and warm sand with basalt charcoal contrast.',
    primaryLight: '#d97706',
    surfaceLight: '#fffaf4',
    primaryDark: '#f59e0b',
    surfaceDark: '#181108',
  },
];

// ─── Types ───────────────────────────────────────────────────
type TabKey = 'general' | 'users' | 'receipt' | 'printers' | 'backup' | 'preferences';

/** Fields managed by the draft-then-save flow on the General tab */
interface DraftSettings {
  storeName: string;
  currency: string;
  technicianProfitPercentage: number;
  weekStartDay: number;
  storePhone: string;
  storeAddress: string;
  trackingBaseUrl: string;
  allowedIp: string;
  enableNotifications: boolean;
}

// ─── Helpers ─────────────────────────────────────────────────
const STORE_NAME_MAX = 40;

const PRIVATE_IP_REGEX = /^(10\.\d{1,3}\.\d{1,3}\.\d{1,3})|(192\.168\.\d{1,3}\.\d{1,3})|(172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3})$/;

function isPrivateIp(ip: string): boolean {
  return PRIVATE_IP_REGEX.test(ip.trim());
}

/** Build a DraftSettings snapshot from the current Zustand store values */
function snapshotFromStore(s: ReturnType<typeof useSettingsStore.getState>): DraftSettings {
  return {
    storeName: s.storeName ?? '',
    currency: s.currency ?? 'USD',
    technicianProfitPercentage: s.technicianProfitPercentage ?? 0,
    weekStartDay: s.weekStartDay ?? 0,
    storePhone: s.storePhone ?? '',
    storeAddress: s.storeAddress ?? '',
    trackingBaseUrl: s.trackingBaseUrl ?? '',
    allowedIp: s.allowedIp ?? '',
    enableNotifications: s.enableNotifications ?? true,
  };
}

// ─── Component ───────────────────────────────────────────────
export const SettingsPage = () => {
  const settings = useSettingsStore();
  const toast = useToast();
  const { user } = useAuthStore();
  const { t } = useTranslation();
  const location = useLocation();

  // Language is a local user preference, not a store-wide admin setting
  const [currentLang, setCurrentLang] = useState(i18n.language.split('-')[0] || 'en');
  const [isDetectingIp, setIsDetectingIp] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  // Currency change confirmation modal
  const [pendingCurrency, setPendingCurrency] = useState<string | null>(null);
  const [currencyConfirmText, setCurrencyConfirmText] = useState('');

  // Tab routing (support deep-links e.g. /settings?tab=users)
  const [activeTab, setActiveTab] = useState<TabKey>('general');
  const posDensity = usePosDensityStore((s) => s.density);
  const setPosDensity = usePosDensityStore((s) => s.setDensity);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const tab = params.get('tab') as TabKey | null;
    if (tab && ['general', 'users', 'receipt', 'printers', 'backup', 'preferences'].includes(tab)) {
      setActiveTab(tab);
    }
    // Non-admin users default to the preferences tab
    if (user?.role !== 'admin') {
      setActiveTab('preferences');
    }
  }, [location.search, user?.role]);

  // Fetch settings on mount
  useEffect(() => {
    settings.fetchSettings();
  }, []);

  const handleSelectColorTheme = async (themeKey: ColorThemeKey) => {
    await settings.updateSetting('colorTheme', themeKey);
    toast.success('Theme Palette Applied', `Switched to ${COLOR_THEMES.find(t => t.key === themeKey)?.name}.`);
  };

  // ─── Local draft state (Problem 1 fix) ─────────────────────
  const [draft, setDraft] = useState<DraftSettings>(() => snapshotFromStore(settings));

  // Re-sync draft when store initializes or a real-time snapshot fires
  // (but ONLY if the user hasn't started editing)
  const [hasEdited, setHasEdited] = useState(false);

  useEffect(() => {
    if (!hasEdited && settings.isInitialized) {
      setDraft(snapshotFromStore(settings));
    }
  }, [
    settings.isInitialized,
    settings.storeName,
    settings.currency,
    settings.technicianProfitPercentage,
    settings.weekStartDay,
    settings.storePhone,
    settings.storeAddress,
    settings.trackingBaseUrl,
    settings.allowedIp,
    settings.enableNotifications,
    hasEdited,
  ]);

  /** Type-safe draft updater */
  const updateDraft = <K extends keyof DraftSettings>(key: K, value: DraftSettings[K]) => {
    setHasEdited(true);
    setDraft(prev => ({ ...prev, [key]: value }));
  };

  /** Detect unsaved changes */
  const hasUnsavedChanges = useMemo(() => {
    if (!settings.isInitialized) return false;
    const stored = snapshotFromStore(settings);
    return (Object.keys(draft) as (keyof DraftSettings)[]).some(
      k => String(draft[k]) !== String(stored[k])
    );
  }, [draft, settings]);

  // ─── Validation & Save ─────────────────────────────────────
  const handleSave = async () => {
    // Validate store name
    if (!draft.storeName.trim()) {
      toast.error('Validation Error', 'Store name cannot be empty.');
      return;
    }
    if (draft.storeName.length > STORE_NAME_MAX) {
      toast.error('Validation Error', `Store name must be ${STORE_NAME_MAX} characters or fewer (currently ${draft.storeName.length}).`);
      return;
    }

    // Validate technician profit percentage (Problem 6 fix)
    if (draft.technicianProfitPercentage < 0 || draft.technicianProfitPercentage > 100) {
      toast.error('Validation Error', 'Technician profit percentage must be between 0 and 100.');
      return;
    }

    // Validate IP address if provided (Problem 3 fix)
    const rawIp = draft.allowedIp.trim();
    if (rawIp) {
      const ips = rawIp.split(/[\s,]+/).map(ip => ip.trim()).filter(Boolean);
      const ipv4Pattern = /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/;
      for (const singleIp of ips) {
        if (isPrivateIp(singleIp)) {
          toast.error('Invalid IP Address', `IP ${singleIp} is a private/LAN address. Wi-Fi geofencing checks your public WAN IP. Use "Detect Current IP" to find your public IP.`);
          return;
        }
        if (!ipv4Pattern.test(singleIp)) {
          toast.error('Invalid IP Format', `"${singleIp}" is not a valid IPv4 address (e.g. 197.200.12.54). Separate multiple IPs with commas.`);
          return;
        }
      }
    }

    // If currency changed, require confirmation modal (Problem 5 fix)
    if (draft.currency !== settings.currency) {
      setPendingCurrency(draft.currency);
      setCurrencyConfirmText('');
      return; // The modal will call finalizeSave() after confirmation
    }

    await finalizeSave();
  };

  const finalizeSave = async () => {
    setIsSaving(true);
    try {
      const payload: Partial<StoreSettings> = {
        storeName: draft.storeName.trim(),
        currency: draft.currency,
        technicianProfitPercentage: draft.technicianProfitPercentage,
        weekStartDay: draft.weekStartDay,
        storePhone: draft.storePhone.trim(),
        storeAddress: draft.storeAddress.trim(),
        trackingBaseUrl: draft.trackingBaseUrl.trim(),
        allowedIp: draft.allowedIp.trim(),
        enableNotifications: draft.enableNotifications,
      };
      await settings.updateSettingsBulk(payload);
      setHasEdited(false);
      toast.success(t('settings.saved', 'Settings Saved'), 'Your store preferences have been updated.');
    } catch (err: unknown) {
      toast.error('Save Failed', errorMessage(err) || 'Could not write settings to Firestore. Please check your connection and try again.');
    } finally {
      setIsSaving(false);
      setPendingCurrency(null);
    }
  };

  // ─── Language (local preference) ───────────────────────────
  const handleLanguageChange = (lang: string) => {
    setCurrentLang(lang);
    i18n.changeLanguage(lang);
    localStorage.setItem('i18nextLng', lang);
  };

  // ─── IP Detection ─────────────────────────────────────────
  const handleDetectIp = async () => {
    setIsDetectingIp(true);
    const ip = await fetchPublicIP();
    setIsDetectingIp(false);
    if (ip) {
      const current = draft.allowedIp.trim();
      const currentIps = current.split(/[\s,]+/).filter(Boolean);
      let updatedIp = ip;
      if (current && !currentIps.includes(ip)) {
        updatedIp = `${current}, ${ip}`;
      }
      updateDraft('allowedIp', updatedIp);
      toast.success(t('settings.ipDetected', 'IP Detected'), `Store allowed IP set to: ${updatedIp}`);
    } else {
      toast.error(t('settings.ipDetectFailed', 'Failed to Detect IP'), t('settings.ipDetectFailedDesc', 'Could not fetch your public IP address. Please enter it manually.'));
    }
  };

  // ─── Admin tab list ────────────────────────────────────────
  const adminTabs: { key: TabKey; label: string }[] = [
    { key: 'general', label: t('common.general', 'General Settings') },
    { key: 'users', label: t('settings.users', 'Staff & Users') },
    { key: 'receipt', label: t('settings.receipts', 'Receipt Customization') },
    { key: 'printers', label: t('settings.printer', 'Printers & Hardware') },
    { key: 'backup', label: t('settings.backup', 'Data & Backup') },
  ];

  // ─── Render ────────────────────────────────────────────────
  return (
    <div className={styles.page}>
      {/* Header */}
      <div className={styles.header}>
        <h1 className={styles.title}>{t('settings.title', 'Settings')}</h1>
        {activeTab === 'general' && user?.role === 'admin' && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            {hasUnsavedChanges && (
              <span style={{
                fontSize: '12px',
                color: '#f59e0b',
                fontWeight: 500,
                display: 'flex',
                alignItems: 'center',
                gap: '4px',
              }}>
                <AlertTriangle size={14} />
                Unsaved changes
              </span>
            )}
            <Button
              leftIcon={isSaving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
              onClick={handleSave}
              disabled={isSaving || !hasUnsavedChanges}
            >
              {isSaving ? 'Saving…' : t('settings.saveSettings', 'Save Changes')}
            </Button>
          </div>
        )}
      </div>

      {/* Tabs */}
      <div className={styles.tabsContainer}>
        {user?.role === 'admin' && (
          <>
            {adminTabs.map(tab => (
              <button
                key={tab.key}
                className={[styles.tabBtn, activeTab === tab.key && styles.tabBtnActive].filter(Boolean).join(' ')}
                onClick={() => setActiveTab(tab.key)}
              >
                {tab.label}
              </button>
            ))}
          </>
        )}
        {/* All users get a Preferences tab */}
        <button
          className={[styles.tabBtn, activeTab === 'preferences' && styles.tabBtnActive].filter(Boolean).join(' ')}
          onClick={() => setActiveTab('preferences')}
        >
          {t('common.preferences', 'My Preferences')}
        </button>
        {user?.role !== 'admin' && activeTab !== 'preferences' && (
          <div style={{ padding: '8px 16px', color: 'var(--color-on-surface-variant)', fontSize: '14px' }}>
            {t('settings.adminOnly', 'Settings are managed by the store administrator.')}
          </div>
        )}
      </div>

      {/* ═══════════════ GENERAL TAB (Admin only) ═══════════════ */}
      {activeTab === 'general' && user?.role === 'admin' && (
        <div className={styles.grid}>
          {/* ── Store Details ── */}
          <Card padding="lg">
            <h2 className={styles.sectionTitle}>{t('common.general', 'Store Details')}</h2>
            <div className={styles.formGroup}>
              <div>
                <Input
                  label={t('settings.storeName', 'Store Name')}
                  value={draft.storeName}
                  onChange={e => updateDraft('storeName', e.target.value)}
                  maxLength={STORE_NAME_MAX}
                />
                <div style={{ fontSize: '11px', color: 'var(--color-on-surface-variant, #888)', marginTop: '2px', textAlign: 'right' }}>
                  {draft.storeName.length}/{STORE_NAME_MAX}
                </div>
              </div>

              <Input
                label={t('settings.storePhone', 'Store Phone Number')}
                value={draft.storePhone}
                onChange={e => updateDraft('storePhone', e.target.value)}
                placeholder="e.g. +213 555 123 456"
              />

              <Input
                label={t('settings.storeAddress', 'Store Address')}
                value={draft.storeAddress}
                onChange={e => updateDraft('storeAddress', e.target.value)}
                placeholder="e.g. 123 Tech Street, City"
              />

              <Select
                label={t('settings.currency', 'Currency')}
                value={draft.currency}
                onChange={val => updateDraft('currency', val)}
                options={[
                  { value: 'DZD', label: 'DZD (DA - Algerian Dinar)' },
                  { value: 'USD', label: 'USD ($ - US Dollar)' },
                  { value: 'EUR', label: 'EUR (€ - Euro)' },
                  { value: 'GBP', label: 'GBP (£ - British Pound)' },
                  { value: 'CAD', label: 'CAD (CA$ - Canadian Dollar)' },
                  { value: 'AUD', label: 'AUD (AU$ - Australian Dollar)' },
                  { value: 'TRY', label: 'TRY (₺ - Turkish Lira)' },
                  { value: 'SAR', label: 'SAR (SR - Saudi Riyal)' },
                  { value: 'AED', label: 'AED (AED - UAE Dirham)' },
                  { value: 'MAD', label: 'MAD (DH - Moroccan Dirham)' },
                  { value: 'TND', label: 'TND (DT - Tunisian Dinar)' },
                ]}
              />

              <div>
                <Input
                  label={t('settings.techProfitPercentage', 'Technician Profit Percentage (%)')}
                  type="number"
                  value={String(draft.technicianProfitPercentage)}
                  onChange={e => {
                    const raw = e.target.value;
                    // Allow empty field while typing, don't snap to 0 mid-edit
                    if (raw === '' || raw === '-') return;
                    const parsed = parseFloat(raw);
                    if (!isNaN(parsed)) {
                      updateDraft('technicianProfitPercentage', Math.max(0, Math.min(100, parsed)));
                    }
                  }}
                  placeholder="e.g. 50"
                  min={0}
                  max={100}
                />
                <div style={{ fontSize: '11px', color: 'var(--color-on-surface-variant, #888)', marginTop: '2px' }}>
                  Value must be between 0% and 100%.
                </div>
              </div>

              <Select
                label={t('settings.startOfWeek', 'Start of the Week')}
                value={String(draft.weekStartDay)}
                onChange={val => updateDraft('weekStartDay', parseInt(val, 10))}
                options={[
                  { value: '0', label: t('settings.sunday', 'Sunday') },
                  { value: '1', label: t('settings.monday', 'Monday') },
                  { value: '2', label: t('settings.tuesday', 'Tuesday') },
                  { value: '3', label: t('settings.wednesday', 'Wednesday') },
                  { value: '4', label: t('settings.thursday', 'Thursday') },
                  { value: '5', label: t('settings.friday', 'Friday') },
                  { value: '6', label: t('settings.saturday', 'Saturday') },
                ]}
              />
            </div>
          </Card>

          {/* ── Store Theme Combinations Palette ── */}
          <Card padding="lg">
            <h2 className={styles.sectionTitle} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Palette size={18} style={{ color: 'var(--color-primary)' }} />
              <span>Store Theme Palette (5 Combinations)</span>
            </h2>
            <p style={{ fontSize: '12px', color: 'var(--color-on-surface-variant, #666)', marginBottom: '16px', lineHeight: 1.4 }}>
              Select a harmonious color combination for your store. The palette will instantly apply across all buttons, navigation, cards, and screens on all connected computers and mobile devices.
            </p>
            
            <div className={styles.themeGrid}>
              {COLOR_THEMES.map(theme => {
                const isActive = (settings.colorTheme || 'default') === theme.key;
                return (
                  <div
                    key={theme.key}
                    className={[styles.themeCard, isActive && styles.themeCardActive].filter(Boolean).join(' ')}
                    onClick={() => handleSelectColorTheme(theme.key)}
                  >
                    <div className={styles.themeCardHeader}>
                      <h3 className={styles.themeCardTitle}>
                        <span>{theme.name}</span>
                      </h3>
                      <span className={styles.themeTag}>{theme.tag}</span>
                    </div>

                    <p className={styles.themeCardSubtitle}>{theme.desc}</p>

                    <div className={styles.themeSwatches}>
                      <div className={styles.themeSwatchGroup}>
                        <span className={styles.themeSwatchLabel}>Light:</span>
                        <span className={styles.themeSwatchDot} style={{ background: theme.primaryLight }} title="Primary Accent" />
                        <span className={styles.themeSwatchDot} style={{ background: theme.surfaceLight, border: '1.5px solid #cbd5e1' }} title="Surface Background" />
                      </div>
                      <div className={styles.themeSwatchGroup}>
                        <span className={styles.themeSwatchLabel}>Dark:</span>
                        <span className={styles.themeSwatchDot} style={{ background: theme.primaryDark }} title="Dark Primary Accent" />
                        <span className={styles.themeSwatchDot} style={{ background: theme.surfaceDark, border: '1.5px solid #334155' }} title="Dark Surface Background" />
                      </div>
                    </div>

                    {isActive && (
                      <div className={styles.activeIndicator}>
                        <Check size={14} /> Active Palette
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </Card>

          {/* ── Customer Tracking Portal ── */}
          <Card padding="lg">
            <h2 className={styles.sectionTitle}>{t('settings.customerTracking', 'Customer Tracking Portal')}</h2>
            <p style={{ fontSize: '12px', color: 'var(--color-on-surface-variant, #666)', marginBottom: '16px', lineHeight: 1.4 }}>
              {t('settings.trackingUrlDesc', 'Configure the public link where customers can track their repair status. This URL is encoded in the QR code on the intake receipt.')}
            </p>
            <div className={styles.formGroup}>
              <Input
                label={t('settings.trackingUrl', 'Tracking Base URL (Optional)')}
                value={draft.trackingBaseUrl}
                onChange={e => updateDraft('trackingBaseUrl', e.target.value)}
                placeholder="e.g. https://myphoneshop.com/track (leave blank to use current app URL)"
              />
            </div>
          </Card>

          {/* ── Geofencing & Security ── */}
          <Card padding="lg">
            <h2 className={styles.sectionTitle}>{t('settings.geofencing', 'Geofencing & Security')}</h2>
            <div className={styles.formGroup}>
              <div style={{ display: 'flex', gap: '8px', alignItems: 'flex-end' }}>
                <div style={{ flex: 1 }}>
                  <Input
                    label={t('settings.allowedIp', 'Allowed Store IP Address')}
                    value={draft.allowedIp}
                    onChange={e => updateDraft('allowedIp', e.target.value)}
                    placeholder="e.g. 197.200.12.54"
                  />
                </div>
                <Button
                  type="button"
                  variant="secondary"
                  onClick={handleDetectIp}
                  isLoading={isDetectingIp}
                  leftIcon={<Globe size={16} />}
                >
                  {t('settings.detectIp', 'Detect Current IP')}
                </Button>
              </div>
              <p style={{ fontSize: '12px', color: 'var(--color-on-surface-variant, #666)', marginTop: '4px', lineHeight: 1.4 }}>
                {t('settings.ipRestrictionDesc', 'Restrict Sales & Repair Agents access to these specific public IP addresses (comma-separated for primary & backup lines).')} Leave empty to disable the Wi-Fi lock and allow them to log in from any connection.
              </p>

              {/* Private IP warning */}
              {draft.allowedIp.trim() && draft.allowedIp.split(/[\s,]+/).some(ip => isPrivateIp(ip)) && (
                <div style={{
                  marginTop: '8px',
                  padding: '10px 12px',
                  background: 'rgba(245, 158, 11, 0.10)',
                  borderRadius: '6px',
                  fontSize: '12px',
                  color: '#b45309',
                  display: 'flex',
                  gap: '8px',
                  alignItems: 'center',
                }}>
                  <AlertTriangle size={16} />
                  <span>This contains a private LAN IP. Geofencing checks your <strong>public WAN IP</strong> — private addresses (192.168.x.x, 10.x.x.x) will never match and will lock out all staff.</span>
                </div>
              )}

              {/* Active geofence indicator */}
              {draft.allowedIp.trim() && !draft.allowedIp.split(/[\s,]+/).some(ip => isPrivateIp(ip)) && (
                <div style={{
                  marginTop: '8px',
                  padding: '10px 12px',
                  background: 'rgba(239, 68, 68, 0.08)',
                  borderRadius: '6px',
                  fontSize: '12px',
                  color: '#ef4444',
                  display: 'flex',
                  gap: '8px',
                  alignItems: 'center',
                }}>
                  <ShieldAlert size={16} />
                  <span>Wi-Fi Geofence is active. Only Admins can access outside these authorized IPs.</span>
                </div>
              )}

              {/* Dynamic IP warning */}
              {draft.allowedIp.trim() && !draft.allowedIp.split(/[\s,]+/).some(ip => isPrivateIp(ip)) && (
                <div style={{
                  marginTop: '6px',
                  padding: '8px 12px',
                  background: 'rgba(59, 130, 246, 0.06)',
                  borderRadius: '6px',
                  fontSize: '11px',
                  color: '#1d4ed8',
                  lineHeight: 1.4,
                }}>
                  ⚠️ Most ISPs in Algeria (Algerie Telecom ADSL/Fiber, 4G routers) assign <strong>dynamic public IPs</strong> that change every 24-48h or on router restart. You can add backup router IPs separated by commas.
                </div>
              )}
            </div>
          </Card>

          {/* ── Notifications Toggle ── */}
          <Card padding="lg">
            <h2 className={styles.sectionTitle}>{t('settings.notifications', 'Notifications')}</h2>
            <div className={styles.formGroup}>
              <div className={styles.toggleRow}>
                <div>
                  <div className={styles.toggleLabel}>{t('settings.enableNotifications', 'Enable Notifications')}</div>
                  <div className={styles.toggleDesc}>{t('settings.enableNotificationsDesc', 'Receive toast alerts for successful actions.')}</div>
                </div>
                <label className={styles.switch}>
                  <input
                    type="checkbox"
                    checked={draft.enableNotifications}
                    onChange={e => updateDraft('enableNotifications', e.target.checked)}
                  />
                  <span className={styles.slider}></span>
                </label>
              </div>
            </div>
          </Card>
        </div>
      )}

      {/* ═══════════════ PREFERENCES TAB (All users) ═══════════════ */}
      {activeTab === 'preferences' && (
        <div className={styles.grid}>
          <Card padding="lg">
            <h2 className={styles.sectionTitle}>{t('common.preferences', 'My Preferences')}</h2>
            <p style={{ fontSize: '12px', color: 'var(--color-on-surface-variant, #666)', marginBottom: '16px', lineHeight: 1.4 }}>
              These preferences are saved locally on this workstation and do not affect other users.
            </p>
            <div className={styles.formGroup}>
              <Select
                label={t('settings.theme', 'Theme')}
                value={settings.theme}
                onChange={val => settings.updateSetting('theme', val as StoreSettings['theme'])}
                options={[
                  { value: 'light', label: t('settings.light', 'Light Mode') },
                  { value: 'dark', label: t('settings.dark', 'Dark Mode') },
                  { value: 'system', label: t('settings.system', 'System Default') },
                ]}
              />

              <Select
                label={t('settings.language', 'Language')}
                value={currentLang}
                onChange={handleLanguageChange}
                options={[
                  { value: 'en', label: '🇬🇧 English' },
                  { value: 'fr', label: '🇫🇷 Français' },
                  { value: 'ar', label: '🇩🇿 العربية' },
                ]}
              />
            </div>

            <div style={{ marginTop: '24px', paddingTop: '16px', borderTop: '1px solid var(--color-surface-container-low)' }}>
              <h3 style={{ fontSize: '14px', fontWeight: 700, color: 'var(--color-on-surface)', marginBottom: '6px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Palette size={16} style={{ color: 'var(--color-primary)' }} />
                <span>Color Palette Combinations</span>
              </h3>
              <p style={{ fontSize: '12px', color: 'var(--color-on-surface-variant, #666)', marginBottom: '14px' }}>
                Choose which color combination to view the application in.
              </p>

              <div className={styles.themeGrid}>
                {COLOR_THEMES.map(theme => {
                  const isActive = (settings.colorTheme || 'default') === theme.key;
                  return (
                    <div
                      key={theme.key}
                      className={[styles.themeCard, isActive && styles.themeCardActive].filter(Boolean).join(' ')}
                      onClick={() => handleSelectColorTheme(theme.key)}
                    >
                      <div className={styles.themeCardHeader}>
                        <h4 className={styles.themeCardTitle}>{theme.name}</h4>
                        <span className={styles.themeTag}>{theme.tag}</span>
                      </div>
                      <p className={styles.themeCardSubtitle}>{theme.desc}</p>
                      <div className={styles.themeSwatches}>
                        <div className={styles.themeSwatchGroup}>
                          <span className={styles.themeSwatchLabel}>Light:</span>
                          <span className={styles.themeSwatchDot} style={{ background: theme.primaryLight }} />
                          <span className={styles.themeSwatchDot} style={{ background: theme.surfaceLight, border: '1.5px solid #cbd5e1' }} />
                        </div>
                        <div className={styles.themeSwatchGroup}>
                          <span className={styles.themeSwatchLabel}>Dark:</span>
                          <span className={styles.themeSwatchDot} style={{ background: theme.primaryDark }} />
                          <span className={styles.themeSwatchDot} style={{ background: theme.surfaceDark, border: '1.5px solid #334155' }} />
                        </div>
                      </div>
                      {isActive && (
                        <div className={styles.activeIndicator}>
                          <Check size={14} /> Active
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            <div style={{ marginTop: '24px', paddingTop: '16px', borderTop: '1px solid var(--color-surface-container-low)' }}>
              <h3 style={{ fontSize: '14px', fontWeight: 700, color: 'var(--color-on-surface)', marginBottom: '6px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Monitor size={16} style={{ color: 'var(--color-primary)' }} />
                <span>POS Counter Layout Density</span>
              </h3>
              <p style={{ fontSize: '12px', color: 'var(--color-on-surface-variant, #666)', marginBottom: '14px' }}>
                Select the ideal spacing and tap-target size for this counter workstation or touchscreen device. You can also press <kbd style={{ padding: '2px 6px', background: '#e2e8f0', borderRadius: '4px', fontSize: '11px', fontWeight: 700 }}>Alt + D</kbd> directly on the POS screen.
              </p>

              <div className={styles.themeGrid}>
                {POS_DENSITY_OPTIONS.map((opt) => {
                  const isActive = posDensity === opt.key;
                  return (
                    <div
                      key={opt.key}
                      className={[styles.themeCard, isActive && styles.themeCardActive].filter(Boolean).join(' ')}
                      onClick={() => {
                        setPosDensity(opt.key);
                        toast.info(`POS Density: ${opt.name}`, opt.description);
                      }}
                    >
                      <div className={styles.themeCardHeader}>
                        <h4 className={styles.themeCardTitle}>
                          {opt.iconName === 'laptop' && <Laptop size={15} style={{ verticalAlign: 'middle', marginRight: '6px' }} />}
                          {opt.iconName === 'monitor' && <Monitor size={15} style={{ verticalAlign: 'middle', marginRight: '6px' }} />}
                          {opt.iconName === 'touch' && <TabletSmartphone size={15} style={{ verticalAlign: 'middle', marginRight: '6px' }} />}
                          {opt.name}
                        </h4>
                        <span className={styles.themeTag}>{opt.tag}</span>
                      </div>
                      <p className={styles.themeCardSubtitle}>{opt.description}</p>
                      <div style={{ fontSize: '11px', color: 'var(--color-primary)', fontWeight: 600, marginTop: '6px' }}>
                        🎯 {opt.targetDevice}
                      </div>
                      {isActive && (
                        <div className={styles.activeIndicator}>
                          <Check size={14} /> Active
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </Card>
        </div>
      )}

      {/* ═══════════════ USERS TAB (Admin only) ═══════════════ */}
      {activeTab === 'users' && user?.role === 'admin' && <UsersTab />}

      {/* ═══════════════ RECEIPT TAB (Admin only) ═══════════════ */}
      {activeTab === 'receipt' && user?.role === 'admin' && <ReceiptTab />}

      {/* ═══════════════ PRINTERS TAB (Admin only) ═══════════════ */}
      {activeTab === 'printers' && user?.role === 'admin' && <PrintersTab />}

      {/* ═══════════════ BACKUP TAB (Admin only) ═══════════════ */}
      {activeTab === 'backup' && user?.role === 'admin' && <BackupTab />}

      {/* ═══════════ CURRENCY CHANGE CONFIRMATION MODAL ═══════════ */}
      {pendingCurrency && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 9999,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'rgba(0,0,0,0.5)',
            backdropFilter: 'blur(4px)',
          }}
          onClick={() => setPendingCurrency(null)}
        >
          <div
            style={{
              background: 'var(--color-surface, #fff)',
              borderRadius: '12px',
              padding: '28px',
              maxWidth: '440px',
              width: '90%',
              boxShadow: '0 20px 60px rgba(0,0,0,0.2)',
            }}
            onClick={e => e.stopPropagation()}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '16px' }}>
              <div style={{
                width: '40px',
                height: '40px',
                borderRadius: '10px',
                background: 'rgba(239, 68, 68, 0.1)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}>
                <AlertTriangle size={22} color="#dc2626" />
              </div>
              <div>
                <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 600, color: 'var(--color-on-surface)' }}>
                  Currency Change Warning
                </h3>
                <p style={{ margin: 0, fontSize: '12px', color: 'var(--color-on-surface-variant, #666)' }}>
                  {settings.currency} → {pendingCurrency}
                </p>
              </div>
            </div>

            <div style={{
              padding: '12px',
              background: 'rgba(239, 68, 68, 0.06)',
              borderRadius: '8px',
              fontSize: '13px',
              lineHeight: 1.5,
              color: '#991b1b',
              marginBottom: '16px',
            }}>
              <strong>This is a destructive operation.</strong> Changing the store currency will <strong>not</strong> convert existing amounts. All historical transactions, customer debts, parts costs, and repair prices will display in the new currency symbol without value conversion.
              <br /><br />
              For example, a $150 customer debt will appear as 150 {pendingCurrency} after the change.
            </div>

            <div style={{ marginBottom: '16px' }}>
              <label style={{ fontSize: '13px', fontWeight: 500, color: 'var(--color-on-surface)', display: 'block', marginBottom: '6px' }}>
                Type <strong>CONFIRM</strong> to proceed:
              </label>
              <input
                type="text"
                value={currencyConfirmText}
                onChange={e => setCurrencyConfirmText(e.target.value)}
                placeholder="CONFIRM"
                style={{
                  width: '100%',
                  padding: '8px 12px',
                  borderRadius: '6px',
                  border: '1px solid var(--color-outline-variant, #ccc)',
                  fontSize: '14px',
                  fontFamily: 'monospace',
                  boxSizing: 'border-box',
                }}
                autoFocus
              />
            </div>

            <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
              <Button variant="secondary" onClick={() => {
                setPendingCurrency(null);
                setCurrencyConfirmText('');
                // Revert draft currency to match store
                setDraft(prev => ({ ...prev, currency: settings.currency }));
              }}>
                Cancel
              </Button>
              <Button
                variant="primary"
                disabled={currencyConfirmText.trim() !== 'CONFIRM' || isSaving}
                onClick={() => {
                  if (currencyConfirmText.trim() === 'CONFIRM') {
                    finalizeSave();
                  }
                }}
                style={{
                  background: currencyConfirmText.trim() === 'CONFIRM' ? '#dc2626' : undefined,
                  borderColor: currencyConfirmText.trim() === 'CONFIRM' ? '#dc2626' : undefined,
                }}
              >
                {isSaving ? 'Saving…' : 'Change Currency'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
