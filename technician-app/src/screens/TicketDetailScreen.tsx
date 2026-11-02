import React, { useEffect, useMemo, useState } from 'react';
import { View, StyleSheet, ScrollView, Alert, TouchableOpacity, Linking, Modal } from 'react-native';
import { Text, Card, Title, Paragraph, Button, Divider, TextInput, IconButton, Portal, Dialog, useTheme, Chip } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useRepairStore } from '../store/repairStore';
import { useAuthStore } from '../store/authStore';
import { usePosStore } from '../store/posStore';
import { collection, addDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { useTranslation } from 'react-i18next';
import type { RepairTicket } from '../types';

export const TicketDetailScreen = ({ route, navigation }: any) => {
  const { ticket: initialTicket } = route.params;
  const { tickets, updateTicketStatus, settleAndClaimTicket, updateTicketRemark, updateTicketParts } = useRepairStore();
  const { user } = useAuthStore();
  const [loading, setLoading] = useState(false);
  const { t } = useTranslation();
  const theme = useTheme();

  // Find live ticket state from store so edits refresh dynamically
  const ticket: RepairTicket = tickets.find(t => t.id === initialTicket.id) || initialTicket;
  
  // Parts state
  const [parts, setParts] = useState<{ name: string; cost: number; productId?: string; quantity?: number }[]>(ticket.partsUsed || []);
  const [partName, setPartName] = useState('');
  const [partCost, setPartCost] = useState('');
  // The shelf item the typed name resolved to. Stock only moves for a line that
  // carries a real product id; a hand-written part stays unlinked on purpose.
  const [partProductId, setPartProductId] = useState<string | null>(null);

  // Parts are ordinary inventory rows, so the same list the POS sells from feeds
  // the lookup. Repair agents never open the POS screen, hence the lazy fetch.
  const products = usePosStore(s => s.products);
  const fetchProducts = usePosStore(s => s.fetchProducts);
  useEffect(() => {
    if (products.length === 0) void fetchProducts();
  }, [products.length, fetchProducts]);

  const partSuggestions = useMemo(() => {
    const term = partName.trim().toLowerCase();
    if (term.length < 2) return [];
    return products
      .filter(p => (p.category as string) === 'repair_part')
      .filter(p => `${p.name} ${p.brand ?? ''} ${p.model ?? ''}`.toLowerCase().includes(term))
      .slice(0, 6);
  }, [partName, products]);

  // Remark editing state
  const [remarkModalVisible, setRemarkModalVisible] = useState(false);
  const [editedRemark, setEditedRemark] = useState(ticket.remark || '');

  // Handover settlement state
  const [settlementModalVisible, setSettlementModalVisible] = useState(false);
  const [finalPrice, setFinalPrice] = useState(String(ticket.actualCost ?? ticket.estimatedCost ?? 0));
  const [handoverPaid, setHandoverPaid] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<'cash' | 'card' | 'transfer'>('cash');
  const [settlementNotes, setSettlementNotes] = useState('');

  const depositAlreadyPaid = ticket.depositAmount || 0;
  const currentFinalPriceNum = parseFloat(finalPrice) || 0;
  const balanceDue = Math.max(0, currentFinalPriceNum - depositAlreadyPaid);

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'pending': return '#f59e0b';
      case 'in_progress': return '#3b82f6';
      case 'ready': return '#10b981';
      case 'completed': return '#8b5cf6';
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
    const newParts = [...parts, {
      name: partName.trim(),
      cost,
      productId: partProductId || 'custom-mobile-part',
      quantity: 1,
    }];
    setParts(newParts);
    setPartName('');
    setPartCost('');
    setPartProductId(null);
    try {
      await updateTicketParts(ticket.id, newParts);
    } catch (e) {
      console.error('Failed to save parts:', e);
    }
  };

  const handlePickPart = (product: { id: string; name: string; costPrice: number; stock: number }) => {
    setPartName(product.name);
    setPartProductId(product.id);
    // The till price is the shop's own buy price for the part; the technician can
    // still overwrite it (a borrowed or warranty part genuinely costs nothing).
    if (!partCost.trim()) setPartCost(String(product.costPrice ?? 0));
  };

  const handleRemovePart = async (index: number) => {
    const newParts = [...parts];
    newParts.splice(index, 1);
    setParts(newParts);
    try {
      await updateTicketParts(ticket.id, newParts);
    } catch (e) {
      console.error('Failed to save parts:', e);
    }
  };

  const handleSaveRemark = async () => {
    try {
      setLoading(true);
      await updateTicketRemark(ticket.id, editedRemark.trim());
      setRemarkModalVisible(false);
      Alert.alert(t('common.success', 'Success'), t('ticketDetail.remarksSaved', 'Remarks updated successfully.'));
    } catch (error) {
      Alert.alert(t('common.error', 'Error'), t('ticketDetail.remarksSaveFailed', 'Failed to save remarks.'));
    } finally {
      setLoading(false);
    }
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
              // The parts list is already persisted line by line, and going through
              // updateTicketParts is what moves the shelf stock. Re-sending it here
              // with a hard-coded quantity of 1 used to overwrite the real counts.
              const additionalUpdates = {
                repairedAt: new Date().toISOString(),
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

  const openSettlementModal = () => {
    const cost = ticket.actualCost ?? ticket.estimatedCost ?? 0;
    setFinalPrice(String(cost));
    const due = Math.max(0, cost - (ticket.depositAmount || 0));
    setHandoverPaid(String(due));
    setSettlementModalVisible(true);
  };

  const handleConfirmSettlement = async () => {
    const pPrice = parseFloat(finalPrice);
    if (isNaN(pPrice) || pPrice < 0) {
      Alert.alert(t('error.invalidInput', 'Invalid Input'), t('ticketDetail.validPrice', 'Please enter a valid price.'));
      return;
    }
    const pHandoverPaid = parseFloat(handoverPaid) || 0;
    if (pHandoverPaid < 0) {
      Alert.alert(t('error.invalidInput', 'Invalid Input'), t('ticketDetail.negativeAmount', 'Amount paid cannot be negative.'));
      return;
    }

    setLoading(true);
    try {
      await settleAndClaimTicket({
        ticketId: ticket.id,
        finalPrice: pPrice,
        handoverAmountPaid: pHandoverPaid,
        paymentMethod,
        settlementNotes: settlementNotes.trim() || undefined,
        customerPhone: ticket.customerPhone,
        customerName: ticket.customerName,
      });

      setSettlementModalVisible(false);
      Alert.alert(t('common.success', 'Success'), t('ticketDetail.phoneClaimed', 'Phone marked as claimed and payment settled.'));
      navigation.goBack();
    } catch (error) {
      Alert.alert(t('common.error', 'Error'), t('ticketDetail.handoverFailed', 'Failed to settle ticket handover.'));
    } finally {
      setLoading(false);
    }
  };

  const handleCall = () => {
    if (ticket.customerPhone) {
      Linking.openURL(`tel:${ticket.customerPhone}`);
    }
  };

  const handleWhatsApp = () => {
    if (ticket.customerPhone) {
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

  // Parse pattern lock sequence (e.g. "1-2-5-8-9")
  const parsedPatternDots: number[] = React.useMemo(() => {
    if (ticket.lockType !== 'pattern' || !ticket.lockValue) return [];
    const parts = ticket.lockValue.split(/[-,\s]/).map(n => parseInt(n, 10)).filter(n => !isNaN(n) && n >= 1 && n <= 9);
    if (parts.length > 0) return parts;
    return ticket.lockValue.split('').map(n => parseInt(n, 10)).filter(n => !isNaN(n) && n >= 1 && n <= 9);
  }, [ticket.lockType, ticket.lockValue]);

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        {/* Header Block with Status Tint */}
        <View style={[styles.headerBlock, { backgroundColor: getStatusColor(ticket.status) + '0D' }]}>
          <View style={styles.ticketBadgeContainer}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Text style={styles.ticketNumber}>{ticket.ticketNumber}</Text>
              {ticket.trackingPin && (
                <View style={styles.pinPill}>
                  <MaterialCommunityIcons name="shield-key-outline" size={13} color="#4f46e5" />
                  <Text style={styles.pinPillText}>PIN: {ticket.trackingPin}</Text>
                </View>
              )}
            </View>
            <View style={[styles.statusBadgeLarge, { backgroundColor: getStatusColor(ticket.status) }]}>
              <Text style={styles.statusTextLarge}>
                {ticket.status.replace('_', ' ').toUpperCase()}
              </Text>
            </View>
          </View>
          
          <Title style={styles.deviceTitle}>{ticket.deviceBrand} {ticket.deviceModel}</Title>
          
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 6 }}>
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

          {/* Pricing & Deposit summary bar */}
          <View style={styles.priceSummaryBar}>
            <View>
              <Text style={styles.priceSubLabel}>Est / Final</Text>
              <Text style={styles.priceValue}>{ticket.actualCost ?? ticket.estimatedCost ?? 0} DA</Text>
            </View>
            {ticket.depositAmount ? (
              <View style={{ alignItems: 'center' }}>
                <Text style={styles.priceSubLabel}>Deposit</Text>
                <Text style={[styles.priceValue, { color: '#059669' }]}>{ticket.depositAmount} DA</Text>
              </View>
            ) : null}
            {ticket.paymentStatus && (
              <View style={{ alignItems: 'flex-end' }}>
                <Text style={styles.priceSubLabel}>Payment</Text>
                <Text style={[styles.priceValue, { color: ticket.paymentStatus === 'paid' ? '#059669' : '#dc2626' }]}>
                  {ticket.paymentStatus.toUpperCase()}
                </Text>
              </View>
            )}
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
                <View style={{ flexDirection: 'row', gap: 6 }}>
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

        {/* Issue Description Card */}
        <Card style={styles.card}>
          <Card.Content>
            <View style={styles.sectionHeader}>
              <MaterialCommunityIcons name="alert-circle" size={20} color="#f59e0b" />
              <Text style={styles.sectionTitle}>{t('ticketDetail.issueDescription', 'Issue Description')}</Text>
            </View>
            <Paragraph style={styles.issueText}>{ticket.issueDescription}</Paragraph>
          </Card.Content>
        </Card>

        {/* Remarks & Diagnostic Findings Card */}
        <Card style={styles.card}>
          <Card.Content>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <View style={styles.sectionHeader}>
                <MaterialCommunityIcons name="notebook-outline" size={20} color="#7c3aed" />
                <Text style={styles.sectionTitle}>Condition & Technician Findings</Text>
              </View>
              <IconButton 
                icon="pencil" 
                size={18} 
                iconColor="#7c3aed"
                onPress={() => { setEditedRemark(ticket.remark || ''); setRemarkModalVisible(true); }}
              />
            </View>
            {ticket.remark ? (
              <Paragraph style={styles.issueText}>{ticket.remark}</Paragraph>
            ) : (
              <Text style={styles.subDetailText}>No remarks or findings recorded yet.</Text>
            )}
          </Card.Content>
        </Card>

        {/* Lock Code & Pattern Grid Card */}
        <Card style={styles.card}>
          <Card.Content>
            <View style={styles.sectionHeader}>
              <MaterialCommunityIcons name="lock" size={20} color="#ef4444" />
              <Text style={styles.sectionTitle}>{t('ticketDetail.securityCode', 'Security / Lock Code')}</Text>
            </View>
            {ticket.lockType === 'pattern' ? (
              <View style={styles.patternContainer}>
                <Text style={styles.patternSequenceText}>
                  Pattern: {parsedPatternDots.length > 0 ? parsedPatternDots.join(' ➔ ') : (ticket.lockValue || 'Draw pattern')}
                </Text>
                {/* 3x3 Pattern Visualizer */}
                <View style={styles.patternMiniGrid}>
                  {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((dot) => {
                    const isSelected = parsedPatternDots.includes(dot);
                    const order = parsedPatternDots.indexOf(dot) + 1;
                    return (
                      <View key={dot} style={[styles.patternMiniDot, isSelected && styles.patternMiniDotSelected]}>
                        <Text style={[styles.patternMiniText, isSelected && styles.patternMiniTextSelected]}>
                          {isSelected ? order : '•'}
                        </Text>
                      </View>
                    );
                  })}
                </View>
              </View>
            ) : ticket.lockType && ticket.lockType !== 'none' ? (
              <View style={styles.lockBox}>
                <Text style={styles.lockText}>
                  {ticket.lockType === 'password' ? 'Password' : 'PIN'}: {ticket.lockValue}
                </Text>
              </View>
            ) : (
              <Text style={styles.subDetailText}>{t('ticketDetail.noLockCode', 'No lock code provided')}</Text>
            )}
          </Card.Content>
        </Card>

        {/* Parts Section */}
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
                  onChangeText={(v) => { setPartName(v); setPartProductId(null); }}
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

            {partSuggestions.length > 0 && (
              <View style={styles.suggestions}>
                {partSuggestions.map((p) => (
                  <TouchableOpacity
                    key={p.id}
                    style={styles.suggestionRow}
                    onPress={() => handlePickPart(p)}
                  >
                    <MaterialCommunityIcons
                      name={p.stock > 0 ? 'warehouse' : 'alert-circle-outline'}
                      size={16}
                      color={p.stock > 0 ? '#10b981' : '#ef4444'}
                    />
                    <Text style={styles.suggestionName} numberOfLines={1}>{p.name}</Text>
                    <Text style={styles.suggestionStock}>{t('ticketDetail.inStockShort', { n: p.stock })}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            )}

            {partName.trim().length >= 2 && !partProductId && partSuggestions.length === 0 && (
              <Text style={styles.unlinkedHint}>
                {t('ticketDetail.partUnlinked', 'No matching stock item — this part will be recorded but will not move inventory.')}
              </Text>
            )}

            {parts.map((p, idx) => (
              <View key={idx} style={styles.partItem}>
                <Text style={{ flex: 1, fontSize: 15, color: '#1e293b' }}>
                  {p.quantity && p.quantity > 1 ? `${p.name} ×${p.quantity}` : p.name}
                </Text>
                {!p.productId || p.productId === 'custom-mobile-part' ? (
                  <MaterialCommunityIcons name="link-off" size={16} color="#cbd5e1" style={{ marginRight: 6 }} />
                ) : (
                  <MaterialCommunityIcons name="link-variant" size={16} color="#10b981" style={{ marginRight: 6 }} />
                )}
                <Text style={{ fontWeight: 'bold', fontSize: 15, color: '#0f172a' }}>
                  {p.cost * Math.max(1, p.quantity || 1)} DA
                </Text>
                {(user?.role === 'repair_agent' || user?.role === 'admin' || user?.permissions?.repair_edit) && (
                  <TouchableOpacity onPress={() => handleRemovePart(idx)}>
                    <MaterialCommunityIcons name="delete" size={22} color="#ef4444" style={{ marginLeft: 12 }} />
                  </TouchableOpacity>
                )}
              </View>
            ))}

            {parts.length > 0 && (
              <View style={styles.partsTotalRow}>
                <Text style={styles.partsTotalLabel}>{t('ticketDetail.totalPartsCost', 'Total Parts Cost')}:</Text>
                <Text style={styles.partsTotalValue}>
                  {parts.reduce((sum, p) => sum + p.cost * Math.max(1, p.quantity || 1), 0)} DA
                </Text>
              </View>
            )}

            {parts.length === 0 && (
              <Text style={{ color: '#94a3b8', fontSize: 14, marginTop: 4 }}>{t('ticketDetail.noPartsYet', 'No parts added yet.')}</Text>
            )}
          </Card.Content>
        </Card>
      </ScrollView>

      {/* Action Buttons Bar at bottom */}
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
            onPress={openSettlementModal} 
            loading={loading}
            disabled={loading}
            style={[styles.actionButton, { backgroundColor: '#059669' }]}
            contentStyle={styles.buttonContent}
            labelStyle={styles.buttonLabel}
            icon="account-cash"
          >
            {t('ticketDetail.markClaimed', 'Handover & Settle')}
          </Button>
        )}
      </View>

      {/* Edit Remark Modal */}
      <Modal
        visible={remarkModalVisible}
        transparent={true}
        animationType="slide"
        onRequestClose={() => setRemarkModalVisible(false)}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Title style={styles.modalTitle}>Edit Findings & Remarks</Title>
            <TextInput
              label="Technician Findings / Remarks"
              value={editedRemark}
              onChangeText={setEditedRemark}
              mode="outlined"
              multiline
              numberOfLines={4}
              style={{ marginTop: 12, backgroundColor: '#fff' }}
              placeholder="Enter diagnostic details, findings, or physical condition..."
            />
            <View style={styles.modalActions}>
              <Button mode="text" onPress={() => setRemarkModalVisible(false)} textColor="#64748b">
                Cancel
              </Button>
              <Button mode="contained" onPress={handleSaveRemark} loading={loading} style={{ backgroundColor: '#7c3aed' }}>
                Save Remark
              </Button>
            </View>
          </View>
        </View>
      </Modal>

      {/* Handover Settlement Modal */}
      <Modal
        visible={settlementModalVisible}
        transparent={true}
        animationType="slide"
        onRequestClose={() => setSettlementModalVisible(false)}
      >
        <View style={styles.modalBackdrop}>
          <ScrollView contentContainerStyle={{ flexGrow: 1, justifyContent: 'center' }}>
            <View style={styles.modalCard}>
              <Title style={[styles.modalTitle, { color: '#059669' }]}>Handover & Settle Payment</Title>
              <Text style={{ fontSize: 13, color: '#64748b', marginBottom: 12 }}>
                Device: {ticket.deviceBrand} {ticket.deviceModel} (#{ticket.ticketNumber})
              </Text>

              {/* Price inputs */}
              <TextInput
                label="Final Repair Price (DA)"
                value={finalPrice}
                onChangeText={(val) => {
                  setFinalPrice(val);
                  const p = parseFloat(val) || 0;
                  setHandoverPaid(String(Math.max(0, p - depositAlreadyPaid)));
                }}
                keyboardType="numeric"
                mode="outlined"
                style={{ backgroundColor: '#fff', marginBottom: 8 }}
              />

              {depositAlreadyPaid > 0 && (
                <View style={styles.depositRow}>
                  <Text style={{ color: '#059669', fontWeight: '600', fontSize: 13 }}>
                    Deposit already collected at intake:
                  </Text>
                  <Text style={{ color: '#059669', fontWeight: '700', fontSize: 14 }}>
                    {depositAlreadyPaid} DA
                  </Text>
                </View>
              )}

              <View style={styles.balanceDueRow}>
                <Text style={{ fontSize: 14, fontWeight: '700', color: '#0f172a' }}>
                  Remaining Balance Due:
                </Text>
                <Text style={{ fontSize: 16, fontWeight: '800', color: '#4f46e5' }}>
                  {balanceDue} DA
                </Text>
              </View>

              <TextInput
                label="Amount Paid at Handover (DA)"
                value={handoverPaid}
                onChangeText={setHandoverPaid}
                keyboardType="numeric"
                mode="outlined"
                style={{ backgroundColor: '#fff', marginBottom: 8 }}
              />

              {/* Quick Amount Buttons */}
              <View style={{ flexDirection: 'row', gap: 8, marginBottom: 12 }}>
                <Button 
                  mode="outlined" 
                  compact 
                  onPress={() => setHandoverPaid(String(balanceDue))}
                  style={{ flex: 1 }}
                >
                  Pay in Full
                </Button>
                <Button 
                  mode="outlined" 
                  compact 
                  textColor="#dc2626"
                  onPress={() => setHandoverPaid('0')}
                  style={{ flex: 1 }}
                >
                  Credit Debt
                </Button>
              </View>

              {/* Remaining Debt notice */}
              {(() => {
                const paidNow = parseFloat(handoverPaid) || 0;
                const remDebt = Math.max(0, balanceDue - paidNow);
                if (remDebt > 0) {
                  return (
                    <View style={styles.debtNoticeBox}>
                      <MaterialCommunityIcons name="alert" size={16} color="#dc2626" />
                      <Text style={styles.debtNoticeText}>
                        Will record {remDebt} DA unpaid debt on customer profile.
                      </Text>
                    </View>
                  );
                }
                return (
                  <View style={[styles.debtNoticeBox, { backgroundColor: '#ecfdf5', borderColor: '#a7f3d0' }]}>
                    <MaterialCommunityIcons name="check-circle" size={16} color="#059669" />
                    <Text style={[styles.debtNoticeText, { color: '#065f46' }]}>
                      Fully settled. No debt remaining.
                    </Text>
                  </View>
                );
              })()}

              <TextInput
                label="Settlement Notes (Optional)"
                value={settlementNotes}
                onChangeText={setSettlementNotes}
                placeholder="e.g. Paid cash at counter"
                mode="outlined"
                style={{ backgroundColor: '#fff', marginTop: 8 }}
              />

              <View style={styles.modalActions}>
                <Button mode="text" onPress={() => setSettlementModalVisible(false)} textColor="#64748b">
                  Cancel
                </Button>
                <Button 
                  mode="contained" 
                  onPress={handleConfirmSettlement} 
                  loading={loading}
                  style={{ backgroundColor: '#059669' }}
                >
                  Complete Handover
                </Button>
              </View>
            </View>
          </ScrollView>
        </View>
      </Modal>
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
    paddingBottom: 110,
  },
  headerBlock: {
    padding: 16,
    borderRadius: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  ticketBadgeContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  ticketNumber: {
    fontSize: 20,
    fontWeight: '800',
    color: '#0f172a',
  },
  pinPill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#e0e7ff',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 12,
    gap: 4,
  },
  pinPillText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#4338ca',
  },
  statusBadgeLarge: {
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 12,
  },
  statusTextLarge: {
    color: '#fff',
    fontWeight: '800',
    fontSize: 12,
    letterSpacing: 0.5,
  },
  deviceTitle: {
    fontSize: 22,
    fontWeight: '700',
    color: '#0f172a',
  },
  dateText: {
    color: '#64748b',
    fontSize: 13,
  },
  priceSummaryBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    backgroundColor: '#ffffff',
    padding: 12,
    borderRadius: 12,
    marginTop: 12,
    borderWidth: 1,
    borderColor: '#f1f5f9',
  },
  priceSubLabel: {
    fontSize: 11,
    color: '#94a3b8',
    textTransform: 'uppercase',
    fontWeight: '700',
  },
  priceValue: {
    fontSize: 16,
    fontWeight: '800',
    color: '#0f172a',
    marginTop: 2,
  },
  card: {
    marginBottom: 14,
    backgroundColor: '#ffffff',
    borderRadius: 14,
    elevation: 1,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 3,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 8,
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#334155',
  },
  detailText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#0f172a',
  },
  subDetailText: {
    fontSize: 14,
    color: '#64748b',
    marginTop: 2,
  },
  quickActionBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
  },
  issueText: {
    fontSize: 15,
    color: '#334155',
    lineHeight: 22,
  },
  lockBox: {
    backgroundColor: '#fef2f2',
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#fecaca',
  },
  lockText: {
    color: '#b91c1c',
    fontWeight: '700',
    fontSize: 16,
  },
  patternContainer: {
    backgroundColor: '#f8fafc',
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    alignItems: 'center',
  },
  patternSequenceText: {
    color: '#4f46e5',
    fontWeight: '700',
    fontSize: 15,
    marginBottom: 8,
  },
  patternMiniGrid: {
    width: 120,
    height: 120,
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    alignContent: 'space-between',
  },
  patternMiniDot: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#e2e8f0',
    justifyContent: 'center',
    alignItems: 'center',
  },
  patternMiniDotSelected: {
    backgroundColor: '#4f46e5',
  },
  patternMiniText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#94a3b8',
  },
  patternMiniTextSelected: {
    color: '#ffffff',
  },
  addPartRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  partInput: {
    backgroundColor: '#fff',
  },
  suggestions: {
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 10,
    backgroundColor: '#f8fafc',
    marginBottom: 10,
    overflow: 'hidden',
  },
  suggestionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#e2e8f0',
  },
  suggestionName: {
    flex: 1,
    fontSize: 13,
    color: '#0f172a',
    fontWeight: '600',
  },
  suggestionStock: {
    fontSize: 12,
    color: '#64748b',
  },
  unlinkedHint: {
    fontSize: 12,
    color: '#b45309',
    marginBottom: 10,
  },
  partItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9',
  },
  partsTotalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingTop: 12,
    marginTop: 6,
  },
  partsTotalLabel: {
    fontSize: 14,
    fontWeight: '700',
    color: '#64748b',
  },
  partsTotalValue: {
    fontSize: 16,
    fontWeight: '800',
    color: '#0f172a',
  },
  actionContainer: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: '#ffffff',
    padding: 16,
    borderTopWidth: 1,
    borderTopColor: '#e2e8f0',
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
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.6)',
    justifyContent: 'center',
    padding: 16,
  },
  modalCard: {
    backgroundColor: '#ffffff',
    borderRadius: 16,
    padding: 20,
    elevation: 5,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: '#0f172a',
  },
  depositRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    backgroundColor: '#ecfdf5',
    padding: 8,
    borderRadius: 8,
    marginBottom: 8,
  },
  balanceDueRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    backgroundColor: '#f8fafc',
    padding: 10,
    borderRadius: 8,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  debtNoticeBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#fef2f2',
    padding: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#fecaca',
    marginBottom: 8,
  },
  debtNoticeText: {
    fontSize: 13,
    color: '#991b1b',
    fontWeight: '600',
    flex: 1,
  },
  modalActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 12,
    marginTop: 18,
  }
});
