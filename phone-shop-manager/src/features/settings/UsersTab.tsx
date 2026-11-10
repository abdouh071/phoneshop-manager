import { useEffect, useState } from 'react';
import { Card, CardHeader } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Badge } from '../../components/ui/Badge';
import { Edit2, UserPlus, RefreshCw, ShieldOff, Smartphone, KeyRound } from 'lucide-react';
import { useAuthStore } from '../../store/authStore';
import type { User } from '../../store/authStore';
import { NewUserModal } from './NewUserModal';
import { EditUserModal } from './EditUserModal';
import { SetPinModal } from './SetPinModal';
import { useToast } from '../../components/ui/Toast';
import { userService } from '../../services/userService';
import styles from './Settings.module.css';
import { errorMessage } from '../../utils/errorUtils';

export const UsersTab = () => {
  const { user, staff, fetchStaff, updateStaffMember, isSuperAdmin } = useAuthStore();
  const toast = useToast();
  const [isNewUserModalOpen, setIsNewUserModalOpen] = useState(false);
  const [editingMember, setEditingMember] = useState<User | null>(null);
  const [isPinModalOpen, setIsPinModalOpen] = useState(false);
  const [selectedPinUser, setSelectedPinUser] = useState<User | null>(null);

  useEffect(() => {
    fetchStaff();
    // Move legacy on-profile PIN verifiers into the admin-only subcollection; silent
    // because the page works either way and the next visit retries whatever failed.
    void userService.migrateLegacyApprovalPins().catch(() => {});
  }, [fetchStaff]);

  const isUserAdmin = user?.role === 'admin' || user?.isSuperAdmin === true;

  const canManageTarget = (target: User) => {
    if (!user) return false;
    if (target.id === user.id) return false; // Cannot manage self
    if (isSuperAdmin) return true; // Super admin can manage everyone else
    
    // Regular admins can manage worker roles (sales_agent, repair_agent), but not other admins
    const workerRoles: User['role'][] = ['sales_agent', 'repair_agent'];
    if (user.role === 'admin' && workerRoles.includes(target.role)) return true;
    
    return false;
  };

  const handleRevoke = async (member: User) => {
    try {
      await updateStaffMember(member.id, { status: 'revoked' });
      toast.success('Access Revoked', `${member.name} can no longer log in.`);
    } catch (err: unknown) {
      toast.error('Error', errorMessage(err));
    }
  };

  const handleReactivate = async (member: User) => {
    try {
      await updateStaffMember(member.id, { status: 'active' });
      toast.success('Account Reactivated', `${member.name} can now log in again.`);
    } catch (err: unknown) {
      toast.error('Error', errorMessage(err));
    }
  };

  const formatLastActive = (lastActive: { toDate?: () => Date } | (string & { toDate?: () => Date }) | null | undefined) => {
    if (!lastActive) return 'Never';
    if (lastActive.toDate) {
      const date = lastActive.toDate();
      const now = new Date();
      const diffMs = now.getTime() - date.getTime();
      const diffMins = Math.floor(diffMs / 60000);
      if (diffMins < 1) return 'Just now';
      if (diffMins < 60) return `${diffMins}m ago`;
      const diffHours = Math.floor(diffMins / 60);
      if (diffHours < 24) return `${diffHours}h ago`;
      return date.toLocaleDateString();
    }
    return 'Unknown';
  };

  return (
    <>
      {/* Admin Approval PIN Quick Setup Card */}
      {isUserAdmin && (
        <div style={{
          marginBottom: '16px',
          padding: '16px 20px',
          background: 'var(--color-surface, #ffffff)',
          border: '1px solid var(--color-outline, #e2e8f0)',
          borderRadius: '12px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: '12px',
          boxShadow: '0 1px 3px rgba(0,0,0,0.03)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
            <div style={{
              width: '42px',
              height: '42px',
              borderRadius: '10px',
              background: 'rgba(99, 102, 241, 0.1)',
              color: 'var(--color-primary, #6366f1)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}>
              <KeyRound size={22} />
            </div>
            <div>
              <div style={{ fontSize: '15px', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span>Admin Quick Approval PIN</span>
                {user?.hasApprovalPin ? (
                  <Badge variant="success">PIN Active</Badge>
                ) : (
                  <Badge variant="warning">Not Configured</Badge>
                )}
              </div>
              <div style={{ fontSize: '12px', color: 'var(--color-on-surface-variant, #64748b)', marginTop: '2px' }}>
                {user?.hasApprovalPin
                  ? 'Your approval PIN is active. Use it on any staff terminal to instantly authorize price changes, discounts, and returns in-person without entering your login password.'
                  : 'Configure a 4-8 digit numeric PIN so you can authorize staff actions on their screens without typing your full password in front of others.'}
              </div>
            </div>
          </div>

          <Button
            variant={user?.hasApprovalPin ? 'secondary' : 'primary'}
            size="sm"
            leftIcon={<KeyRound size={15} />}
            onClick={() => { setSelectedPinUser(user); setIsPinModalOpen(true); }}
          >
            {user?.hasApprovalPin ? 'Change My PIN' : 'Set Approval PIN'}
          </Button>
        </div>
      )}

      <Card padding="none">
        <div className={styles.cardHeaderWithExport}>
          <CardHeader
            title="Staff & Users"
            subtitle={`${staff.filter(s => s.status !== 'revoked').length} active member${staff.filter(s => s.status !== 'revoked').length !== 1 ? 's' : ''}`}
          />
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            {/* Used to fall back to /downloads/Auto-Manager.apk, a copy of an old build baked
                into the installer. That bundle is gone from the shell, and staff install from
                Expo now, so the link only appears when it points somewhere real. */}
            {(import.meta.env.VITE_APK_DOWNLOAD_URL as string | undefined)?.trim() ? (
              <a
                href={(import.meta.env.VITE_APK_DOWNLOAD_URL as string).trim()}
                target="_blank"
                rel="noopener noreferrer"
                style={{ textDecoration: 'none' }}
                title="Get the technician app from Expo"
              >
                <Button
                  variant="secondary"
                  size="sm"
                  leftIcon={<Smartphone size={16} />}
                >
                  Get the Technician App
                </Button>
              </a>
            ) : (
              <span title="Set VITE_APK_DOWNLOAD_URL to your Expo builds page so staff can install the technician app.">
                <Button
                  variant="secondary"
                  size="sm"
                  leftIcon={<Smartphone size={16} />}
                  disabled
                >
                  Get the Technician App
                </Button>
              </span>
            )}
            {isUserAdmin && (
              <Button
                leftIcon={<UserPlus size={16} />}
                size="sm"
                onClick={() => setIsNewUserModalOpen(true)}
              >
                Add User
              </Button>
            )}
          </div>
        </div>

        <table className={styles.table}>
          <thead>
            <tr>
              <th className={styles.th}>Member</th>
              <th className={styles.th}>Role</th>
              <th className={styles.th}>Approval PIN</th>
              <th className={styles.th}>Status</th>
              <th className={styles.th}>Last Active</th>
              <th className={styles.th}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {staff.map((u) => {
              const isRevoked = u.status === 'revoked';
              const isSelf = u.id === user?.id;
              const isAdminMember = u.role === 'admin' || u.isSuperAdmin;
              const canEditPin = isUserAdmin && (isSelf || isSuperAdmin);

              return (
                <tr key={u.id} className={styles.tr} style={{ opacity: isRevoked ? 0.6 : 1 }}>
                  <td className={styles.td}>
                    <div className={styles.userCell}>
                      <div className={styles.userAvatar} style={{ 
                        background: isRevoked ? '#9ca3af' : undefined 
                      }}>
                        {u.avatar || u.name[0]}
                      </div>
                      <div>
                        <div className={styles.userName}>
                          {u.name}
                          {isSelf && (
                            <span style={{ marginLeft: '6px', fontSize: '11px', color: 'var(--color-primary, #6366f1)', fontWeight: 600 }}>
                              (You)
                            </span>
                          )}
                        </div>
                        <div className={styles.userEmail}>{u.email}</div>
                      </div>
                    </div>
                  </td>
                  <td className={styles.td}>
                    <span className={[
                      styles.roleBadge,
                      u.role === 'admin' ? styles.roleAdmin : styles.roleCashier
                    ].join(' ')} style={{
                      background: u.role === 'sales_agent' ? 'rgba(16,185,129,0.12)' :
                                  u.role === 'repair_agent' ? 'rgba(245,158,11,0.12)' : undefined,
                      color: u.role === 'sales_agent' ? '#065f46' :
                             u.role === 'repair_agent' ? '#78350f' : undefined,
                    }}>
                      {u.role === 'admin' ? 'Admin' :
                       u.role === 'sales_agent' ? '🛒 Sales Agent' :
                       u.role === 'repair_agent' ? '🔧 Repair Agent' :
                       String(u.role).replace('_', ' ').toUpperCase()}
                    </span>
                  </td>
                  <td className={styles.td}>
                    {isAdminMember ? (
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        {u.hasApprovalPin ? (
                          <span style={{ fontSize: '12px', color: '#10b981', fontWeight: 600 }}>
                            ● Configured
                          </span>
                        ) : (
                          <span style={{ fontSize: '12px', color: '#f59e0b', fontWeight: 500 }}>
                            ○ Not Set
                          </span>
                        )}
                        {canEditPin && (
                          <button
                            type="button"
                            onClick={() => { setSelectedPinUser(u); setIsPinModalOpen(true); }}
                            style={{
                              background: 'none',
                              border: 'none',
                              color: 'var(--color-primary, #6366f1)',
                              fontSize: '11px',
                              cursor: 'pointer',
                              padding: '2px 4px',
                              textDecoration: 'underline',
                            }}
                          >
                            {u.hasApprovalPin ? 'Edit' : 'Set'}
                          </button>
                        )}
                      </div>
                    ) : (
                      <span style={{ fontSize: '12px', color: '#aaa' }}>—</span>
                    )}
                  </td>
                  <td className={styles.td}>
                    {isRevoked ? (
                      <Badge variant="danger">Revoked</Badge>
                    ) : (
                      <Badge variant="success">Active</Badge>
                    )}
                  </td>
                  <td className={styles.td}>
                    <span style={{ fontSize: '13px', color: 'var(--color-on-surface-variant, #666)' }}>
                      {formatLastActive(u.lastActive)}
                    </span>
                  </td>
                  <td className={styles.td}>
                    <div style={{ display: 'flex', gap: '8px' }}>
                      {canManageTarget(u) ? (
                        <>
                          {!isRevoked && (
                            <Button
                              variant="ghost"
                              size="sm"
                              leftIcon={<Edit2 size={14} />}
                              onClick={() => setEditingMember(u)}
                            >
                              Edit
                            </Button>
                          )}
                          {isRevoked ? (
                            <Button
                              variant="ghost"
                              size="sm"
                              leftIcon={<RefreshCw size={14} />}
                              onClick={() => handleReactivate(u)}
                            >
                              Reactivate
                            </Button>
                          ) : (
                            <Button
                              variant="danger"
                              size="sm"
                              leftIcon={<ShieldOff size={14} />}
                              onClick={() => handleRevoke(u)}
                            >
                              Revoke
                            </Button>
                          )}
                        </>
                      ) : (
                        <span style={{ fontSize: '13px', color: '#aaa' }}>—</span>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
            {staff.length === 0 && (
              <tr>
                <td colSpan={6} style={{ padding: '32px', textAlign: 'center', color: '#666' }}>
                  No staff members yet. Click "Add User" to get started.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </Card>

      <NewUserModal
        isOpen={isNewUserModalOpen}
        onClose={() => setIsNewUserModalOpen(false)}
      />

      <EditUserModal
        isOpen={!!editingMember}
        onClose={() => setEditingMember(null)}
        member={editingMember}
      />

      <SetPinModal
        isOpen={isPinModalOpen}
        onClose={() => { setIsPinModalOpen(false); setSelectedPinUser(null); }}
        targetUser={selectedPinUser}
      />
    </>
  );
};
