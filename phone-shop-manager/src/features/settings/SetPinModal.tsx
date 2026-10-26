import React, { useState, useEffect } from 'react';
import { KeyRound, ShieldCheck, AlertCircle, Check, Trash2 } from 'lucide-react';
import { Modal } from '../../components/ui/Modal';
import { Button } from '../../components/ui/Button';
import { useAuthStore, type User } from '../../store/authStore';
import { useToast } from '../../components/ui/Toast';

interface SetPinModalProps {
  isOpen: boolean;
  onClose: () => void;
  targetUser?: User | null;
}

export const SetPinModal: React.FC<SetPinModalProps> = ({
  isOpen,
  onClose,
  targetUser,
}) => {
  const { user: currentUser, setApprovalPin, removeApprovalPin, isLoading } = useAuthStore();
  const toast = useToast();

  const userToEdit = targetUser || currentUser;
  const isEditingSelf = !targetUser || targetUser.id === currentUser?.id;

  const [pin, setPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      setPin('');
      setConfirmPin('');
      setError(null);
    }
  }, [isOpen]);

  if (!userToEdit) return null;

  const hasExistingPin = Boolean(userToEdit.approvalPin);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const cleanPin = pin.trim();
    const cleanConfirm = confirmPin.trim();

    if (!cleanPin || cleanPin.length < 4 || cleanPin.length > 8 || !/^\d+$/.test(cleanPin)) {
      setError('PIN must be 4 to 8 numeric digits.');
      return;
    }

    if (cleanPin !== cleanConfirm) {
      setError('PINs do not match. Please re-enter.');
      return;
    }

    try {
      await setApprovalPin(cleanPin, userToEdit.id);
      toast.success(
        'Approval PIN Saved',
        `Approval PIN for ${isEditingSelf ? 'your account' : userToEdit.name} has been updated.`
      );
      onClose();
    } catch (err: any) {
      setError(err.message || 'Failed to save approval PIN.');
    }
  };

  const handleRemove = async () => {
    if (!window.confirm(`Are you sure you want to remove the approval PIN for ${userToEdit.name}?`)) {
      return;
    }

    try {
      await removeApprovalPin(userToEdit.id);
      toast.info('Approval PIN Removed', `PIN has been cleared for ${userToEdit.name}.`);
      onClose();
    } catch (err: any) {
      setError(err.message || 'Failed to remove approval PIN.');
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={hasExistingPin ? 'Change Approval PIN' : 'Set Admin Approval PIN'}
      size="sm"
    >
      <form onSubmit={handleSubmit} style={{ padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
        
        <div style={{
          padding: '12px 14px',
          background: 'rgba(99, 102, 241, 0.08)',
          borderRadius: '10px',
          display: 'flex',
          alignItems: 'flex-start',
          gap: '10px',
        }}>
          <KeyRound size={20} style={{ color: 'var(--color-primary, #4f46e5)', marginTop: '2px', flexShrink: 0 }} />
          <div style={{ fontSize: '13px', color: 'var(--color-on-surface, #0f172a)', lineHeight: 1.4 }}>
            Setting PIN for: <strong>{userToEdit.name}</strong> ({userToEdit.email})
            <div style={{ fontSize: '12px', color: 'var(--color-on-surface-variant, #64748b)', marginTop: '3px' }}>
              Used to quickly approve staff actions (discounts, price changes, returns) without entering your full password.
            </div>
          </div>
        </div>

        {error && (
          <div style={{
            padding: '10px 12px',
            background: 'rgba(239, 68, 68, 0.1)',
            borderRadius: '8px',
            color: '#b91c1c',
            fontSize: '13px',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
          }}>
            <AlertCircle size={16} style={{ flexShrink: 0 }} />
            <span>{error}</span>
          </div>
        )}

        <div>
          <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: 'var(--color-on-surface-variant, #64748b)', marginBottom: '6px' }}>
            New 4 to 8 Digit PIN
          </label>
          <input
            type="password"
            inputMode="numeric"
            pattern="[0-9]*"
            maxLength={8}
            placeholder="••••"
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
            required
            autoFocus
            style={{
              width: '100%',
              padding: '12px 16px',
              fontSize: '22px',
              letterSpacing: '8px',
              textAlign: 'center',
              borderRadius: '10px',
              border: '1px solid var(--color-outline, #cbd5e1)',
              background: 'var(--color-surface, #ffffff)',
              color: 'var(--color-on-surface, #0f172a)',
              outline: 'none',
              boxSizing: 'border-box',
            }}
          />
        </div>

        <div>
          <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: 'var(--color-on-surface-variant, #64748b)', marginBottom: '6px' }}>
            Confirm PIN
          </label>
          <input
            type="password"
            inputMode="numeric"
            pattern="[0-9]*"
            maxLength={8}
            placeholder="••••"
            value={confirmPin}
            onChange={(e) => setConfirmPin(e.target.value.replace(/\D/g, ''))}
            required
            style={{
              width: '100%',
              padding: '12px 16px',
              fontSize: '22px',
              letterSpacing: '8px',
              textAlign: 'center',
              borderRadius: '10px',
              border: '1px solid var(--color-outline, #cbd5e1)',
              background: 'var(--color-surface, #ffffff)',
              color: 'var(--color-on-surface, #0f172a)',
              outline: 'none',
              boxSizing: 'border-box',
            }}
          />
        </div>

        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginTop: '8px',
        }}>
          {hasExistingPin ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={handleRemove}
              disabled={isLoading}
              style={{ color: '#ef4444' }}
              leftIcon={<Trash2 size={14} />}
            >
              Remove PIN
            </Button>
          ) : <div />}

          <div style={{ display: 'flex', gap: '8px' }}>
            <Button type="button" variant="ghost" onClick={onClose} disabled={isLoading}>
              Cancel
            </Button>
            <Button
              type="submit"
              isLoading={isLoading}
              disabled={pin.length < 4 || pin !== confirmPin}
            >
              Save PIN
            </Button>
          </div>
        </div>
      </form>
    </Modal>
  );
};
