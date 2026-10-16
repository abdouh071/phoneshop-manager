import React, { useState } from 'react';
import { View, StyleSheet, ScrollView, Alert, TouchableOpacity, Linking } from 'react-native';
import { Text, Card, Title, Paragraph, Button, Divider, TextInput, IconButton } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useRepairStore } from '../store/repairStore';
import { useAuthStore } from '../store/authStore';
import { collection, addDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { useTranslation } from 'react-i18next';

export const TicketDetailScreen = ({ route, navigation }: any) => {
  const { ticket } = route.params;
  const { updateTicketStatus, updateTicketParts } = useRepairStore();
  const { user } = useAuthStore();
  const [loading, setLoading] = useState(false);
  const { t } = useTranslation();
  
  // Parts state
  const [parts, setParts] = useState<{ name: string; cost: number }[]>(ticket.partsUsed || []);
  const [partName, setPartName] = useState('');
  const [partCost, setPartCost] = useState('');

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'pending': return '#f59e0b';
      case 'in_progress': return '#3b82f6';
      case 'ready': return '#10b981';
      case 'returned': return '#ef4444';
      default: return '#64748b';
    }
  };

  const handleAddPart = async () => {
    const cost = parseFloat(partCost);
    if (!partName.trim() || isNaN(cost) || cost < 0) {
      Alert.alert(t('error.invalidInput', 'Invalid Input'), t('error.validPart', 'Please enter a valid part name and positive cost.'));
      return;
    }
    const newParts = [...parts, { name: partName.trim(), cost }];
    setParts(newParts);
    setPartName('');
    setPartCost('');
    // Save immediately to Firestore
    try {
      await updateTicketParts(ticket.id, newParts);
    } catch (e) {
      console.error('Failed to save parts:', e);
    }
  };

  const handleRemovePart = async (index: number) => {
    const newParts = [...parts];
    newParts.splice(index, 1);
    setParts(newParts);
    // Save immediately to Firestore
    try {
      await updateTicketParts(ticket.id, newParts);
    } catch (e) {
      console.error('Failed to save parts:', e);
    }
  };

  const handleMarkAsRepaired = async () => {
    Alert.alert(
      t('ticketDetail.confirmRepair', 'Confirm Repair'),
      t('ticketDetail.confirmRepairMsg', 'Are you sure you want to mark this device as repaired?'),
      [
        { text: t('common.cancel', 'Cancel'), style: 'cancel' },
        { 
          text: t('ticketDetail.yesMarkRepaired', 'Yes, Mark Repaired'), 
          onPress: async () => {
            setLoading(true);
            try {
              // Add partsUsed and completedAt
              const additionalUpdates = {
                partsUsed: parts.map(p => ({
                  name: p.name,
                  cost: p.cost,
                  quantity: 1,
                  productId: 'custom-mobile-part'
                })),
                completedAt: new Date().toISOString()
              };
              
              await updateTicketStatus(ticket.id, 'ready', user?.name || 'Technician', additionalUpdates);
              Alert.alert(t('common.success', 'Success'), t('ticketDetail.markedReady', 'Ticket marked as Ready for Pickup.'));
              navigation.goBack();
            } catch (error) {
              Alert.alert(t('common.error', 'Error'), t('ticketDetail.updateFailed', 'Failed to update ticket.'));
              setLoading(false);
            }
          } 
        }
      ]
    );
  };

  const handleStartRepair = async () => {
    setLoading(true);
    try {
      await updateTicketStatus(ticket.id, 'in_progress', user?.name || 'Technician');
      navigation.goBack();
    } catch (error) {
      Alert.alert(t('common.error', 'Error'), t('ticketDetail.updateFailed', 'Failed to update ticket.'));
      setLoading(false);
    }
  };

  const handleMarkAsClaimed = async () => {
    Alert.alert(
      t('ticketDetail.confirmHandover', 'Confirm Handover'),
      t('ticketDetail.confirmHandoverMsg', 'Are you sure you want to mark this device as claimed by the customer?'),
      [
        { text: t('common.cancel', 'Cancel'), style: 'cancel' },
        { 
          text: t('ticketDetail.yesClaimed', 'Yes, Claimed'), 
          onPress: async () => {
            setLoading(true);
            try {
              await updateTicketStatus(ticket.id, 'completed', user?.name || 'Sales Agent');
              Alert.alert(t('common.success', 'Success'), t('ticketDetail.phoneClaimed', 'Phone marked as claimed/completed.'));
              navigation.goBack();
            } catch (error) {
              Alert.alert(t('common.error', 'Error'), t('ticketDetail.updateFailed', 'Failed to update ticket.'));
              setLoading(false);
            }
          } 
        }
      ]
    );
  };

  const handleCall = () => {
    if (ticket.customerPhone) {
      Linking.openURL(`tel:${ticket.customerPhone}`);
    }
  };

  const handleWhatsApp = () => {
    if (ticket.customerPhone) {
      // Remove spaces or special chars for whatsapp link
      const phone = ticket.customerPhone.replace(/\D/g,'');
      Linking.openURL(`whatsapp://send?phone=${phone}`);
    }
  };

  const handlePrintRemote = async () => {
    Alert.alert(
      t('ticketDetail.printSticker', 'Print Sticker'),
      t('ticketDetail.printStickerMsg', 'Send a print command to the PC?'),
      [
        { text: t('common.cancel', 'Cancel'), style: 'cancel' },
        { text: t('common.print', 'Print'), 
          onPress: async () => {
            try {
              await addDoc(collection(db, 'printQueue'), {
                status: 'pending',
                type: 'repair_label',
                ticket: ticket,
                requestedBy: user?.name,
                createdAt: serverTimestamp(),
              });
              Alert.alert(t('common.success', 'Success'), t('ticketDetail.printSent', 'Print command sent to PC!'));
            } catch (error) {
              Alert.alert(t('common.error', 'Error'), t('ticketDetail.printFailed', 'Failed to send print command.'));
            }
          } 
        }
      ]
    );
  };

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        {/* Hero Header with status color tint */}
        <View style={[styles.headerBlock, { backgroundColor: getStatusColor(ticket.status) + '08' }]}>
          <View style={styles.ticketBadgeContainer}>
            <Text style={styles.ticketNumber}>{ticket.ticketNumber}</Text>
            <View style={[styles.statusBadgeLarge, { backgroundColor: getStatusColor(ticket.status) }]}>
              <Text style={styles.statusTextLarge}>
                {ticket.status.replace('_', ' ').toUpperCase()}
              </Text>
            </View>
          </View>
          
          <Title style={styles.deviceTitle}>{ticket.deviceBrand} {ticket.deviceModel}</Title>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 4 }}>
            <Text style={styles.dateText}>
              {t('ticketDetail.receivedOn', 'Received on')} {new Date(ticket.createdAt).toLocaleDateString()}
            </Text>
            <Button 
              mode="contained-tonal" 
              icon="printer" 
              onPress={handlePrintRemote}
              buttonColor="#e0e7ff"
              textColor="#4f46e5"
              compact
            >
              {t('ticketDetail.printSticker', 'Print Sticker')}
            </Button>
          </View>
        </View>

        {/* Customer Card */}
        <Card style={styles.card}>
          <Card.Content>
            <View style={styles.sectionHeader}>
              <MaterialCommunityIcons name="account" size={20} color="#4f46e5" />
              <Text style={styles.sectionTitle}>{t('ticketDetail.customerDetails', 'Customer Details')}</Text>
            </View>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <View style={{ flex: 1 }}>
                <Text style={styles.detailText}>{ticket.customerName}</Text>
                {ticket.customerPhone ? <Text style={styles.subDetailText}>{ticket.customerPhone}</Text> : null}
              </View>
              {ticket.customerPhone && (
                <View style={{ flexDirection: 'row', gap: 4 }}>
                  <TouchableOpacity style={[styles.quickActionBtn, { backgroundColor: '#eff6ff' }]} onPress={handleCall}>
                    <MaterialCommunityIcons name="phone" size={20} color="#2563eb" />
                  </TouchableOpacity>
                  <TouchableOpacity style={[styles.quickActionBtn, { backgroundColor: '#f0fdf4' }]} onPress={handleWhatsApp}>
                    <MaterialCommunityIcons name="whatsapp" size={20} color="#16a34a" />
                  </TouchableOpacity>
                </View>
              )}
            </View>
          </Card.Content>
        </Card>

        {/* Issue Card */}
        <Card style={styles.card}>
          <Card.Content>
            <View style={styles.sectionHeader}>
              <MaterialCommunityIcons name="alert-circle" size={20} color="#f59e0b" />
              <Text style={styles.sectionTitle}>{t('ticketDetail.issueDescription', 'Issue Description')}</Text>
            </View>
            <Paragraph style={styles.issueText}>{ticket.issueDescription}</Paragraph>
          </Card.Content>
        </Card>

        {/* Lock Code Card */}
        <Card style={styles.card}>
          <Card.Content>
            <View style={styles.sectionHeader}>
              <MaterialCommunityIcons name="lock" size={20} color="#ef4444" />
              <Text style={styles.sectionTitle}>{t('ticketDetail.securityCode', 'Security / Lock Code')}</Text>
            </View>
            {ticket.lockType && ticket.lockType !== 'none' ? (
              <View style={styles.lockBox}>
                <Text style={styles.lockText}>
                  {ticket.lockType === 'pattern' ? t('ticketDetail.patternLock', 'Pattern Lock') : `${t('ticketDetail.pinPassword', 'PIN/Password')}: ${ticket.lockValue}`}
                </Text>
              </View>
            ) : (
              <Text style={styles.subDetailText}>{t('ticketDetail.noLockCode', 'No lock code provided')}</Text>
            )}
          </Card.Content>
        </Card>

        {/* Parts Section - visible on ALL statuses */}
        <Card style={styles.card}>
          <Card.Content>
            <View style={styles.sectionHeader}>
              <MaterialCommunityIcons name="cog" size={20} color="#10b981" />
              <Text style={styles.sectionTitle}>{t('ticketDetail.partsUsed', 'Parts Used & Cost')}</Text>
            </View>
            
            {(user?.role === 'repair_agent' || user?.role === 'admin' || user?.permissions?.repair_edit) && (
              <View style={styles.addPartRow}>
                <TextInput
                  label={t('ticketDetail.partName', 'Part Name')}
                  value={partName}
                  onChangeText={setPartName}
                  mode="outlined"
                  style={[styles.partInput, { flex: 2 }]}
                  dense
                />
                <TextInput
                  label={t('ticketDetail.buyPrice', 'Buy Price')}
                  value={partCost}
                  onChangeText={setPartCost}
                  mode="outlined"
                  keyboardType="numeric"
                  style={[styles.partInput, { flex: 1, marginLeft: 8 }]}
                  dense
                />
                <IconButton 
                  icon="plus" 
                  mode="contained"
                  containerColor="#10b981"
                  iconColor="#fff"
                  size={24}
                  style={{ marginTop: 6 }}
                  onPress={handleAddPart}
                />
              </View>
            )}

            {parts.map((p, idx) => (
              <View key={idx} style={styles.partItem}>
                <Text style={{ flex: 1, fontSize: 16 }}>{p.name}</Text>
                <Text style={{ fontWeight: 'bold', fontSize: 16 }}>{p.cost} DA</Text>
                {(user?.role === 'repair_agent' || user?.role === 'admin' || user?.permissions?.repair_edit) && (
                  <TouchableOpacity onPress={() => handleRemovePart(idx)}>
                    <MaterialCommunityIcons name="delete" size={24} color="#ef4444" style={{ marginLeft: 12 }} />
                  </TouchableOpacity>
                )}
              </View>
            ))}

            {parts.length > 0 && (
              <View style={styles.partsTotalRow}>
                <Text style={styles.partsTotalLabel}>{t('ticketDetail.totalPartsCost', 'Total Parts Cost')}:</Text>
                <Text style={styles.partsTotalValue}>
                  {parts.reduce((sum, p) => sum + p.cost, 0)} DA
                </Text>
              </View>
            )}

            {parts.length === 0 && (
              <Text style={{ color: '#94a3b8', fontSize: 14, marginTop: 4 }}>{t('ticketDetail.noPartsYet', 'No parts added yet.')}</Text>
            )}
          </Card.Content>
        </Card>
      </ScrollView>

      <View style={styles.actionContainer}>
        {(ticket.status === 'pending' || ticket.status === 'returned') && (user?.role === 'repair_agent' || user?.role === 'admin' || user?.permissions?.repair_status) ? (
          <Button 
            mode="contained" 
            onPress={handleStartRepair} 
            loading={loading}
            disabled={loading}
            style={[styles.actionButton, { backgroundColor: '#3b82f6' }]}
            contentStyle={styles.buttonContent}
            labelStyle={styles.buttonLabel}
            icon="wrench"
          >
            {t('ticketDetail.startRepair', 'Start Repair')}
          </Button>
        ) : null}

        {ticket.status === 'in_progress' && (user?.role === 'repair_agent' || user?.role === 'admin' || user?.permissions?.repair_status) ? (
          <Button 
            mode="contained" 
            onPress={handleMarkAsRepaired} 
            loading={loading}
            disabled={loading}
            style={[styles.actionButton, { backgroundColor: '#10b981' }]}
            contentStyle={styles.buttonContent}
            labelStyle={styles.buttonLabel}
            icon="check-decagram"
          >
            {t('ticketDetail.markRepaired', 'Mark as Repaired')}
          </Button>
        ) : null}
        
        {ticket.status === 'ready' && user?.role === 'repair_agent' && !user?.permissions?.repair_status && (
           <Button 
           mode="contained-tonal" 
           disabled={true}
           style={[styles.actionButton, { backgroundColor: '#e2e8f0' }]}
           contentStyle={styles.buttonContent}
           labelStyle={[styles.buttonLabel, { color: '#64748b' }]}
           icon="check-all"
         >
           {t('ticketDetail.readyForCustomer', 'Ready For Customer')}
         </Button>
        )}

        {ticket.status === 'ready' && (user?.role === 'sales_agent' || user?.role === 'admin' || user?.permissions?.repair_status) && (
           <Button 
           mode="contained"
           onPress={handleMarkAsClaimed} 
           loading={loading}
           disabled={loading}
           style={[styles.actionButton, { backgroundColor: '#059669' }]}
           contentStyle={styles.buttonContent}
           labelStyle={styles.buttonLabel}
           icon="account-cash"
         >
           {t('ticketDetail.markClaimed', 'Mark as Claimed')}
         </Button>
        )}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f8fafc',
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 100,
  },
  headerBlock: {
    marginBottom: 20,
    paddingHorizontal: 8,
  },
  ticketBadgeContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  ticketNumber: {
    fontSize: 16,
    color: '#64748b',
    fontWeight: '700',
    letterSpacing: 1,
  },
  statusBadgeLarge: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
  },
  statusTextLarge: {
    fontSize: 13,
    fontWeight: '800',
    letterSpacing: 0.8,
    color: '#ffffff',
  },
  deviceTitle: {
    fontSize: 28,
    fontWeight: '800',
    color: '#0f172a',
    lineHeight: 34,
  },
  dateText: {
    color: '#94a3b8',
    marginTop: 4,
    fontSize: 14,
    fontWeight: '500',
  },
  card: {
    borderRadius: 16,
    backgroundColor: '#fff',
    elevation: 1,
    shadowColor: '#0f172a',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 8,
    marginBottom: 12,
  },
  divider: {
    marginVertical: 16,
    backgroundColor: '#f1f5f9',
    height: 1,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#64748b',
    marginLeft: 8,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  detailText: {
    fontSize: 18,
    fontWeight: '600',
    color: '#1e293b',
    marginLeft: 28,
  },
  subDetailText: {
    fontSize: 15,
    color: '#64748b',
    marginLeft: 28,
    marginTop: 2,
  },
  issueText: {
    fontSize: 16,
    lineHeight: 24,
    color: '#334155',
    marginLeft: 28,
  },
  lockBox: {
    marginLeft: 28,
    backgroundColor: '#fee2e2',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    alignSelf: 'flex-start',
  },
  lockText: {
    color: '#991b1b',
    fontWeight: '700',
    fontSize: 16,
    letterSpacing: 1,
  },
  quickActionBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
    elevation: 0,
  },
  actionContainer: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    padding: 16,
    paddingBottom: 32, // for iOS safe area
    backgroundColor: '#ffffff',
    borderTopWidth: 1,
    borderTopColor: '#f1f5f9',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 10,
  },
  actionButton: {
    borderRadius: 12,
  },
  buttonContent: {
    paddingVertical: 8,
  },
  buttonLabel: {
    fontSize: 16,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  addPartRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
    marginTop: 8,
  },
  partInput: {
    backgroundColor: '#fff',
  },
  partItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#e2e8f0',
  },
  partsTotalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 2,
    borderTopColor: '#10b981',
  },
  partsTotalLabel: {
    fontSize: 16,
    fontWeight: '700',
    color: '#1e293b',
  },
  partsTotalValue: {
    fontSize: 18,
    fontWeight: '800',
    color: '#10b981',
  }
});
