import React, { useState } from 'react';
import { Modal } from './Modal';
import { Input } from './Input';
import { Button } from './Button';
import { useAuthStore } from '../../store/authStore';
import { useActivityStore } from '../../store/activityStore';

interface AdminUnlockModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  actionName?: string;
}

export const AdminUnlockModal: React.FC<AdminUnlockModalProps> = ({ 
  isOpen, 
  onClose, 
  onSuccess, 
  actionName = 'perform this action' 
}) => {
  const { unlockHistory } = useAuthStore();
  const { logActivity } = useActivityStore();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) return;
    setIsLoading(true);
    setError('');
    try {
      await unlockHistory(email, password);
      
      const { user } = useAuthStore.getState();
      logActivity('system', `Admin unlocked terminal`, {
        detail: `Terminal unlocked by ${email} to ${actionName}. Active session user: ${user?.name || 'Unknown'}`
      });

      setPassword('');
      setEmail('');
      onSuccess();
      onClose();
    } catch (err: any) {
      setError(err.message || 'Incorrect admin credentials.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Admin Permission Required"
      size="sm"
    >
      <form onSubmit={handleSubmit} style={{ padding: 'var(--space-6)', display: 'flex', flexDirection: 'column', gap: '16px' }}>
        <p style={{ fontSize: '14px', color: 'var(--color-on-surface-variant)', lineHeight: 1.5 }}>
          You need admin permission to {actionName}. Please enter your admin credentials to continue.
        </p>
        <Input
          label="Admin Email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoFocus
          required
        />
        <Input
          label="Admin Password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          error={error}
          required
        />
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '8px' }}>
          <Button type="button" variant="ghost" onClick={onClose} disabled={isLoading}>Cancel</Button>
          <Button type="submit" isLoading={isLoading}>Unlock & Continue</Button>
        </div>
      </form>
    </Modal>
  );
};
