import React, { useEffect, useState } from 'react';
import { Card, CardHeader } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Badge } from '../../components/ui/Badge';
import { Edit2, UserX, UserPlus, RefreshCw, ShieldOff, Smartphone } from 'lucide-react';
import { useAuthStore } from '../../store/authStore';
import type { User } from '../../store/authStore';
import { NewUserModal } from './NewUserModal';
import { EditUserModal } from './EditUserModal';
import { useToast } from '../../components/ui/Toast';
import styles from './Settings.module.css';

export const UsersTab = () => {
  const { user, staff, fetchStaff, updateStaffMember, isSuperAdmin } = useAuthStore();
  const toast = useToast();
  const [isNewUserModalOpen, setIsNewUserModalOpen] = useState(false);
  const [editingMember, setEditingMember] = useState<User | null>(null);

  useEffect(() => {
    fetchStaff();
  }, [fetchStaff]);

  const isUserAdmin = user?.role === 'admin';

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
    } catch (err: any) {
      toast.error('Error', err.message);
    }
  };

  const handleReactivate = async (member: User) => {
    try {
      await updateStaffMember(member.id, { status: 'active' });
      toast.success('Account Reactivated', `${member.name} can now log in again.`);
    } catch (err: any) {
      toast.error('Error', err.message);
    }
  };

  const formatLastActive = (lastActive: any) => {
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
      <Card padding="none">
        <div className={styles.cardHeaderWithExport}>
          <CardHeader
            title="Staff & Users"
            subtitle={`${staff.filter(s => s.status !== 'revoked').length} active member${staff.filter(s => s.status !== 'revoked').length !== 1 ? 's' : ''}`}
          />
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <a
              href="/downloads/Auto-Manager.apk"
              download="Auto-Manager.apk"
              style={{ textDecoration: 'none' }}
              title="Download Android APK for technicians"
            >
              <Button
                variant="secondary"
                size="sm"
                leftIcon={<Smartphone size={16} />}
              >
                Download Technician App (.APK)
              </Button>
            </a>
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
              <th className={styles.th}>Status</th>
              <th className={styles.th}>Last Active</th>
              <th className={styles.th}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {staff.map((u) => {
              const isRevoked = u.status === 'revoked';
              const isSelf = u.id === user?.id;
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
                <td colSpan={5} style={{ padding: '32px', textAlign: 'center', color: '#666' }}>
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
    </>
  );
};
