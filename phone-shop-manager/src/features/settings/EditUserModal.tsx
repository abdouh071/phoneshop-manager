import React, { useState, useEffect } from 'react';
import { Modal } from '../../components/ui/Modal';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { Select } from '../../components/ui/Select';
import { useAuthStore } from '../../store/authStore';
import { SetPinModal } from './SetPinModal';
import { useToast } from '../../components/ui/Toast';
import type { User } from '../../store/authStore';
import {
  FULL_PERMISSIONS,
  SALES_AGENT_PERMISSIONS,
  REPAIR_AGENT_PERMISSIONS,
  PERMISSION_DEFINITIONS,
} from '../../types/permissions';
import type { Permissions } from '../../types/permissions';
import { errorMessage } from '../../utils/errorUtils';

type WorkerRole = 'admin' | 'sales_agent' | 'repair_agent';

interface EditUserModalProps {
  isOpen: boolean;
  onClose: () => void;
  member: User | null;
}

const ROLE_PRESETS: Record<WorkerRole, Permissions> = {
  admin: FULL_PERMISSIONS,
  sales_agent: SALES_AGENT_PERMISSIONS,
  repair_agent: REPAIR_AGENT_PERMISSIONS,
};

export const EditUserModal: React.FC<EditUserModalProps> = ({ isOpen, onClose, member }) => {
  const { updateStaffMember, isLoading, isSuperAdmin } = useAuthStore();
  const toast = useToast();

  const [name, setName] = useState('');
  const [role, setRole] = useState<WorkerRole>('sales_agent');
  const [permissions, setPermissions] = useState<Permissions>({ ...SALES_AGENT_PERMISSIONS });
  const [error, setError] = useState<string | null>(null);
  const [isPinModalOpen, setIsPinModalOpen] = useState(false);

  useEffect(() => {
    if (member) {
      setName(member.name);
      const memberRole = member.role as WorkerRole;
      setRole(memberRole);
      const basePreset = ROLE_PRESETS[memberRole] ?? SALES_AGENT_PERMISSIONS;
      setPermissions({
        ...basePreset,
        ...(member.permissions ?? {}),
      });
      setError(null);
    }
  }, [member]);

  if (!member) return null;

  const handleRoleChange = (newRole: WorkerRole) => {
    setRole(newRole);
    setPermissions({ ...ROLE_PRESETS[newRole] });
  };

  const togglePermission = (key: keyof Permissions) => {
    setPermissions(prev => ({ ...prev, [key]: !prev[key] }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!name.trim()) { setError('Name cannot be empty.'); return; }

    try {
      await updateStaffMember(member.id, {
        name: name.trim(),
        role,
        permissions: role === 'admin' ? FULL_PERMISSIONS : permissions,
      });
      toast.success('Staff Member Updated', `${name}'s profile has been saved.`);
      onClose();
    } catch (err: unknown) {
      setError(errorMessage(err) || 'Failed to update member.');
    }
  };

  const groups: Record<string, typeof PERMISSION_DEFINITIONS> = {};
  PERMISSION_DEFINITIONS.forEach(p => {
    if (!groups[p.group]) groups[p.group] = [];
    groups[p.group].push(p);
  });

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={`Edit Member: ${member.name}`}>
      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '16px', marginTop: '16px' }}>
        {error && (
          <div style={{ padding: '12px', background: 'rgba(239,68,68,0.1)', color: '#ef4444', borderRadius: '6px', fontSize: '14px' }}>
            {error}
          </div>
        )}

        <div style={{ padding: '10px 14px', background: 'var(--color-surface-variant, #f0f0f0)', borderRadius: '8px', fontSize: '13px', color: 'var(--color-on-surface-variant, #666)' }}>
          <strong>Email:</strong> {member.email}
          <p style={{ fontSize: '11px', margin: '3px 0 0' }}>Email cannot be changed. Revoke and re-create if needed.</p>
        </div>

        <Input label="Full Name" value={name} onChange={e => setName(e.target.value)} required />

        {/* Only Super Admin can change roles freely; regular Admins manage worker roles only */}
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
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <div style={{ padding: '10px 14px', background: 'rgba(99,102,241,0.08)', borderRadius: '8px', fontSize: '13px', color: 'var(--color-primary, #6366f1)' }}>
              ✓ Admins automatically receive full access to all features.
            </div>
            <div style={{
              padding: '12px 14px',
              border: '1px solid var(--color-outline, #e2e8f0)',
              borderRadius: '8px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              background: 'var(--color-surface, #ffffff)',
            }}>
              <div>
                <div style={{ fontSize: '13px', fontWeight: 600 }}>Quick Approval PIN</div>
                <div style={{ fontSize: '12px', color: 'var(--color-on-surface-variant, #64748b)' }}>
                  {member.hasApprovalPin ? 'PIN is currently active' : 'No PIN configured yet'}
                </div>
              </div>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => setIsPinModalOpen(true)}
              >
                {member.hasApprovalPin ? 'Change PIN' : 'Set PIN'}
              </Button>
            </div>
          </div>
        )}

        {/* Custom permissions panel for non-admin roles */}
        {role !== 'admin' && (
          <div style={{ border: '1px solid var(--color-outline, #e5e7eb)', borderRadius: '10px', overflow: 'hidden' }}>
            <div style={{ padding: '12px 14px', background: 'var(--color-surface-variant, #f8fafc)', borderBottom: '1px solid var(--color-outline, #e5e7eb)' }}>
              <p style={{ margin: 0, fontWeight: 600, fontSize: '13px' }}>Custom Feature Access</p>
              <p style={{ margin: '2px 0 0', fontSize: '12px', color: 'var(--color-on-surface-variant, #666)' }}>Fine-tune which sections this member can access.</p>
            </div>
            <div style={{ padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
              {Object.entries(groups).map(([groupName, perms]) => (
                <div key={groupName}>
                  <p style={{ margin: '0 0 8px', fontSize: '11px', fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', color: '#888' }}>
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
                          <p style={{ margin: '1px 0 0', fontSize: '11px', color: '#888' }}>{description}</p>
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
          <Button type="submit" isLoading={isLoading}>Save Changes</Button>
        </div>
      </form>

      <SetPinModal
        isOpen={isPinModalOpen}
        onClose={() => setIsPinModalOpen(false)}
        targetUser={member}
      />
    </Modal>
  );
};
