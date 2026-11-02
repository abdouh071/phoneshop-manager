import React, { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  BookOpen, DollarSign, Wrench, ShoppingBag, User,
  FileText, Plus, Send, UserCheck
} from 'lucide-react';
import type { Customer, CustomerActivityLog, CustomerActionType } from '../../types';
import { useCustomerStore } from '../../store/customerStore';
import { useAuthStore } from '../../store/authStore';
import { useToast } from '../../components/ui/Toast';
import styles from './CustomerActivityLog.module.css';

interface Props {
  customer: Customer;
  logs: CustomerActivityLog[];
}

type FilterCategory = 'all' | 'debt' | 'repairs' | 'sales' | 'profile' | 'notes';

export const CustomerActivityLogList: React.FC<Props> = ({ customer, logs }) => {
  const { t, i18n } = useTranslation();
  const { addCustomerAuditLog } = useCustomerStore();
  const { user } = useAuthStore();
  const toast = useToast();

  const locale = i18n.language === 'ar' ? 'ar-DZ' : i18n.language === 'fr' ? 'fr-FR' : 'en-GB';

  const formatLogTime = (iso: string) => {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    
    const datePart = d.toLocaleDateString(locale, { day: '2-digit', month: 'short', year: 'numeric' });
    const timePart = d.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
    return `${datePart} ${t('common.at', 'at')} ${timePart}`;
  };

  const [filter, setFilter] = useState<FilterCategory>('all');
  const [newNote, setNewNote] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleAddNote = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newNote.trim()) return;

    setIsSubmitting(true);
    try {
      await addCustomerAuditLog({
        customerId: customer.id,
        customerName: customer.name,
        actionType: 'note_added',
        actionTitle: 'Internal Staff Note Added',
        actionDescription: newNote.trim(),
        actorId: user?.id,
        actorName: user?.name || 'Staff',
        actorRole: user?.role,
        metadata: { note: newNote.trim() },
      });
      setNewNote('');
      toast.success(t('customers.noteLoggedToast', 'Note Logged'), t('customers.noteLoggedToastDesc', 'Staff audit note recorded on customer timeline.'));
    } catch (err) {
      console.error(err);
      toast.error(t('customers.failedToLogNote', 'Failed to log note'));
    } finally {
      setIsSubmitting(false);
    }
  };

  // Filter logs
  const filteredLogs = useMemo(() => {
    return logs.filter(log => {
      if (filter === 'all') return true;
      if (filter === 'debt') return log.actionType === 'debt_added' || log.actionType === 'debt_payment' || log.actionType === 'debt_deleted';
      if (filter === 'repairs') return log.actionType === 'repair_created' || log.actionType === 'repair_updated';
      if (filter === 'sales') return log.actionType === 'sale_completed';
      if (filter === 'profile') return log.actionType === 'customer_created' || log.actionType === 'customer_updated';
      if (filter === 'notes') return log.actionType === 'note_added';
      return true;
    });
  }, [logs, filter]);

  const getActionIcon = (type: CustomerActionType) => {
    switch (type) {
      case 'debt_added':
        return <div className={[styles.iconBadge, styles.iconDebt].join(' ')}><BookOpen size={13} /></div>;
      case 'debt_payment':
        return <div className={[styles.iconBadge, styles.iconPayment].join(' ')}><DollarSign size={13} /></div>;
      case 'debt_deleted':
        return <div className={[styles.iconBadge, styles.iconDebt].join(' ')}><BookOpen size={13} /></div>;
      case 'repair_created':
      case 'repair_updated':
        return <div className={[styles.iconBadge, styles.iconRepair].join(' ')}><Wrench size={13} /></div>;
      case 'sale_completed':
        return <div className={[styles.iconBadge, styles.iconSale].join(' ')}><ShoppingBag size={13} /></div>;
      case 'customer_created':
      case 'customer_updated':
        return <div className={[styles.iconBadge, styles.iconProfile].join(' ')}><User size={13} /></div>;
      case 'note_added':
      default:
        return <div className={[styles.iconBadge, styles.iconNote].join(' ')}><FileText size={13} /></div>;
    }
  };

  return (
    <div className={styles.container}>
      {/* Add Staff Note / Observation Form */}
      <form onSubmit={handleAddNote} className={styles.addNoteBox}>
        <div className={styles.addNoteHeader}>
          <span className={styles.addNoteTitle}>
            <Plus size={13} /> {t('customers.auditAppendNote', 'Append Staff Action Note / Log')}
          </span>
          <span className={styles.authorHint}>
            {t('customers.auditAuthor', 'Author:')} <strong>{user?.name || 'Staff'}</strong> ({user?.role || 'user'})
          </span>
        </div>
        <textarea
          className={styles.noteTextarea}
          placeholder={t('customers.auditPlaceholder', 'Record staff observation, phone call agreement, special discount agreed, or dispute note...')}
          value={newNote}
          onChange={e => setNewNote(e.target.value)}
          disabled={isSubmitting}
        />
        <div className={styles.noteSubmitRow}>
          <span style={{ fontSize: '11px', color: '#94a3b8' }}>
            {t('customers.auditAppendOnly', '🔒 Append-only: Stamped with author and timestamp for audit trail')}
          </span>
          <button
            type="submit"
            className={styles.submitNoteBtn}
            disabled={isSubmitting || !newNote.trim()}
          >
            <Send size={11} /> {t('customers.auditSaveLog', 'Save Log')}
          </button>
        </div>
      </form>

      {/* Filter Row */}
      <div className={styles.filterRow}>
        {([
          { key: 'all' as FilterCategory, label: t('customers.auditAllActions', 'All Actions') },
          { key: 'debt' as FilterCategory, label: t('customers.auditDebtsPayments', '📒 Debts & Payments') },
          { key: 'repairs' as FilterCategory, label: t('customers.auditRepairs', '🔧 Repairs') },
          { key: 'sales' as FilterCategory, label: t('customers.auditSales', '🛒 Sales') },
          { key: 'profile' as FilterCategory, label: t('customers.auditProfileEdits', '👤 Profile Edits') },
          { key: 'notes' as FilterCategory, label: t('customers.auditStaffNotes', '📝 Staff Notes') },
        ]).map(f => (
          <button
            key={f.key}
            type="button"
            className={[styles.filterBtn, filter === f.key ? styles.filterBtnActive : ''].join(' ')}
            onClick={() => setFilter(f.key)}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* Audit Logs List */}
      {filteredLogs.length === 0 ? (
        <div className={styles.emptyLogs}>
          <p style={{ margin: 0, fontWeight: 600, color: '#64748b' }}>{t('customers.auditNoRecords', 'No activity records found.')}</p>
          <span style={{ fontSize: '11.5px', color: '#94a3b8' }}>
            {t('customers.auditNoRecordsDesc', 'Staff actions on debts, repairs, sales, and notes will be stamped here automatically.')}
          </span>
        </div>
      ) : (
        <div className={styles.logsList}>
          {filteredLogs.map(log => (
            <div key={log.id} className={styles.logCard}>
              <div className={styles.logHeader}>
                <div className={styles.logTitleWrap}>
                  {getActionIcon(log.actionType)}
                  <span>{log.actionTitle}</span>
                </div>
                <span className={styles.logTime}>{formatLogTime(log.date)}</span>
              </div>
              <p className={styles.logDesc}>{log.actionDescription}</p>
              <div className={styles.logFooter}>
                <span className={styles.actorTag}>
                  <UserCheck size={12} /> {t('customers.auditLoggedBy', 'Logged by:')} {log.actorName} {log.actorRole ? `(${log.actorRole})` : ''}
                </span>
                <span style={{ fontSize: '10.5px', color: '#94a3b8' }}>
                  {t('customers.auditId', 'Audit ID:')} {log.id.slice(0, 10)}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
