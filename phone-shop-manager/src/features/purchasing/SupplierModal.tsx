import React, { useEffect, useState } from 'react';
import { X, Building2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { usePurchasingStore } from '../../store/purchasingStore';
import { useToast } from '../../components/ui/Toast';
import styles from './SupplierModal.module.css';

interface SupplierModalProps {
  isOpen: boolean;
  onClose: () => void;
  supplierId: string | null;
}

export const SupplierModal: React.FC<SupplierModalProps> = ({ isOpen, onClose, supplierId }) => {
  const { t } = useTranslation();
  const { suppliers, addSupplier, updateSupplier } = usePurchasingStore();
  const toast = useToast();
  
  const [name, setName] = useState('');
  const [contactName, setContactName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  const [notes, setNotes] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (isOpen && supplierId) {
      const s = suppliers.find(sup => sup.id === supplierId);
      if (s) {
        setName(s.name);
        setContactName(s.contactName || '');
        setEmail(s.email || '');
        setPhone(s.phone || '');
        setAddress(s.address || '');
        setNotes(s.notes || '');
      }
    } else {
      setName('');
      setContactName('');
      setEmail('');
      setPhone('');
      setAddress('');
      setNotes('');
    }
  }, [isOpen, supplierId, suppliers]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    setIsSubmitting(true);
    try {
      const data = {
        name,
        contactName: contactName || undefined,
        email: email || undefined,
        phone: phone || undefined,
        address: address || undefined,
        notes: notes || undefined,
      };

      if (supplierId) {
        await updateSupplier(supplierId, data);
        toast.success('Supplier Updated', `${name} has been updated.`);
      } else {
        await addSupplier(data);
        toast.success('Supplier Added', `${name} has been created.`);
      }
      onClose();
    } catch (err) {
      toast.error('Error', (err as Error).message || 'Failed to save supplier');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className={styles.overlay}>
      <div className={styles.modal}>
        <div className={styles.header}>
          <div className={styles.headerTitle}>
            <Building2 size={20} className={styles.headerIcon} />
            <div>
              <h2>{supplierId ? 'Edit Supplier' : 'Add Supplier'}</h2>
              <p>{supplierId ? 'Update supplier details' : 'Create a new supplier profile'}</p>
            </div>
          </div>
          <button className={styles.closeBtn} onClick={onClose} aria-label={t('common.close')}><X size={20} /></button>
        </div>

        <form onSubmit={handleSubmit} className={styles.form}>
          <Input label="Company Name *" value={name} onChange={e => setName(e.target.value)} required autoFocus />
          <div className={styles.row}>
            <Input label="Contact Name" value={contactName} onChange={e => setContactName(e.target.value)} />
            <Input label="Phone" value={phone} onChange={e => setPhone(e.target.value)} />
          </div>
          <Input label="Email" type="email" value={email} onChange={e => setEmail(e.target.value)} />
          <Input label="Address" value={address} onChange={e => setAddress(e.target.value)} />
          <Input label="Notes" value={notes} onChange={e => setNotes(e.target.value)} />
          
          <div className={styles.footer}>
            <Button type="button" variant="ghost" onClick={onClose} disabled={isSubmitting}>Cancel</Button>
            <Button type="submit" isLoading={isSubmitting}>{supplierId ? 'Save Changes' : 'Add Supplier'}</Button>
          </div>
        </form>
      </div>
    </div>
  );
};
