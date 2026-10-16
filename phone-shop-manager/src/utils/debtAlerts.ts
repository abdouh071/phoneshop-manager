import type { CustomerDebtEntry } from '../types';
import { formatCurrency } from './formatCurrency';

/**
 * Checks whether a debt record is past its due date with an outstanding balance.
 */
export const isDebtOverdue = (debt: CustomerDebtEntry): boolean => {
  if (debt.status === 'paid' || debt.remainingBalance <= 0) return false;
  if (!debt.dueDate) return false;

  const due = new Date(debt.dueDate);
  if (isNaN(due.getTime())) return false;

  // Set to end of due date day so full day is allowed
  due.setHours(23, 59, 59, 999);
  return due.getTime() < Date.now();
};

/**
 * Calculates the number of days a debt is overdue. Returns 0 if not overdue.
 */
export const getDaysOverdue = (dueDateStr?: string): number => {
  if (!dueDateStr) return 0;
  const due = new Date(dueDateStr);
  if (isNaN(due.getTime())) return 0;

  due.setHours(23, 59, 59, 999);
  const diffMs = Date.now() - due.getTime();
  if (diffMs <= 0) return 0;

  return Math.max(1, Math.floor(diffMs / (1000 * 60 * 60 * 24)));
};

/**
 * Returns all overdue debts from a list.
 */
export const getOverdueDebts = (debts: CustomerDebtEntry[]): CustomerDebtEntry[] => {
  return debts.filter(isDebtOverdue);
};

/**
 * Calculates overdue summary metrics for a specific customer.
 */
export const getCustomerOverdueInfo = (debts: CustomerDebtEntry[], customerId: string) => {
  const custDebts = debts.filter(d => d.customerId === customerId);
  const overdueDebts = custDebts.filter(isDebtOverdue);

  const hasOverdue = overdueDebts.length > 0;
  const count = overdueDebts.length;
  const totalOverdueAmount = overdueDebts.reduce((sum, d) => sum + d.remainingBalance, 0);

  let maxDaysOverdue = 0;
  let oldestDueDate: string | undefined = undefined;

  for (const d of overdueDebts) {
    if (d.dueDate) {
      const days = getDaysOverdue(d.dueDate);
      if (days > maxDaysOverdue) {
        maxDaysOverdue = days;
        oldestDueDate = d.dueDate;
      }
    }
  }

  return {
    hasOverdue,
    count,
    totalOverdueAmount,
    maxDaysOverdue,
    oldestDueDate,
    overdueDebts,
  };
};

/**
 * Generates a pre-filled WhatsApp link with a professional debt reminder message.
 */
export const buildWhatsAppDebtReminderUrl = (params: {
  customerName: string;
  customerPhone: string;
  productOrService?: string;
  amountOwed: number;
  dueDate?: string;
  daysOverdue?: number;
  shopName?: string;
}): string => {
  const cleanPhone = params.customerPhone.replace(/\D/g, '');
  
  const formatDate = (iso?: string) => {
    if (!iso) return '';
    const d = new Date(iso);
    return isNaN(d.getTime()) ? iso : d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' });
  };

  const formattedAmount = formatCurrency(params.amountOwed);
  const dueDateStr = params.dueDate ? formatDate(params.dueDate) : '';

  let message = `Salam ${params.customerName},\n\n`;
  message += `Rappel amical de votre boutique concernant votre compte crédit`;
  if (params.productOrService) {
    message += ` pour (${params.productOrService})`;
  }
  message += `.\n\n`;
  message += `• Solde restant à régler: *${formattedAmount}*\n`;

  if (params.daysOverdue && params.daysOverdue > 0) {
    message += `• Échéance dépassée: *${params.daysOverdue} jour${params.daysOverdue > 1 ? 's' : ''} de retard* (${dueDateStr})\n`;
  } else if (dueDateStr) {
    message += `• Date d'échéance: *${dueDateStr}*\n`;
  }

  message += `\nMerci de bien vouloir passer à la boutique pour régulariser votre situation. Merci de votre confiance ! 🙏`;

  return `https://wa.me/${cleanPhone}?text=${encodeURIComponent(message)}`;
};
