import React, { useEffect, useMemo, useState } from 'react';
import { View, StyleSheet, ScrollView, Alert, TouchableOpacity, Linking, Modal } from 'react-native';
import { Text, Card, Title, Paragraph, Button, TextInput, IconButton } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useRepairStore } from '../store/repairStore';
import { useAuthStore } from '../store/authStore';
import { usePosStore } from '../store/posStore';
import { usePermissions } from '../hooks/usePermissions';
import { collection, addDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { useTranslation } from 'react-i18next';
import { buildSearch, matchesSearch, normalizePhone } from '../utils/search';
import { colors, fontSize, radius, ramp, repairStatusColors, spacing, statusAppearance } from '../theme/tokens';
import type { RepairTicket } from '../types';

export const TicketDetailScreen = ({ route, navigation }: any) => {
  const { ticket: initialTicket } = route.params;
  const { tickets, updateTicketStatus, settleAndClaimTicket, updateTicketRemark, updateTicketParts } = useRepairStore();
  const { user } = useAuthStore();
  const [loading, setLoading] = useState(false);
  const { t } = useTranslation();
  const can = usePermissions();

  // Handover is the money path, so the counter and the admin own it. `can.repair_status`
  // is true for every technician by preset — that key covers moving a ticket between
  // statuses, not collecting the balance — so settling needs the stored grant only.
  const canSettle =
    user?.role === 'admin' || user?.role === 'sales_agent' || user?.permissions?.repair_status === true;

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

  // One normalized index per product-list change; typing only re-filters it.
  const partIndex = useMemo(
    () =>
      products
        .filter(p => p.category === 'repair_part')
        .map(p => ({ product: p, search: buildSearch(p.name, p.brand, p.model) })),
    [products]
  );

  const partSuggestions = useMemo(() => {
    if (partName.trim().length < 2) return [];
    return partIndex
      .filter(({ search }) => matchesSearch(search, partName))
      .slice(0, 6)
      .map(({ product }) => product);
  }, [partIndex, partName]);

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
      const phone = normalizePhone(ticket.customerPhone);
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

  const status = statusAppearance(repairStatusColors, ticket.status);

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        {/* Header Block with Status Tint */}
        <View style={[styles.headerBlock, { backgroundColor: status.tint }]}>
          <View style={styles.ticketBadgeContainer}>
            <View style={styles.ticketBadgeRow}>
              <Text style={styles.ticketNumber}>{ticket.ticketNumber}</Text>
              {ticket.trackingPin && (
                <View style={styles.pinPill}>
                  <MaterialCommunityIcons name="shield-key-outline" size={13} color={colors.brand} />
                  <Text style={styles.pinPillText}>
                    {t('ticketDetail.trackingPin', 'PIN: {{pin}}', { pin: ticket.trackingPin })}
                  </Text>
                </View>
              )}
            </View>
            <View style={[styles.statusBadgeLarge, { backgroundColor: status.ink }]}>
              <Text style={styles.statusTextLarge}>
                {ticket.status.replace('_', ' ').toUpperCase()}
              </Text>
            </View>
          </View>
          
          <Title style={styles.deviceTitle}>{ticket.deviceBrand} {ticket.deviceModel}</Title>
          
          <View style={styles.dateRow}>
            <Text style={styles.dateText}>
              {t('ticketDetail.receivedOn', 'Received on')} {new Date(ticket.createdAt).toLocaleDateString()}
            </Text>
            <Button
              mode="contained-tonal"
              icon="printer"
              onPress={handlePrintRemote}
              buttonColor={colors.brandSoftStrong}
              textColor={colors.brand}
              compact
            >
              {t('ticketDetail.printSticker', 'Print Sticker')}
            </Button>
          </View>

          {/* Pricing & Deposit summary bar */}
          <View style={styles.priceSummaryBar}>
            <View>
              <Text style={styles.priceSubLabel}>{t('ticketDetail.estFinal', 'Est / Final')}</Text>
              <Text style={styles.priceValue}>{ticket.actualCost ?? ticket.estimatedCost ?? 0} DA</Text>
            </View>
            {ticket.depositAmount ? (
              <View style={styles.priceCenter}>
                <Text style={styles.priceSubLabel}>{t('ticketDetail.deposit', 'Deposit')}</Text>
                <Text style={[styles.priceValue, { color: ramp.green700 }]}>{ticket.depositAmount} DA</Text>
              </View>
            ) : null}
            {ticket.paymentStatus && (
              <View style={styles.priceEnd}>
                <Text style={styles.priceSubLabel}>{t('ticketDetail.payment', 'Payment')}</Text>
                <Text style={[styles.priceValue, { color: ticket.paymentStatus === 'paid' ? ramp.green700 : colors.danger }]}>
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
              <MaterialCommunityIcons name="account" size={20} color={colors.brand} />
              <Text style={styles.sectionTitle}>{t('ticketDetail.customerDetails', 'Customer Details')}</Text>
            </View>
            <View style={styles.customerRow}>
              <View style={styles.customerTextBlock}>
                <Text style={styles.detailText}>{ticket.customerName}</Text>
                {ticket.customerPhone ? <Text style={styles.subDetailText}>{ticket.customerPhone}</Text> : null}
              </View>
              {ticket.customerPhone && (
                <View style={styles.quickActionRow}>
                  <TouchableOpacity style={[styles.quickActionBtn, styles.callBtn]} onPress={handleCall}>
                    <MaterialCommunityIcons name="phone" size={20} color={ramp.blue600} />
                  </TouchableOpacity>
                  <TouchableOpacity style={[styles.quickActionBtn, styles.whatsappBtn]} onPress={handleWhatsApp}>
                    <MaterialCommunityIcons name="whatsapp" size={20} color={colors.success} />
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
              <MaterialCommunityIcons name="alert-circle" size={20} color={colors.warning} />
              <Text style={styles.sectionTitle}>{t('ticketDetail.issueDescription', 'Issue Description')}</Text>
            </View>
            <Paragraph style={styles.issueText}>{ticket.issueDescription}</Paragraph>
          </Card.Content>
        </Card>

        {/* Remarks & Diagnostic Findings Card */}
        <Card style={styles.card}>
          <Card.Content>
            <View style={styles.findingsHeaderRow}>
              <View style={styles.sectionHeader}>
                <MaterialCommunityIcons name="notebook-outline" size={20} color={colors.violet} />
                <Text style={styles.sectionTitle}>{t('ticketDetail.findings', 'Condition & Technician Findings')}</Text>
              </View>
              <IconButton
                icon="pencil"
                size={18}
                iconColor={colors.violet}
                onPress={() => { setEditedRemark(ticket.remark || ''); setRemarkModalVisible(true); }}
              />
            </View>
            {ticket.remark ? (
              <Paragraph style={styles.issueText}>{ticket.remark}</Paragraph>
            ) : (
              <Text style={styles.subDetailText}>{t('ticketDetail.noFindings', 'No remarks or findings recorded yet.')}</Text>
            )}
          </Card.Content>
        </Card>

        {/* Lock Code & Pattern Grid Card */}
        <Card style={styles.card}>
          <Card.Content>
            <View style={styles.sectionHeader}>
              <MaterialCommunityIcons name="lock" size={20} color={colors.danger} />
              <Text style={styles.sectionTitle}>{t('ticketDetail.securityCode', 'Security / Lock Code')}</Text>
            </View>
            {ticket.lockType === 'pattern' ? (
              <View style={styles.patternContainer}>
                <Text style={styles.patternSequenceText}>
                  {t(
                    'ticketDetail.patternPrefix',
                    'Pattern: {{sequence}}',
                    {
                      sequence:
                        parsedPatternDots.length > 0
                          ? parsedPatternDots.join(', ')
                          : ticket.lockValue || t('ticketDetail.drawPattern', 'Draw pattern'),
                    }
                  )}
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
                  {t(
                    'ticketDetail.lockValueLabel',
                    '{{label}}: {{value}}',
                    {
                      label:
                        ticket.lockType === 'password'
                          ? t('ticketDetail.password', 'Password')
                          : t('ticketDetail.pin', 'PIN'),
                      value: ticket.lockValue,
                    }
                  )}
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
              <MaterialCommunityIcons name="cog" size={20} color={colors.success} />
              <Text style={styles.sectionTitle}>{t('ticketDetail.partsUsed', 'Parts Used & Cost')}</Text>
            </View>
            
            {can.repair_edit && (
              <View style={styles.addPartRow}>
                <TextInput
                  label={t('ticketDetail.partName', 'Part Name')}
                  value={partName}
                  onChangeText={(v) => { setPartName(v); setPartProductId(null); }}
                  mode="outlined"
                  style={styles.partNameInput}
                  dense
                />
                <TextInput
                  label={t('ticketDetail.buyPrice', 'Buy Price')}
                  value={partCost}
                  onChangeText={setPartCost}
                  mode="outlined"
                  keyboardType="numeric"
                  style={styles.partCostInput}
                  dense
                />
                <IconButton
                  icon="plus"
                  mode="contained"
                  containerColor={colors.success}
                  iconColor={colors.onBrand}
                  size={24}
                  style={styles.partAddBtn}
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
                      color={p.stock > 0 ? colors.success : colors.danger}
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
                <Text style={styles.partName} numberOfLines={1}>
                  {p.quantity && p.quantity > 1 ? `${p.name} ×${p.quantity}` : p.name}
                </Text>
                <MaterialCommunityIcons
                  name={!p.productId || p.productId === 'custom-mobile-part' ? 'link-off' : 'link-variant'}
                  size={16}
                  color={
                    !p.productId || p.productId === 'custom-mobile-part'
                      ? colors.borderStrong
                      : colors.success
                  }
                  style={styles.partLinkIcon}
                />
                <Text style={styles.partCost}>{p.cost * Math.max(1, p.quantity || 1)} DA</Text>
                {can.repair_edit && (
                  <TouchableOpacity onPress={() => handleRemovePart(idx)}>
                    <MaterialCommunityIcons name="delete" size={22} color={colors.danger} style={styles.partDeleteBtn} />
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
              <Text style={styles.noPartsText}>{t('ticketDetail.noPartsYet', 'No parts added yet.')}</Text>
            )}
          </Card.Content>
        </Card>
      </ScrollView>

      {/* Action Buttons Bar at bottom */}
      <View style={styles.actionContainer}>
        {(ticket.status === 'pending' || ticket.status === 'returned') && can.repair_status && (
          <Button
            mode="contained"
            onPress={handleStartRepair}
            loading={loading}
            disabled={loading}
            style={[styles.actionButton, { backgroundColor: repairStatusColors.in_progress.ink }]}
            contentStyle={styles.buttonContent}
            labelStyle={styles.buttonLabel}
            icon="wrench"
          >
            {t('ticketDetail.startRepair', 'Start Repair')}
          </Button>
        )}

        {ticket.status === 'in_progress' && can.repair_status && (
          <Button
            mode="contained"
            onPress={handleMarkAsRepaired}
            loading={loading}
            disabled={loading}
            style={[styles.actionButton, { backgroundColor: repairStatusColors.ready.ink }]}
            contentStyle={styles.buttonContent}
            labelStyle={styles.buttonLabel}
            icon="check-decagram"
          >
            {t('ticketDetail.markRepaired', 'Mark as Repaired')}
          </Button>
        )}

        {ticket.status === 'ready' && !canSettle && (
          <Button
            mode="contained-tonal"
            disabled
            style={[styles.actionButton, styles.actionButtonDisabled]}
            contentStyle={styles.buttonContent}
            labelStyle={[styles.buttonLabel, styles.buttonLabelDisabled]}
            icon="check-all"
          >
            {t('ticketDetail.readyForCustomer', 'Ready For Customer')}
          </Button>
        )}

        {ticket.status === 'ready' && canSettle && (
          <Button
            mode="contained"
            onPress={openSettlementModal}
            loading={loading}
            disabled={loading}
            style={[styles.actionButton, { backgroundColor: ramp.green700 }]}
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
            <Title style={styles.modalTitle}>{t('ticketDetail.remarksTitle', 'Edit Findings & Remarks')}</Title>
            <TextInput
              label={t('ticketDetail.remarksLabel', 'Technician Findings / Remarks')}
              value={editedRemark}
              onChangeText={setEditedRemark}
              mode="outlined"
              multiline
              numberOfLines={4}
              style={styles.modalField}
              placeholder={t('ticketDetail.remarksPlaceholder', 'Enter diagnostic details, findings, or physical condition...')}
            />
            <View style={styles.modalActions}>
              <Button mode="text" onPress={() => setRemarkModalVisible(false)} textColor={colors.textMuted}>
                {t('common.cancel', 'Cancel')}
              </Button>
              <Button
                mode="contained"
                onPress={handleSaveRemark}
                loading={loading}
                buttonColor={colors.violet}
                textColor={colors.onBrand}
              >
                {t('ticketDetail.saveRemark', 'Save Remark')}
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
          <ScrollView contentContainerStyle={styles.settleScroll} keyboardShouldPersistTaps="handled">
            <View style={styles.modalCard}>
              <Title style={[styles.modalTitle, styles.settleTitle]}>
                {t('ticketDetail.settleTitle', 'Handover & Settle Payment')}
              </Title>
              <Text style={styles.settleSub}>
                {t(
                  'ticketDetail.settleDevice',
                  'Device: {{brand}} {{model}} (#{{number}})',
                  { brand: ticket.deviceBrand, model: ticket.deviceModel, number: ticket.ticketNumber }
                )}
              </Text>

              {/* Price inputs */}
              <TextInput
                label={t('ticketDetail.finalPrice', 'Final Repair Price (DA)')}
                value={finalPrice}
                onChangeText={(val) => {
                  setFinalPrice(val);
                  const p = parseFloat(val) || 0;
                  setHandoverPaid(String(Math.max(0, p - depositAlreadyPaid)));
                }}
                keyboardType="numeric"
                mode="outlined"
                style={styles.modalFieldSm}
              />

              {depositAlreadyPaid > 0 && (
                <View style={styles.depositRow}>
                  <Text style={styles.depositLabel}>{t('ticketDetail.depositCollected', 'Deposit already collected at intake:')}</Text>
                  <Text style={styles.depositValue}>{depositAlreadyPaid} DA</Text>
                </View>
              )}

              <View style={styles.balanceDueRow}>
                <Text style={styles.balanceDueLabel}>{t('ticketDetail.balanceDue', 'Remaining Balance Due:')}</Text>
                <Text style={styles.balanceDueValue}>{balanceDue} DA</Text>
              </View>

              <TextInput
                label={t('ticketDetail.amountPaid', 'Amount Paid at Handover (DA)')}
                value={handoverPaid}
                onChangeText={setHandoverPaid}
                keyboardType="numeric"
                mode="outlined"
                style={styles.modalFieldSm}
              />

              {/* Quick Amount Buttons */}
              <View style={styles.settleActionsRow}>
                <Button
                  mode="outlined"
                  compact
                  onPress={() => setHandoverPaid(String(balanceDue))}
                  style={styles.settleAction}
                >
                  {t('ticketDetail.payInFull', 'Pay in Full')}
                </Button>
                <Button
                  mode="outlined"
                  compact
                  textColor={colors.danger}
                  onPress={() => setHandoverPaid('0')}
                  style={styles.settleAction}
                >
                  {t('ticketDetail.creditDebt', 'Credit Debt')}
                </Button>
              </View>

              {/* Remaining Debt notice */}
              {(() => {
                const paidNow = parseFloat(handoverPaid) || 0;
                const remDebt = Math.max(0, balanceDue - paidNow);
                if (remDebt > 0) {
                  return (
                    <View style={styles.debtNoticeBox}>
                      <MaterialCommunityIcons name="alert" size={16} color={colors.danger} />
                      <Text style={styles.debtNoticeText}>
                        {t(
                          'ticketDetail.debtWarning',
                          'Will record {{amount}} DA unpaid debt on customer profile.',
                          { amount: remDebt }
                        )}
                      </Text>
                    </View>
                  );
                }
                return (
                  <View style={[styles.debtNoticeBox, styles.settledNoticeBox]}>
                    <MaterialCommunityIcons name="check-circle" size={16} color={ramp.green700} />
                    <Text style={[styles.debtNoticeText, styles.settledNoticeText]}>
                      {t('ticketDetail.fullySettled', 'Fully settled. No debt remaining.')}
                    </Text>
                  </View>
                );
              })()}

              <TextInput
                label={t('ticketDetail.notesLabel', 'Settlement Notes (Optional)')}
                value={settlementNotes}
                onChangeText={setSettlementNotes}
                placeholder={t('ticketDetail.notesPlaceholder', 'e.g. Paid cash at counter')}
                mode="outlined"
                style={styles.modalFieldTop}
              />

              <View style={styles.modalActions}>
                <Button mode="text" onPress={() => setSettlementModalVisible(false)} textColor={colors.textMuted}>
                  {t('common.cancel', 'Cancel')}
                </Button>
                <Button
                  mode="contained"
                  onPress={handleConfirmSettlement}
                  loading={loading}
                  buttonColor={ramp.green700}
                  textColor={colors.onBrand}
                >
                  {t('ticketDetail.completeHandover', 'Complete Handover')}
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
    backgroundColor: colors.background,
  },
  scrollContent: {
    padding: spacing.lg,
    paddingBottom: 110,
  },
  headerBlock: {
    padding: spacing.lg,
    borderRadius: radius.xl,
    marginBottom: spacing.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  ticketBadgeContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  ticketBadgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  ticketNumber: {
    fontSize: fontSize.title,
    fontWeight: '800',
    color: colors.textPrimary,
  },
  pinPill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.brandSoftStrong,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    borderRadius: radius.pill,
    gap: spacing.xs,
  },
  pinPillText: {
    fontSize: fontSize.caption,
    fontWeight: '700',
    color: colors.brandPressed,
  },
  statusBadgeLarge: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radius.pill,
  },
  statusTextLarge: {
    color: colors.textInverse,
    fontWeight: '800',
    fontSize: fontSize.label,
    letterSpacing: 0.5,
  },
  deviceTitle: {
    fontSize: fontSize.headline,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  dateRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: spacing.xs,
  },
  dateText: {
    color: colors.textMuted,
    fontSize: fontSize.body,
  },
  priceSummaryBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    backgroundColor: colors.surface,
    padding: spacing.md,
    borderRadius: radius.lg,
    marginTop: spacing.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  priceCenter: {
    alignItems: 'center',
  },
  priceEnd: {
    alignItems: 'flex-end',
  },
  priceSubLabel: {
    fontSize: fontSize.caption,
    color: colors.textFaint,
    textTransform: 'uppercase',
    fontWeight: '700',
  },
  priceValue: {
    fontSize: fontSize.subtitle,
    fontWeight: '800',
    color: colors.textPrimary,
    marginTop: spacing.xxs,
  },
  card: {
    marginBottom: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  findingsHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  sectionTitle: {
    fontSize: fontSize.body,
    fontWeight: '700',
    color: colors.textSecondary,
  },
  customerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: spacing.md,
  },
  customerTextBlock: {
    flex: 1,
  },
  detailText: {
    fontSize: fontSize.subtitle,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  subDetailText: {
    fontSize: fontSize.bodyStrong,
    color: colors.textMuted,
    marginTop: spacing.xxs,
  },
  quickActionRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  quickActionBtn: {
    width: 40,
    height: 40,
    borderRadius: radius.pill,
    justifyContent: 'center',
    alignItems: 'center',
  },
  callBtn: {
    backgroundColor: ramp.indigo50,
  },
  whatsappBtn: {
    backgroundColor: colors.successSoft,
  },
  issueText: {
    fontSize: fontSize.bodyStrong,
    color: colors.textSecondary,
    lineHeight: 22,
  },
  lockBox: {
    backgroundColor: colors.dangerSoft,
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: ramp.red200,
  },
  lockText: {
    color: ramp.red900,
    fontWeight: '700',
    fontSize: fontSize.subtitle,
  },
  patternContainer: {
    backgroundColor: colors.background,
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    alignItems: 'center',
  },
  patternSequenceText: {
    color: colors.brand,
    fontWeight: '700',
    fontSize: fontSize.bodyStrong,
    marginBottom: spacing.sm,
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
    borderRadius: radius.pill,
    backgroundColor: colors.border,
    justifyContent: 'center',
    alignItems: 'center',
  },
  patternMiniDotSelected: {
    backgroundColor: colors.brand,
  },
  patternMiniText: {
    fontSize: fontSize.label,
    fontWeight: '700',
    color: colors.textFaint,
  },
  patternMiniTextSelected: {
    color: colors.textInverse,
  },
  addPartRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  partNameInput: {
    flex: 2,
    backgroundColor: colors.surface,
  },
  partCostInput: {
    flex: 1,
    marginStart: spacing.sm,
    backgroundColor: colors.surface,
  },
  partAddBtn: {
    marginTop: 6,
  },
  suggestions: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    borderRadius: radius.md,
    backgroundColor: colors.background,
    marginBottom: spacing.sm,
    overflow: 'hidden',
  },
  suggestionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: 9,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  suggestionName: {
    flex: 1,
    fontSize: fontSize.body,
    color: colors.textPrimary,
    fontWeight: '600',
  },
  suggestionStock: {
    fontSize: fontSize.label,
    color: colors.textMuted,
  },
  unlinkedHint: {
    fontSize: fontSize.label,
    color: colors.warningText,
    marginBottom: spacing.sm,
  },
  partItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.surfaceMuted,
  },
  partName: {
    flex: 1,
    fontSize: fontSize.bodyStrong,
    color: ramp.slate800,
  },
  partLinkIcon: {
    marginEnd: spacing.xs,
  },
  partCost: {
    fontWeight: '700',
    fontSize: fontSize.bodyStrong,
    color: colors.textPrimary,
  },
  partDeleteBtn: {
    marginStart: spacing.md,
  },
  partsTotalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingTop: spacing.md,
    marginTop: spacing.xs,
  },
  partsTotalLabel: {
    fontSize: fontSize.bodyStrong,
    fontWeight: '700',
    color: colors.textMuted,
  },
  partsTotalValue: {
    fontSize: fontSize.subtitle,
    fontWeight: '800',
    color: colors.textPrimary,
  },
  noPartsText: {
    color: colors.textFaint,
    fontSize: fontSize.bodyStrong,
    marginTop: spacing.xs,
  },
  actionContainer: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: colors.surface,
    padding: spacing.lg,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  actionButton: {
    borderRadius: radius.lg,
  },
  actionButtonDisabled: {
    backgroundColor: colors.surfaceMuted,
  },
  buttonContent: {
    paddingVertical: spacing.sm,
  },
  buttonLabel: {
    fontSize: fontSize.subtitle,
    fontWeight: '700',
  },
  buttonLabelDisabled: {
    color: colors.textMuted,
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: colors.backdrop,
    justifyContent: 'center',
    padding: spacing.lg,
  },
  settleScroll: {
    flexGrow: 1,
    justifyContent: 'center',
  },
  modalCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    padding: spacing.xl,
  },
  modalTitle: {
    fontSize: fontSize.title,
    fontWeight: '800',
    color: colors.textPrimary,
  },
  settleTitle: {
    color: ramp.green700,
  },
  settleSub: {
    fontSize: fontSize.body,
    color: colors.textMuted,
    marginTop: spacing.xs,
    marginBottom: spacing.md,
  },
  modalField: {
    marginTop: spacing.md,
    minHeight: 120,
    backgroundColor: colors.surface,
  },
  modalFieldSm: {
    marginBottom: spacing.sm,
    backgroundColor: colors.surface,
  },
  modalFieldTop: {
    marginTop: spacing.sm,
    backgroundColor: colors.surface,
  },
  depositRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: ramp.green50,
    padding: spacing.sm,
    borderRadius: radius.sm,
    marginBottom: spacing.sm,
    gap: spacing.sm,
  },
  depositLabel: {
    color: ramp.green700,
    fontWeight: '600',
    fontSize: fontSize.body,
    flex: 1,
  },
  depositValue: {
    color: ramp.green700,
    fontWeight: '800',
    fontSize: fontSize.bodyStrong,
  },
  balanceDueRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: colors.background,
    padding: 10,
    borderRadius: radius.sm,
    marginBottom: spacing.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    gap: spacing.sm,
  },
  balanceDueLabel: {
    fontSize: fontSize.bodyStrong,
    fontWeight: '700',
    color: colors.textPrimary,
    flex: 1,
  },
  balanceDueValue: {
    fontSize: fontSize.title,
    fontWeight: '800',
    color: colors.brand,
  },
  settleActionsRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  settleAction: {
    flex: 1,
  },
  debtNoticeBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.dangerSoft,
    padding: 10,
    borderRadius: radius.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: ramp.red200,
    marginBottom: spacing.sm,
  },
  debtNoticeText: {
    fontSize: fontSize.body,
    color: colors.dangerText,
    fontWeight: '600',
    flex: 1,
  },
  settledNoticeBox: {
    backgroundColor: ramp.green50,
    borderColor: ramp.green100,
  },
  settledNoticeText: {
    color: ramp.green700,
  },
  modalActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: spacing.md,
    marginTop: 18,
  },
});
