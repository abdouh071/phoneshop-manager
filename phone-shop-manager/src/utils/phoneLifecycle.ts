import type { RepairTicket, CustomerDebtEntry } from '../types';

export interface PhoneLifecycleStage {
  stage: 'intake' | 'repaired' | 'handover' | 'returned' | 're_repaired' | 're_handover';
  title: string;
  badge: string;
  timestamp: string;
  actorOrTechnician?: string;
  summary: string;
  issueOrReason?: string;
  financialInfo?: {
    cost?: number;
    deposit?: number;
    paidNow?: number;
    totalPaid?: number;
    remainingDebt?: number;
    isDebt?: boolean;
  };
  partsUsed?: { name: string; quantity: number; cost: number }[];
  ticketId?: string;
  ticketNumber?: string;
  isWarranty?: boolean;
}

export interface PhoneFinancialLedger {
  initialEstimatedCost: number;
  initialDeposit: number;
  firstActualCost: number;
  firstHandoverPaid: number;
  firstTotalPaid: number;
  firstRemainingDebt: number;

  returnAdditionalCost: number;
  secondHandoverPaid: number;

  totalBilledCost: number;
  totalCollected: number;
  netRemainingDebt: number;
  isFullySettled: boolean;
}

export interface PhoneLifecycleAnalysis {
  mainTicket: RepairTicket;
  familyTickets: RepairTicket[];
  stages: PhoneLifecycleStage[];
  financials: PhoneFinancialLedger;
  wasReturned: boolean;
  isReturnResolved: boolean;
  returnReason?: string;
  returnDate?: string;
  activeReturnTicketNumber?: string;
  finalResolutionText: string;
}

/**
 * Checks whether a ticket with status 'returned' is STILL actively waiting for re-repair / intake.
 * Returns false if the return was already repaired and marked as completed.
 */
export const isTicketActiveReturnPending = (ticket: RepairTicket, allTickets: RepairTicket[]): boolean => {
  if (ticket.status !== 'returned') return false;

  // 1. If ticket explicitly points to an active child return ticket, check that child ticket's status
  if (ticket.activeReturnTicketId) {
    const child = allTickets.find(t => t.id === ticket.activeReturnTicketId);
    if (child && child.status === 'completed') {
      return false; // Return ticket was repaired and completed!
    }
  }

  // 2. Check if any child return ticket belonging to this parent ticket is completed
  const completedChild = allTickets.find(
    t => t.parentTicketId === ticket.id && t.isReturn && t.status === 'completed'
  );
  if (completedChild) {
    return false;
  }

  // 3. Check status history: if it ended with 'completed' after 'returned'
  if (ticket.statusHistory && ticket.statusHistory.length > 0) {
    const history = ticket.statusHistory;
    let returnedIdx = -1;
    for (let i = history.length - 1; i >= 0; i--) {
      if (history[i].status === 'returned') {
        returnedIdx = i;
        break;
      }
    }
    if (returnedIdx >= 0) {
      const hasCompletedAfter = history.slice(returnedIdx + 1).some(h => h.status === 'completed');
      if (hasCompletedAfter) return false;
    }
  }

  // 4. Check completedAt timestamp vs returnDate
  if (ticket.completedAt && ticket.returnDate) {
    try {
      if (new Date(ticket.completedAt).getTime() > new Date(ticket.returnDate).getTime()) {
        return false;
      }
    } catch {}
  }

  // 5. Check returnRecords array if marked completed
  if ((ticket as any).returnRecords && Array.isArray((ticket as any).returnRecords)) {
    const records = (ticket as any).returnRecords;
    if (records.some((r: any) => r.status === 'completed' && r.resolvedAt)) {
      return false;
    }
  }

  return true;
};

/**
 * Returns the effective status of a ticket, healing stale 'returned' status when its return is already resolved.
 */
