import React, { useState, useEffect } from 'react';
import { View, StyleSheet, ScrollView, Alert, KeyboardAvoidingView, Platform, TouchableOpacity } from 'react-native';
import { TextInput, Button, Title, Text, useTheme, Menu, Chip } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useRepairStore } from '../store/repairStore';
import { useAuthStore } from '../store/authStore';
import { usePermissions } from '../hooks/usePermissions';
import { customerService } from '../services/customerService';
import { useTranslation } from 'react-i18next';
import type { Customer } from '../types';

export const NewTicketScreen = ({ navigation }: any) => {
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [matchedCustomer, setMatchedCustomer] = useState<Customer | null>(null);
  /** The customer the technician explicitly linked by tapping the banner. */
  const [linkedCustomerId, setLinkedCustomerId] = useState<string | null>(null);
  const [deviceBrand, setDeviceBrand] = useState('');
  const [deviceModel, setDeviceModel] = useState('');
  const [issueDescription, setIssueDescription] = useState('');
  const [remark, setRemark] = useState('');
  const [lockType, setLockType] = useState<'none' | 'pin' | 'pattern'>('none');
  const [lockValue, setLockValue] = useState('');
  const [patternDots, setPatternDots] = useState<number[]>([]);
  const [estimatedCost, setEstimatedCost] = useState('');
  const [depositAmount, setDepositAmount] = useState('');
  const [assignedTechnician, setAssignedTechnician] = useState<string | null>(null);
  const [techMenuVisible, setTechMenuVisible] = useState(false);
  const [loading, setLoading] = useState(false);

  const { createTicket } = useRepairStore();
  const { user, staff, fetchStaff } = useAuthStore();
  const can = usePermissions();
  const theme = useTheme();
  const { t } = useTranslation();

  useEffect(() => {
    fetchStaff();
  }, []);

  // Look up customer when phone number reaches 8+ digits. The lookup only feeds the
  // "Known client" banner — the ticket is NOT linked by it; the technician has to
  // tap Link on the banner, and a different number clears that choice.
  useEffect(() => {
    const cleanPhone = customerPhone.replace(/\D/g, '');
    if (cleanPhone.length >= 8) {
      const timer = setTimeout(async () => {
        const found = await customerService.findByPhone(customerPhone);
        if (found) {
          setMatchedCustomer(found);
          setLinkedCustomerId(prev => (prev === found.id ? prev : null));
          if (!customerName) {
            setCustomerName(found.name);
          }
        } else {
          setMatchedCustomer(null);
          setLinkedCustomerId(null);
        }
      }, 350);
      return () => clearTimeout(timer);
    } else {
      setMatchedCustomer(null);
      setLinkedCustomerId(null);
    }
  }, [customerPhone]);

  // Handle tapping a pattern dot in 3x3 grid
  const handleDotPress = (dotNum: number) => {
    if (patternDots.includes(dotNum)) return; // No repeats in pattern
    const nextDots = [...patternDots, dotNum];
    setPatternDots(nextDots);
    setLockValue(nextDots.join('-'));
  };

  const handleClearPattern = () => {
    setPatternDots([]);
    setLockValue('');
  };

  const handleSubmit = async () => {
    if (!customerName || !deviceBrand || !deviceModel || !issueDescription) {
      Alert.alert(t('error.missingFields', 'Missing Fields'), t('error.fillRequired', 'Please fill out all required fields marked with *'));
      return;
    }

    setLoading(true);
    try {
      await createTicket({
        customerId: linkedCustomerId ?? undefined,
        customerName,
        customerPhone,
        deviceBrand,
        deviceModel,
        issueDescription,
        remark: remark.trim() || undefined,
        lockType,
        lockValue: lockType === 'none' ? undefined : lockValue,
        assignedTechnician: assignedTechnician || undefined,
        estimatedCost: estimatedCost ? parseFloat(estimatedCost) : 0,
        depositAmount: depositAmount ? parseFloat(depositAmount) : 0,
        createdById: user?.id,
        createdByName: user?.name,
      });
      navigation.goBack();
    } catch (error) {
      Alert.alert(t('common.error', 'Error'), t('newTicket.createFailed', 'Failed to create ticket. Please try again.'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView 
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      style={styles.container}
    >
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <Title style={styles.title}>{t('newTicket.title', 'New Repair Ticket')}</Title>
          <Text style={styles.subtitle}>{t('newTicket.subtitle', 'Enter device and customer details below.')}</Text>
        </View>

        {/* Customer Info Section */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{t('newTicket.customerInfo', 'Customer Info')}</Text>
          <TextInput
            label={t('newTicket.phoneNumber', 'Phone Number')}
            value={customerPhone}
            onChangeText={setCustomerPhone}
            mode="outlined"
            keyboardType="phone-pad"
            style={styles.input}
            outlineStyle={styles.inputOutline}
            left={<TextInput.Icon icon="phone" />}
          />
          {matchedCustomer && (
            <View style={styles.matchedCustomerBanner}>
              <MaterialCommunityIcons name="account-check" size={18} color="#10b981" />
              <Text style={styles.matchedCustomerText}>
                Known client: {matchedCustomer.name} {matchedCustomer.totalDebt ? `(Debt: ${matchedCustomer.totalDebt} DA)` : ''}
              </Text>
              {linkedCustomerId === matchedCustomer.id ? (
                <View style={styles.linkedCustomerPill}>
                  <MaterialCommunityIcons name="link-variant" size={14} color="#065f46" />
                  <Text style={styles.linkedCustomerText}>{t('newTicket.linked', 'Linked')}</Text>
                </View>
              ) : (
                <TouchableOpacity
                  style={styles.linkCustomerBtn}
                  onPress={() => setLinkedCustomerId(matchedCustomer.id)}
                >
                  <Text style={styles.linkCustomerBtnText}>{t('newTicket.linkCustomer', 'Link')}</Text>
                </TouchableOpacity>
              )}
            </View>
          )}
          <TextInput
            label={t('newTicket.customerName', 'Customer Name *')}
            value={customerName}
            onChangeText={setCustomerName}
            mode="outlined"
            style={styles.input}
            outlineStyle={styles.inputOutline}
            left={<TextInput.Icon icon="account" />}
          />
        </View>

        {/* Device Details Section */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{t('newTicket.deviceDetails', 'Device Details')}</Text>
          <View style={styles.row}>
            <TextInput
              label={t('newTicket.brand', 'Brand *')}
              value={deviceBrand}
              onChangeText={setDeviceBrand}
              mode="outlined"
              style={[styles.input, { flex: 1, marginRight: 12 }]}
              outlineStyle={styles.inputOutline}
            />
            <TextInput
              label={t('newTicket.model', 'Model *')}
              value={deviceModel}
              onChangeText={setDeviceModel}
              mode="outlined"
              style={[styles.input, { flex: 1 }]}
              outlineStyle={styles.inputOutline}
            />
          </View>
          <TextInput
            label={t('newTicket.issueDescription', 'Issue Description *')}
            value={issueDescription}
            onChangeText={setIssueDescription}
            mode="outlined"
            multiline
            numberOfLines={2}
            style={styles.input}
            outlineStyle={styles.inputOutline}
          />
          <TextInput
            label={t('newTicket.remarks', 'Condition / Findings (Optional)')}
            value={remark}
            onChangeText={setRemark}
            placeholder={t('newTicket.remarksPlaceholder', 'e.g. Scratched back, missing SIM tray, water indicator pink')}
            mode="outlined"
            multiline
            numberOfLines={2}
            style={styles.input}
            outlineStyle={styles.inputOutline}
          />
        </View>

        {/* Cost & Deposit Section */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{t('newTicket.financials', 'Pricing & Deposit')}</Text>
          <View style={styles.row}>
            <TextInput
              label={t('newTicket.estimatedCost', 'Estimated Cost')}
              value={estimatedCost}
              onChangeText={setEstimatedCost}
              mode="outlined"
              keyboardType="numeric"
              style={[styles.input, { flex: 1, marginRight: 12 }]}
              outlineStyle={styles.inputOutline}
              right={<TextInput.Affix text="DA" />}
            />
            <TextInput
              label={t('ticket.deposit', 'Deposit Amount')}
              value={depositAmount}
              onChangeText={setDepositAmount}
              mode="outlined"
              keyboardType="numeric"
              style={[styles.input, { flex: 1 }]}
              outlineStyle={styles.inputOutline}
              right={<TextInput.Affix text="DA" />}
            />
          </View>
        </View>

        {/* Security & Lock Section */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{t('newTicket.security', 'Security / Passcode')}</Text>
          <View style={styles.row}>
            <Button 
              mode={lockType === 'none' ? 'contained' : 'outlined'}
              onPress={() => { setLockType('none'); setLockValue(''); setPatternDots([]); }}
              style={[styles.chipButton, { marginRight: 8 }]}
              compact
            >
              {t('newTicket.none', 'None')}
            </Button>
            <Button 
              mode={lockType === 'pin' ? 'contained' : 'outlined'}
              onPress={() => { setLockType('pin'); setLockValue(''); setPatternDots([]); }}
              style={[styles.chipButton, { marginRight: 8 }]}
              compact
            >
              {t('newTicket.pin', 'PIN')}
            </Button>
            <Button 
              mode={lockType === 'pattern' ? 'contained' : 'outlined'}
              onPress={() => { setLockType('pattern'); setLockValue(''); setPatternDots([]); }}
              style={styles.chipButton}
              compact
            >
              {t('newTicket.pattern', 'Pattern')}
            </Button>
          </View>
          
          {lockType === 'pin' && (
            <TextInput
              label={t('newTicket.enterPin', 'Enter PIN / Password')}
              value={lockValue}
              onChangeText={setLockValue}
              mode="outlined"
              style={[styles.input, { marginTop: 12 }]}
              outlineStyle={styles.inputOutline}
              left={<TextInput.Icon icon="lock" />}
            />
          )}

          {lockType === 'pattern' && (
            <View style={styles.patternBox}>
              <View style={styles.patternHeaderRow}>
                <Text style={styles.patternSequence}>
                  {patternDots.length > 0
                    ? patternDots.join(', ')
                    : t('newTicket.tapPattern', 'Tap dots to draw pattern')}
                </Text>
                {patternDots.length > 0 && (
                  <Button mode="text" compact textColor="#ef4444" onPress={handleClearPattern}>
                    {t('common.clear', 'Clear')}
                  </Button>
                )}
              </View>

              {/* 3x3 Dot Grid */}
              <View style={styles.patternGrid}>
                {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((dot) => {
                  const isSelected = patternDots.includes(dot);
                  const order = patternDots.indexOf(dot) + 1;
                  return (
                    <TouchableOpacity
                      key={dot}
                      style={[styles.patternDotBtn, isSelected && styles.patternDotSelected]}
                      onPress={() => handleDotPress(dot)}
                    >
                      <Text style={[styles.patternDotText, isSelected && styles.patternDotTextSelected]}>
                        {isSelected ? order : dot}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>
          )}
        </View>

        {/* Technician Assignment */}
        {can.repair_assign && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>{t('newTicket.assignment', 'Technician Assignment (Optional)')}</Text>
            <Menu
              visible={techMenuVisible}
              onDismiss={() => setTechMenuVisible(false)}
              anchor={
                <Button 
                  mode="outlined" 
                  onPress={() => setTechMenuVisible(true)}
                  style={{ borderRadius: 12, borderColor: '#e2e8f0' }}
                  contentStyle={{ paddingVertical: 8, justifyContent: 'flex-start' }}
                  labelStyle={{ color: assignedTechnician ? '#0f172a' : '#64748b' }}
                  icon="account-wrench"
                >
                  {assignedTechnician || t('newTicket.selectTech', 'Select Technician...')}
                </Button>
              }
            >
              <Menu.Item 
                onPress={() => { setAssignedTechnician(null); setTechMenuVisible(false); }} 
                title={t('newTicket.unassigned', 'Unassigned')} 
              />
              {staff.filter(s => s.role === 'repair_agent').map((tech) => (
                <Menu.Item
                  key={tech.id}
                  onPress={() => { setAssignedTechnician(tech.name); setTechMenuVisible(false); }}
                  title={tech.name}
                />
              ))}
            </Menu>
          </View>
        )}

      </ScrollView>
      
      <View style={styles.footer}>
        <Button 
          mode="contained" 
          onPress={handleSubmit} 
          loading={loading}
          disabled={loading}
          style={styles.submitButton}
          contentStyle={styles.submitButtonContent}
          labelStyle={styles.submitButtonLabel}
          icon="plus-circle"
        >
          {t('newTicket.createTicket', 'Create Ticket')}
        </Button>
      </View>
    </KeyboardAvoidingView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f8fafc',
  },
  content: {
    padding: 20,
    paddingBottom: 40,
  },
  header: {
    marginBottom: 20,
  },
  title: {
    fontSize: 26,
    fontWeight: '800',
    color: '#0f172a',
  },
  subtitle: {
    fontSize: 14,
    color: '#64748b',
    marginTop: 4,
  },
  section: {
    marginBottom: 20,
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#94a3b8',
    marginBottom: 10,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  row: {
    flexDirection: 'row',
  },
  input: {
    marginBottom: 12,
    backgroundColor: '#ffffff',
  },
  inputOutline: {
    borderRadius: 12,
    borderColor: '#e2e8f0',
  },
  chipButton: {
    flex: 1,
    borderRadius: 8,
  },
  matchedCustomerBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#ecfdf5',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#a7f3d0',
    gap: 8,
  },
  matchedCustomerText: {
    color: '#065f46',
    fontSize: 13,
    fontWeight: '600',
    flexShrink: 1,
  },
  linkCustomerBtn: {
    marginLeft: 'auto',
    backgroundColor: '#10b981',
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 6,
  },
  linkCustomerBtnText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '700',
  },
  linkedCustomerPill: {
    marginLeft: 'auto',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderWidth: 1,
    borderColor: '#065f46',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  linkedCustomerText: {
    color: '#065f46',
    fontSize: 12,
    fontWeight: '700',
  },
  patternBox: {
    backgroundColor: '#ffffff',
    borderRadius: 12,
    padding: 16,
    marginTop: 12,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    alignItems: 'center',
  },
  patternHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    width: '100%',
    marginBottom: 12,
  },
  patternSequence: {
    fontSize: 15,
    fontWeight: '700',
    color: '#4f46e5',
  },
  patternGrid: {
    width: 220,
    height: 220,
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    alignContent: 'space-between',
  },
  patternDotBtn: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: '#f1f5f9',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#cbd5e1',
  },
  patternDotSelected: {
    backgroundColor: '#4f46e5',
    borderColor: '#3730a3',
  },
  patternDotText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#64748b',
  },
  patternDotTextSelected: {
    color: '#ffffff',
  },
  footer: {
    padding: 16,
    paddingBottom: Platform.OS === 'ios' ? 32 : 16,
    backgroundColor: '#ffffff',
    borderTopWidth: 1,
    borderTopColor: '#f1f5f9',
  },
  submitButton: {
    borderRadius: 12,
    backgroundColor: '#4f46e5',
  },
  submitButtonContent: {
    paddingVertical: 10,
  },
  submitButtonLabel: {
    fontSize: 16,
    fontWeight: '700',
    letterSpacing: 0.5,
  }
});
