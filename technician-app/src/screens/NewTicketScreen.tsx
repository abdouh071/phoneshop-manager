import React, { useState } from 'react';
import { View, StyleSheet, ScrollView, Alert, KeyboardAvoidingView, Platform } from 'react-native';
import { TextInput, Button, Title, Text, useTheme } from 'react-native-paper';
import { useRepairStore } from '../store/repairStore';
import { useAuthStore } from '../store/authStore';
import { useTranslation } from 'react-i18next';
import { Menu } from 'react-native-paper';

export const NewTicketScreen = ({ navigation }: any) => {
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [deviceBrand, setDeviceBrand] = useState('');
  const [deviceModel, setDeviceModel] = useState('');
  const [issueDescription, setIssueDescription] = useState('');
  const [lockType, setLockType] = useState('none');
  const [lockValue, setLockValue] = useState('');
  const [estimatedCost, setEstimatedCost] = useState('');
  const [assignedTechnician, setAssignedTechnician] = useState<string | null>(null);
  const [techMenuVisible, setTechMenuVisible] = useState(false);
  const [loading, setLoading] = useState(false);

  const { createTicket } = useRepairStore();
  const { user, staff, fetchStaff } = useAuthStore();
  const theme = useTheme();
  const { t } = useTranslation();

  React.useEffect(() => {
    fetchStaff();
  }, []);

  const handleSubmit = async () => {
    if (!customerName || !deviceBrand || !deviceModel || !issueDescription) {
      Alert.alert(t('error.missingFields', 'Missing Fields'), t('error.fillRequired', 'Please fill out all required fields marked with *'));
      return;
    }

    setLoading(true);
    try {
      await createTicket({
        customerName,
        customerPhone,
        deviceBrand,
        deviceModel,
        issueDescription,
        lockType: lockType as any,
        lockValue,
        assignedTechnician: assignedTechnician || undefined,
        estimatedCost: estimatedCost ? parseFloat(estimatedCost) : 0,
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

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{t('newTicket.customerInfo', 'Customer Info')}</Text>
          <TextInput
            label={t('newTicket.customerName', 'Customer Name *')}
            value={customerName}
            onChangeText={setCustomerName}
            mode="outlined"
            style={styles.input}
            outlineStyle={styles.inputOutline}
            left={<TextInput.Icon icon="account" />}
          />
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
        </View>

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
            numberOfLines={3}
            style={styles.input}
            outlineStyle={styles.inputOutline}
          />
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{t('newTicket.security', 'Security (Optional)')}</Text>
          <View style={styles.row}>
            <Button 
              mode={lockType === 'none' ? 'contained' : 'outlined'}
              onPress={() => setLockType('none')}
              style={[styles.chipButton, { marginRight: 8 }]}
              compact
            >
              {t('newTicket.none', 'None')}
            </Button>
            <Button 
              mode={lockType === 'pin' ? 'contained' : 'outlined'}
              onPress={() => setLockType('pin')}
              style={[styles.chipButton, { marginRight: 8 }]}
              compact
            >
              {t('newTicket.pin', 'PIN')}
            </Button>
            <Button 
              mode={lockType === 'pattern' ? 'contained' : 'outlined'}
              onPress={() => setLockType('pattern')}
              style={styles.chipButton}
              compact
            >
              {t('newTicket.pattern', 'Pattern')}
            </Button>
          </View>
          
          {lockType !== 'none' && lockType !== 'pattern' && (
            <TextInput
              label="Enter PIN / Password"
              value={lockValue}
              onChangeText={setLockValue}
              mode="outlined"
              style={[styles.input, { marginTop: 12 }]}
              outlineStyle={styles.inputOutline}
              left={<TextInput.Icon icon="lock" />}
            />
          )}
        </View>

        {(user?.role === 'admin' || user?.permissions?.repair_assign) && (
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
    marginBottom: 24,
  },
  title: {
    fontSize: 28,
    fontWeight: '800',
    color: '#0f172a',
  },
  subtitle: {
    fontSize: 15,
    color: '#64748b',
    marginTop: 4,
  },
  section: {
    marginBottom: 24,
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#94a3b8',
    marginBottom: 12,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  row: {
    flexDirection: 'row',
  },
  input: {
    marginBottom: 16,
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
  footer: {
    padding: 16,
    paddingBottom: 32, // Safe area for iOS
    backgroundColor: '#ffffff',
    borderTopWidth: 1,
    borderTopColor: '#f1f5f9',
  },
  submitButton: {
    borderRadius: 12,
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