export const getEffectiveTicketStatus = (
  ticket: RepairTicket,
  allTickets: RepairTicket[] = []
): RepairTicket['status'] => {
  if (ticket.status === 'returned') {
    const isStillPending = isTicketActiveReturnPending(ticket, allTickets);
    if (!isStillPending) {
      return 'completed';
    }
  }
  return ticket.status;
};

/**
 * Builds the complete, end-to-end lifecycle history and financial ledger of a phone repair
 * from intake to first repair, handover, return event, re-repair, and final delivery.
 */
export const buildPhoneLifecycle = (
  currentTicket: RepairTicket,
  allTickets: RepairTicket[],
  debts: CustomerDebtEntry[] = []
): PhoneLifecycleAnalysis => {
  // 1. Identify main parent ticket
  const parentId = currentTicket.parentTicketId || currentTicket.id;
  const mainTicket = allTickets.find(t => t.id === parentId) || currentTicket;

  // 2. Identify all family tickets linked to this device repair
  const familyTickets = allTickets
    .filter(t => t.id === mainTicket.id || t.parentTicketId === mainTicket.id)
    .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

  // Return child tickets
  const returnChildTickets = familyTickets.filter(t => t.isReturn || t.id !== mainTicket.id);
  const primaryReturnChild = returnChildTickets[0];

  const wasReturned = Boolean(
    mainTicket.status === 'returned' ||
    mainTicket.returnDate ||
    mainTicket.returnReason ||
    returnChildTickets.length > 0 ||
    (mainTicket as any).returnRecords?.length > 0
  );

  const isReturnResolved = Boolean(
    wasReturned &&
    (
      !isTicketActiveReturnPending(mainTicket, allTickets) ||
      returnChildTickets.some(t => t.status === 'completed') ||
      mainTicket.status === 'completed'
    )
  );

  const returnReason =
    mainTicket.returnReason ||
    primaryReturnChild?.issueDescription?.replace(/\[RETURN.*?\]\s*/i, '') ||
    'Client reported an issue under warranty/follow-up';

  const returnDate =
    mainTicket.returnDate ||
    primaryReturnChild?.createdAt ||
    mainTicket.updatedAt;

  // 3. Build chronological stages
  const stages: PhoneLifecycleStage[] = [];

  // STAGE 1: First Brought In (Intake)
  stages.push({
    stage: 'intake',
    title: 'First Brought In (Intake)',
    badge: '📥 INTAKE',
    timestamp: mainTicket.createdAt,
    actorOrTechnician: mainTicket.createdByName || 'Intake Counter',
    summary: `Phone registered by ${mainTicket.customerName} (${mainTicket.customerPhone || 'Walk-in'}).`,
    issueOrReason: mainTicket.issueDescription,
    financialInfo: {
      cost: mainTicket.estimatedCost || 0,
      deposit: mainTicket.depositAmount || 0,
    },
    ticketId: mainTicket.id,
    ticketNumber: mainTicket.ticketNumber,
  });

  // STAGE 2: First Repaired
  const firstRepairedAt =
    mainTicket.repairedAt ||
    mainTicket.statusHistory?.find(h => h.status === 'ready')?.at ||
    (mainTicket.status === 'ready' || mainTicket.status === 'completed' ? mainTicket.updatedAt : undefined);

  if (firstRepairedAt || mainTicket.status === 'ready' || mainTicket.status === 'completed' || wasReturned) {
    stages.push({
      stage: 'repaired',
      title: 'First Repair Completed in Workshop',
      badge: '🔧 REPAIRED',
      timestamp: firstRepairedAt || mainTicket.createdAt,
      actorOrTechnician: mainTicket.assignedTechnician || 'Workshop Technician',
      summary: mainTicket.partsUsed && mainTicket.partsUsed.length > 0
        ? `Hardware service completed using ${mainTicket.partsUsed.length} replacement part(s).`
        : 'Repair service completed and phone tested.',
      partsUsed: mainTicket.partsUsed?.map(p => ({
        name: p.name,
        quantity: p.quantity,
        cost: p.cost,
      })),
      issueOrReason: mainTicket.remark || undefined,
      ticketId: mainTicket.id,
      ticketNumber: mainTicket.ticketNumber,
    });
  }

  // STAGE 3: First Picked Up / Taken
  const firstCompletedAt =
    mainTicket.completedAt ||
    mainTicket.statusHistory?.find(h => h.status === 'completed')?.at;

  const firstCost = mainTicket.actualCost ?? mainTicket.estimatedCost ?? 0;
  const firstDeposit = mainTicket.depositAmount || 0;
  const firstHandoverPaid = mainTicket.handoverAmountPaid ?? Math.max(0, (mainTicket.paidAmount || 0) - firstDeposit);
  const firstTotalPaid = (mainTicket.paidAmount !== undefined) ? mainTicket.paidAmount : (firstDeposit + firstHandoverPaid);
  const firstDebt = Math.max(0, firstCost - firstTotalPaid);

  if (firstCompletedAt || wasReturned || mainTicket.status === 'completed') {
    stages.push({
      stage: 'handover',
      title: 'Phone Picked Up & Claimed by Customer',
      badge: '📦 TAKEN',
      timestamp: firstCompletedAt || mainTicket.updatedAt,
      actorOrTechnician: mainTicket.createdByName || 'Shop Staff',
      summary: firstDebt > 0
        ? `Phone handed over with ${firstDebt.toLocaleString()} DZD registered as remaining debt.`
        : `Phone handed over to customer. Paid in full (${firstTotalPaid.toLocaleString()} DZD).`,
      financialInfo: {
        cost: firstCost,
        deposit: firstDeposit,
        paidNow: firstHandoverPaid,
        totalPaid: firstTotalPaid,
        remainingDebt: firstDebt,
        isDebt: firstDebt > 0,
      },
      issueOrReason: mainTicket.settlementNotes || undefined,
      ticketId: mainTicket.id,
      ticketNumber: mainTicket.ticketNumber,
    });
  }

  // STAGE 4: Return Event (if returned)
  if (wasReturned) {
    stages.push({
      stage: 'returned',
      title: 'Device Returned by Customer',
      badge: '⚠️ RETURNED',
      timestamp: returnDate,
      actorOrTechnician: 'Customer Return',
      summary: `Phone brought back. Ticket #${primaryReturnChild?.ticketNumber || mainTicket.activeReturnTicketNumber || mainTicket.ticketNumber} opened for inspection.`,
      issueOrReason: returnReason,
      isWarranty: primaryReturnChild ? (primaryReturnChild.estimatedCost === 0) : true,
      ticketId: primaryReturnChild?.id || mainTicket.id,
      ticketNumber: primaryReturnChild?.ticketNumber || mainTicket.activeReturnTicketNumber,
    });
  }

  // STAGE 5: Re-repaired
  if (primaryReturnChild) {
    const reRepairedAt =
      primaryReturnChild.repairedAt ||
      primaryReturnChild.statusHistory?.find(h => h.status === 'ready')?.at ||
      (primaryReturnChild.status === 'ready' || primaryReturnChild.status === 'completed' ? primaryReturnChild.updatedAt : undefined);

    if (reRepairedAt || primaryReturnChild.status === 'ready' || primaryReturnChild.status === 'completed') {
      stages.push({
        stage: 're_repaired',
        title: 'Warranty Re-Repair Completed',
        badge: '🔄 RE-REPAIRED',
        timestamp: reRepairedAt || primaryReturnChild.createdAt,
        actorOrTechnician: primaryReturnChild.assignedTechnician || 'Workshop Technician',
        summary: primaryReturnChild.partsUsed && primaryReturnChild.partsUsed.length > 0
          ? `Re-service completed using ${primaryReturnChild.partsUsed.length} additional part(s).`
          : 'Re-inspection and adjustment completed. Device tested and verified.',
        partsUsed: primaryReturnChild.partsUsed?.map(p => ({
          name: p.name,
          quantity: p.quantity,
          cost: p.cost,
        })),
        ticketId: primaryReturnChild.id,
        ticketNumber: primaryReturnChild.ticketNumber,
      });
    }
  }

  // STAGE 6: Re-handover & Final Resolution
  if (isReturnResolved) {
    const finalHandoverAt =
      primaryReturnChild?.completedAt ||
      mainTicket.completedAt ||
      new Date().toISOString();

    const returnCost = primaryReturnChild?.actualCost ?? primaryReturnChild?.estimatedCost ?? 0;
    const returnPaid = primaryReturnChild?.paidAmount ?? primaryReturnChild?.handoverAmountPaid ?? 0;

    stages.push({
      stage: 're_handover',
      title: 'Re-repaired & Handed Over (Resolved)',
      badge: '✅ COMPLETED',
      timestamp: finalHandoverAt,
      actorOrTechnician: 'Shop Staff',
      summary: 'Return resolution completed and phone returned to customer in working condition.',
      financialInfo: {
        cost: returnCost,
        paidNow: returnPaid,
        totalPaid: returnPaid,
        remainingDebt: Math.max(0, returnCost - returnPaid),
      },
      issueOrReason: primaryReturnChild?.settlementNotes || 'Warranty claim verified and delivered.',
      ticketId: primaryReturnChild?.id || mainTicket.id,
      ticketNumber: primaryReturnChild?.ticketNumber || mainTicket.ticketNumber,
    });
  }

  // 4. Calculate Unified Financial Ledger
  const returnCost = primaryReturnChild ? (primaryReturnChild.actualCost ?? primaryReturnChild.estimatedCost ?? 0) : 0;
  const returnPaid = primaryReturnChild ? (primaryReturnChild.paidAmount ?? primaryReturnChild.handoverAmountPaid ?? 0) : 0;

  const totalBilledCost = firstCost + returnCost;
  const totalCollected = firstTotalPaid + returnPaid;

  // Cross-reference with live customer debts ledger if linked
  let netRemainingDebt = Math.max(0, totalBilledCost - totalCollected);
  if (mainTicket.debtEntryId && debts.length > 0) {
    const linkedDebt = debts.find(d => d.id === mainTicket.debtEntryId);
    if (linkedDebt) {
      netRemainingDebt = linkedDebt.remainingBalance;
    }
  }

  const financials: PhoneFinancialLedger = {
    initialEstimatedCost: mainTicket.estimatedCost || 0,
    initialDeposit: firstDeposit,
    firstActualCost: firstCost,
    firstHandoverPaid,
    firstTotalPaid,
    firstRemainingDebt: firstDebt,

    returnAdditionalCost: returnCost,
    secondHandoverPaid: returnPaid,

    totalBilledCost,
    totalCollected,
    netRemainingDebt,
    isFullySettled: netRemainingDebt <= 0,
  };

  const finalResolutionText = isReturnResolved
    ? 'Returned, repaired again, and successfully delivered to customer ✅'
    : wasReturned
    ? `Under active return warranty re-repair (Reason: "${returnReason}") ⚠️`
    : mainTicket.status === 'completed'
    ? 'Repaired and picked up by customer ✅'
    : mainTicket.status === 'ready'
    ? 'Repaired and waiting for customer pickup 📦'
    : mainTicket.status === 'in_progress'
    ? 'Currently on technician workbench 🔧'
    : 'Pending intake in workshop 📥';

  return {
    mainTicket,
    familyTickets,
    stages,
    financials,
    wasReturned,
    isReturnResolved,
    returnReason: wasReturned ? returnReason : undefined,
    returnDate: wasReturned ? returnDate : undefined,
    activeReturnTicketNumber: primaryReturnChild?.ticketNumber || mainTicket.activeReturnTicketNumber,
    finalResolutionText,
  };
};
