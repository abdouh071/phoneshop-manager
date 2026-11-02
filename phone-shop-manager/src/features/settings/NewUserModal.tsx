import React, { useState } from 'react';
import { Modal } from '../../components/ui/Modal';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { Select } from '../../components/ui/Select';
import { useAuthStore } from '../../store/authStore';
import { useToast } from '../../components/ui/Toast';
import {
  SALES_AGENT_PERMISSIONS,
  REPAIR_AGENT_PERMISSIONS,
  PERMISSION_DEFINITIONS,
} from '../../types/permissions';
import type { Permissions } from '../../types/permissions';
import { errorMessage } from '../../utils/errorUtils';

type WorkerRole = 'admin' | 'sales_agent' | 'repair_agent';

interface NewUserModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const ROLE_PRESETS: Record<WorkerRole, Permissions | null> = {
  admin: null,
  sales_agent: SALES_AGENT_PERMISSIONS,
  repair_agent: REPAIR_AGENT_PERMISSIONS,
};

export const NewUserModal: React.FC<NewUserModalProps> = ({ isOpen, onClose }) => {
  const { createStaffMember, isLoading, isSuperAdmin } = useAuthStore();
  const toast = useToast();

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<WorkerRole>('sales_agent');
  const [permissions, setPermissions] = useState<Permissions>({ ...SALES_AGENT_PERMISSIONS });
  const [error, setError] = useState<string | null>(null);

  const handleRoleChange = (newRole: WorkerRole) => {
    setRole(newRole);
    const preset = ROLE_PRESETS[newRole];
    if (preset) setPermissions({ ...preset });
  };

  const togglePermission = (key: keyof Permissions) => {
    setPermissions(prev => ({ ...prev, [key]: !prev[key] }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (password.length < 6) {
      setError('Password must be at least 6 characters.');
      return;
    }

    try {
      await createStaffMember(name, email, password, role, role !== 'admin' ? permissions : undefined);
      toast.success('Staff Member Added', `${name} can now log in to the system.`);
      // Reset
      setName(''); setEmail(''); setPassword(''); setRole('sales_agent');
      setPermissions({ ...SALES_AGENT_PERMISSIONS });
      onClose();
    } catch (err: unknown) {
      setError(errorMessage(err) || 'Failed to create user.');
    }
  };

  const groups: Record<string, typeof PERMISSION_DEFINITIONS> = {};
  PERMISSION_DEFINITIONS.forEach(p => {
    if (!groups[p.group]) groups[p.group] = [];
    groups[p.group].push(p);
  });

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Add New Staff Member">
      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '16px', marginTop: '16px' }}>
        {error && (
          <div style={{ padding: '12px', background: 'rgba(239,68,68,0.1)', color: '#ef4444', borderRadius: '6px', fontSize: '14px' }}>
            {error}
          </div>
        )}

        <Input label="Full Name" value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Ahmed Larbi" required />
        <Input label="Email Address" type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="e.g. ahmed@phoneshop.com" required />
        <Input label="Temporary Password" type="text" value={password} onChange={e => setPassword(e.target.value)} placeholder="Min 6 characters" required />

        {/* Role Selector */}
        {isSuperAdmin ? (
          <Select
            label="Role"
            value={role}
            onChange={val => handleRoleChange(val as WorkerRole)}
            options={[
              { value: 'sales_agent',  label: '🛒 Sales Agent — Sales counter & accessories' },
              { value: 'repair_agent', label: '🔧 Repair Agent — Repairs & spare parts' },
              { value: 'admin',        label: '🔑 Admin (Full Access)' },
            ]}
          />
        ) : (
          <Select
            label="Role"
            value={role}
            onChange={val => handleRoleChange(val as WorkerRole)}
            options={[
              { value: 'sales_agent',  label: '🛒 Sales Agent — Sales counter & accessories' },
              { value: 'repair_agent', label: '🔧 Repair Agent — Repairs & spare parts' },
            ]}
          />
        )}

        {/* Role description hint */}
        {role === 'sales_agent' && (
          <div style={{ padding: '10px 14px', background: 'rgba(16,185,129,0.08)', borderRadius: '8px', fontSize: '12px', color: '#065f46' }}>
            💡 Sales Agents see: Dashboard, POS, Sales Inventory (phones, accessories), Customers
          </div>
        )}
        {role === 'repair_agent' && (
          <div style={{ padding: '10px 14px', background: 'rgba(245,158,11,0.08)', borderRadius: '8px', fontSize: '12px', color: '#78350f' }}>
            💡 Repair Agents see: Dashboard, Repairs, Repair Parts Inventory, Customers
          </div>
        )}
        {role === 'admin' && (
          <div style={{ padding: '10px 14px', background: 'rgba(99,102,241,0.08)', borderRadius: '8px', fontSize: '13px', color: 'var(--color-primary, #6366f1)' }}>
            ✓ Admins automatically receive full access to all features.
          </div>
        )}

        {/* Custom permissions panel — visible for worker roles */}
        {role !== 'admin' && (
          <div style={{ border: '1px solid var(--color-outline, #e5e7eb)', borderRadius: '10px', overflow: 'hidden' }}>
            <div style={{ padding: '12px 14px', background: 'var(--color-surface-variant, #f8fafc)', borderBottom: '1px solid var(--color-outline, #e5e7eb)' }}>
              <p style={{ margin: 0, fontWeight: 600, fontSize: '13px' }}>Custom Feature Access</p>
              <p style={{ margin: '2px 0 0', fontSize: '12px', color: 'var(--color-on-surface-variant, #666)' }}>
                Fine-tune which features this member can access (pre-filled from role preset).
              </p>
            </div>
            <div style={{ padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
              {Object.entries(groups).map(([groupName, perms]) => (
                <div key={groupName}>
                  <p style={{ margin: '0 0 8px', fontSize: '11px', fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', color: 'var(--color-on-surface-variant, #888)' }}>
                    {groupName}
                  </p>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    {perms.map(({ key, label, description }) => (
                      <label key={key} style={{ display: 'flex', alignItems: 'flex-start', gap: '10px', cursor: 'pointer' }}>
                        <input
                          type="checkbox"
                          checked={permissions[key]}
                          onChange={() => togglePermission(key)}
                          style={{ marginTop: '2px', width: '16px', height: '16px', cursor: 'pointer', accentColor: 'var(--color-primary, #6366f1)' }}
                        />
                        <div>
                          <span style={{ fontSize: '13px', fontWeight: 500 }}>{label}</span>
                          <p style={{ margin: '1px 0 0', fontSize: '11px', color: 'var(--color-on-surface-variant, #888)' }}>{description}</p>
                        </div>
                      </label>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px', marginTop: '4px' }}>
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" isLoading={isLoading}>Create Account</Button>
        </div>
      </form>
    </Modal>
  );
};
