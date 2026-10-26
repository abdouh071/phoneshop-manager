import React, { useState, useEffect, useRef } from 'react';
import { KeyRound, Send, CheckCircle2, XCircle, Loader2, ShieldCheck, Lock, AlertCircle, ArrowLeft } from 'lucide-react';
import { Modal } from './Modal';
import { Button } from './Button';
import { Input } from './Input';
import { useAuthStore } from '../../store/authStore';
import { useApprovalStore, type ApprovalRequest } from '../../store/approvalStore';
import { useActivityStore } from '../../store/activityStore';
import { useToast } from './Toast';
import { RequestDetailsCard } from '../../features/approvals/RequestDetailsCard';

export interface ApprovalModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (data?: any) => void;
  actionName?: string;
  actionType?: string;
  actionData?: Record<string, any>;
  targetId?: string;
}

export const ApprovalModal: React.FC<ApprovalModalProps> = ({
  isOpen,
  onClose,
  onSuccess,
  actionName = 'perform this restricted action',
  actionType = 'system_action',
  actionData,
  targetId,
}) => {
  const { user, unlockHistory } = useAuthStore();
  const { verifyPin, submitRequest, cancelRequest, subscribeToSingleRequest } = useApprovalStore();
  const { logActivity } = useActivityStore();
  const toast = useToast();

  type TabMode = 'pin' | 'remote' | 'password';
  const [activeTab, setActiveTab] = useState<TabMode>('pin');

  // PIN state
  const [pin, setPin] = useState('');
  const [pinLoading, setPinLoading] = useState(false);
  const [pinError, setPinError] = useState('');
  const [noPinConfigured, setNoPinConfigured] = useState(false);
  const pinInputRef = useRef<HTMLInputElement>(null);

  // Security: Brute-force lockout state
  const [failedAttempts, setFailedAttempts] = useState(0);
  const [lockoutRemaining, setLockoutRemaining] = useState(0);

  useEffect(() => {
    if (lockoutRemaining <= 0) return;
    const timer = setInterval(() => {
      setLockoutRemaining((prev) => Math.max(0, prev - 1));
    }, 1000);
    return () => clearInterval(timer);
  }, [lockoutRemaining]);

  // Remote state
  const [remoteReason, setRemoteReason] = useState('');
  const [isSubmittingRemote, setIsSubmittingRemote] = useState(false);
  const [activeRequestId, setActiveRequestId] = useState<string | null>(null);
  const [remoteRequest, setRemoteRequest] = useState<ApprovalRequest | null>(null);

  // Password fallback state
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [passLoading, setPassLoading] = useState(false);
  const [passError, setPassError] = useState('');

  // Reset state when opening
  useEffect(() => {
    if (isOpen) {
      setPin('');
      setPinError('');
      setNoPinConfigured(false);
      setActiveTab('pin');
      setRemoteReason('');
      setIsSubmittingRemote(false);
      setActiveRequestId(null);
      setRemoteRequest(null);
      setEmail('');
      setPassword('');
      setPassError('');
      setTimeout(() => {
        pinInputRef.current?.focus();
      }, 100);
    }
  }, [isOpen]);

  // Subscribe to active remote request changes
  useEffect(() => {
    if (!isOpen || !activeRequestId) return;

    const unsubscribe = subscribeToSingleRequest(activeRequestId, (req) => {
      setRemoteRequest(req);
      if (req.status === 'approved') {
        toast.success('Approved by Admin', `Action approved by ${req.resolvedBy?.name || 'Admin'}`);
        setTimeout(() => {
          onSuccess({ method: 'remote', approvedBy: req.resolvedBy });
          onClose();
        }, 600);
      } else if (req.status === 'rejected') {
        toast.error('Request Rejected', req.rejectionReason || 'The administrator rejected this request.');
      }
    });

    return () => {
      unsubscribe();
    };
  }, [isOpen, activeRequestId, subscribeToSingleRequest, onSuccess, onClose, toast]);

  // Handle PIN verification
  const handlePinSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pin || lockoutRemaining > 0) return;
    setPinLoading(true);
    setPinError('');
    setNoPinConfigured(false);

    try {
      const result = await verifyPin(pin);
      if (result.success) {
        setFailedAttempts(0);
        logActivity('system', `Admin approved action via PIN: "${actionName}"`, {
          adminName: result.adminName,
          adminId: result.adminId,
          activeUser: user?.name,
          actionName,
        });

        toast.success('Authorization Verified', `Approved by ${result.adminName}`);
        setPin('');
        onSuccess({ method: 'pin', approvedBy: result.adminName });
        onClose();
      } else {
        if (result.noPinConfigured) {
          setNoPinConfigured(true);
          setPinError(result.error || 'No administrator has configured an approval PIN yet.');
        } else {
          const nextAttempts = failedAttempts + 1;
          setFailedAttempts(nextAttempts);
          if (nextAttempts >= 5) {
            setLockoutRemaining(60);
            logActivity('system', `⚠️ Security Alert: 5 consecutive failed Admin PIN attempts for "${actionName}" by ${user?.name || 'Staff'}`);
            setPinError('Too many failed attempts. PIN verification is locked for 60 seconds.');
          } else if (nextAttempts >= 3) {
            setLockoutRemaining(30);
            setPinError('3 failed attempts. Please wait 30 seconds or use Remote Request.');
          } else {
            setPinError(result.error || `Invalid approval PIN (${3 - nextAttempts} attempt${3 - nextAttempts > 1 ? 's' : ''} remaining).`);
          }
        }
      }
    } catch (err: any) {
      setPinError(err.message || 'Failed to verify PIN.');
    } finally {
      setPinLoading(false);
    }
  };

  // Handle Remote Request Submission
  const handleRemoteSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmittingRemote(true);
    try {
      const reqId = await submitRequest({
        actionType,
        actionLabel: actionName,
        actionData,
        targetId,
        reason: remoteReason,
      });
      setActiveRequestId(reqId);
      toast.info('Request Sent', 'Administrators have been notified on their devices.');
    } catch (err: any) {
      toast.error('Failed to Send Request', err.message);
    } finally {
      setIsSubmittingRemote(false);
    }
  };

  // Cancel pending remote request
  const handleCancelRemote = async () => {
    if (activeRequestId) {
      try {
        await cancelRequest(activeRequestId);
        setActiveRequestId(null);
        setRemoteRequest(null);
        toast.info('Request Cancelled', 'The approval request was cancelled.');
      } catch (err) {
        console.error('Failed to cancel request:', err);
      }
    }
  };

  // Password fallback submission
  const handlePasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) return;
    setPassLoading(true);
    setPassError('');

    try {
      await unlockHistory(email, password);
      logActivity('system', `Terminal unlocked via password to ${actionName}`, {
        adminEmail: email,
        activeUser: user?.name,
      });

      setPassword('');
      setEmail('');
      toast.success('Admin Verified', 'Authorization granted via password.');
      onSuccess({ method: 'password', adminEmail: email });
      onClose();
    } catch (err: any) {
      setPassError(err.message || 'Incorrect admin email or password.');
    } finally {
      setPassLoading(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={() => {
        if (activeRequestId && remoteRequest?.status === 'pending') {
          cancelRequest(activeRequestId).catch(console.error);
        }
        onClose();
      }}
      title="Admin Authorization Required"
      size="md"
    >
      <div style={{ padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
        
        {/* Action Description Banner */}
        <div style={{
          padding: '12px 14px',
          background: 'var(--color-surface-variant, #f1f5f9)',
          border: '1px solid var(--color-outline, #e2e8f0)',
          borderRadius: '10px',
          display: 'flex',
          alignItems: 'flex-start',
          gap: '10px'
        }}>
          <ShieldCheck size={20} style={{ color: 'var(--color-primary, #4f46e5)', marginTop: '2px', flexShrink: 0 }} />
          <div>
            <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--color-on-surface-variant, #64748b)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              Restricted Action
            </div>
            <div style={{ fontSize: '14px', fontWeight: 600, color: 'var(--color-on-surface, #0f172a)', marginTop: '2px' }}>
              {actionName}
            </div>
          </div>
        </div>

        {/* Tab Switcher (Only when not actively waiting for remote approval and not in password mode) */}
        {!activeRequestId && activeTab !== 'password' && (
          <div style={{
            display: 'flex',
            background: 'var(--color-surface-variant, #f1f5f9)',
            padding: '4px',
            borderRadius: '10px',
            gap: '4px',
          }}>
            <button
              type="button"
              onClick={() => { setActiveTab('pin'); setTimeout(() => pinInputRef.current?.focus(), 50); }}
              style={{
                flex: 1,
                padding: '8px 12px',
                border: 'none',
                borderRadius: '8px',
                fontSize: '13px',
                fontWeight: 600,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '6px',
                transition: 'all 0.15s ease',
                background: activeTab === 'pin' ? 'var(--color-surface, #ffffff)' : 'transparent',
                color: activeTab === 'pin' ? 'var(--color-primary, #4f46e5)' : 'var(--color-on-surface-variant, #64748b)',
                boxShadow: activeTab === 'pin' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
              }}
            >
              <KeyRound size={15} />
              Quick PIN
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('remote')}
              style={{
                flex: 1,
                padding: '8px 12px',
                border: 'none',
                borderRadius: '8px',
                fontSize: '13px',
                fontWeight: 600,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '6px',
                transition: 'all 0.15s ease',
                background: activeTab === 'remote' ? 'var(--color-surface, #ffffff)' : 'transparent',
                color: activeTab === 'remote' ? 'var(--color-primary, #4f46e5)' : 'var(--color-on-surface-variant, #64748b)',
                boxShadow: activeTab === 'remote' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
              }}
            >
              <Send size={15} />
              Remote Request
            </button>
          </div>
        )}

        {/* ─── TAB 1: QUICK PIN (IN-PERSON) ─── */}
        {activeTab === 'pin' && (
          <form onSubmit={handlePinSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            <p style={{ margin: 0, fontSize: '13px', color: 'var(--color-on-surface-variant, #64748b)', lineHeight: 1.4 }}>
              Admin is present? Enter your <strong>Approval PIN</strong> to instantly authorize without sharing your login password.
            </p>

            {noPinConfigured && (
              <div style={{
                padding: '10px 12px',
                background: 'rgba(245, 158, 11, 0.1)',
                border: '1px solid rgba(245, 158, 11, 0.3)',
                borderRadius: '8px',
                fontSize: '12px',
                color: '#b45309',
                display: 'flex',
                alignItems: 'center',
                gap: '8px'
              }}>
                <AlertCircle size={16} style={{ flexShrink: 0 }} />
                <span>
                  No Admin PIN set up yet. An admin can set one in <strong>Settings → Staff</strong>, or use Password fallback below.
                </span>
              </div>
            )}

            {lockoutRemaining > 0 && (
              <div style={{
                padding: '10px 12px',
                background: 'rgba(239, 68, 68, 0.1)',
                border: '1px solid rgba(239, 68, 68, 0.3)',
                borderRadius: '8px',
                fontSize: '12px',
                color: '#dc2626',
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                fontWeight: 600
              }}>
                <Lock size={16} style={{ flexShrink: 0 }} />
                <span>
                  Too many incorrect attempts. PIN entry locked for <strong>{lockoutRemaining}s</strong>. Use Remote Request if urgent.
                </span>
              </div>
            )}

            <div>
              <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: 'var(--color-on-surface-variant, #64748b)', marginBottom: '6px' }}>
                Admin 4-8 Digit PIN
              </label>
              <input
                ref={pinInputRef}
                type="password"
                inputMode="numeric"
                pattern="[0-9]*"
                maxLength={8}
                disabled={lockoutRemaining > 0}
                value={pin}
                onChange={(e) => {
                  const val = e.target.value.replace(/\D/g, '');
                  setPin(val);
                  setPinError('');
                }}
                placeholder="••••"
                style={{
                  width: '100%',
                  padding: '12px 16px',
                  fontSize: '24px',
                  letterSpacing: '8px',
                  textAlign: 'center',
                  borderRadius: '10px',
                  border: pinError ? '2px solid #ef4444' : '1px solid var(--color-outline, #cbd5e1)',
                  background: lockoutRemaining > 0 ? '#f1f5f9' : 'var(--color-surface, #ffffff)',
                  color: 'var(--color-on-surface, #0f172a)',
                  outline: 'none',
                  boxSizing: 'border-box',
                  opacity: lockoutRemaining > 0 ? 0.6 : 1,
                }}
                autoFocus
              />
              {pinError && (
                <div style={{ color: '#ef4444', fontSize: '12px', marginTop: '6px', textAlign: 'center' }}>
                  {pinError}
                </div>
              )}
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '4px' }}>
              <Button type="button" variant="ghost" onClick={onClose} disabled={pinLoading}>
                Cancel
              </Button>
              <Button type="submit" isLoading={pinLoading} disabled={pin.length < 4 || lockoutRemaining > 0}>
                Approve via PIN
              </Button>
            </div>
          </form>
        )}

        {/* ─── TAB 2: REMOTE APPROVAL REQUEST ─── */}
        {activeTab === 'remote' && (
          <div>
            {!activeRequestId ? (
              <form onSubmit={handleRemoteSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                <p style={{ margin: 0, fontSize: '13px', color: 'var(--color-on-surface-variant, #64748b)', lineHeight: 1.4 }}>
                  Admin is away? Send a live authorization notification with product and staff details to all store administrators.
                </p>

                {/* Worker & Target Item Details Preview */}
                <RequestDetailsCard
                  actionLabel={actionName}
                  actionType={actionType}
                  actionData={actionData}
                  requestedBy={user ? {
                    uid: user.id,
                    name: user.name,
                    email: user.email,
                    role: user.role,
                    avatar: user.avatar,
                  } : undefined}
                />

                <div>
                  <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: 'var(--color-on-surface-variant, #64748b)', marginBottom: '6px' }}>
                    Reason / Customer Note (Optional)
                  </label>
                  <Input
                    placeholder="e.g. Customer asks for 10% off or special price match"
                    value={remoteReason}
                    onChange={(e) => setRemoteReason(e.target.value)}
                  />
                </div>

                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '4px' }}>
                  <Button type="button" variant="ghost" onClick={onClose} disabled={isSubmittingRemote}>
                    Cancel
                  </Button>
                  <Button type="submit" isLoading={isSubmittingRemote} leftIcon={<Send size={15} />}>
                    Send to Admin Screen
                  </Button>
                </div>
              </form>
            ) : (
              <div style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                textAlign: 'center',
                padding: '16px 8px',
                gap: '14px',
              }}>
                {remoteRequest?.status === 'approved' ? (
                  <>
                    <CheckCircle2 size={52} style={{ color: '#10b981', animation: 'scaleUp 0.3s ease' }} />
                    <div style={{ fontSize: '16px', fontWeight: 700, color: '#10b981' }}>
                      Authorization Approved!
                    </div>
                    <p style={{ fontSize: '13px', color: 'var(--color-on-surface-variant, #64748b)', margin: 0 }}>
                      Approved by <strong>{remoteRequest.resolvedBy?.name || 'Admin'}</strong>. Resuming action...
                    </p>
                  </>
                ) : remoteRequest?.status === 'rejected' ? (
                  <>
                    <XCircle size={52} style={{ color: '#ef4444' }} />
                    <div style={{ fontSize: '16px', fontWeight: 700, color: '#ef4444' }}>
                      Request Rejected
                    </div>
                    <div style={{
                      padding: '10px 14px',
                      background: 'rgba(239, 68, 68, 0.08)',
                      borderRadius: '8px',
                      fontSize: '13px',
                      color: '#b91c1c',
                      maxWidth: '100%',
                    }}>
                      {remoteRequest.rejectionReason || 'No reason provided.'}
                    </div>
                    <Button variant="secondary" onClick={onClose} style={{ marginTop: '8px' }}>
                      Dismiss
                    </Button>
                  </>
                ) : (
                  <>
                    <div style={{
                      position: 'relative',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      width: '64px',
                      height: '64px',
                    }}>
                      <div style={{
                        position: 'absolute',
                        width: '100%',
                        height: '100%',
                        borderRadius: '50%',
                        border: '3px solid var(--color-primary, #4f46e5)',
                        opacity: 0.3,
                        animation: 'pulseRing 1.8s cubic-bezier(0.215, 0.61, 0.355, 1) infinite',
                      }} />
                      <Loader2 size={32} style={{ color: 'var(--color-primary, #4f46e5)', animation: 'spin 1.2s linear infinite' }} />
                    </div>

                    <div>
                      <div style={{ fontSize: '15px', fontWeight: 700, color: 'var(--color-on-surface, #0f172a)' }}>
                        Waiting for Admin Approval...
                      </div>
                      <p style={{ fontSize: '12px', color: 'var(--color-on-surface-variant, #64748b)', marginTop: '4px', marginBottom: 0 }}>
                        Admins have received a live alert on their screen.
                      </p>
                    </div>

                    <div style={{ width: '100%', textAlign: 'left' }}>
                      <RequestDetailsCard
                        actionLabel={actionName}
                        actionType={actionType}
                        actionData={actionData}
                        requestedBy={user ? {
                          uid: user.id,
                          name: user.name,
                          email: user.email,
                          role: user.role,
                          avatar: user.avatar,
                        } : undefined}
                        reason={remoteReason}
                        compact={true}
                      />
                    </div>

                    <div style={{ display: 'flex', gap: '8px', marginTop: '6px' }}>
                      <Button variant="ghost" size="sm" onClick={handleCancelRemote}>
                        Cancel Request
                      </Button>
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        )}

        {/* ─── TAB 3: PASSWORD FALLBACK ─── */}
        {activeTab === 'password' && (
          <form onSubmit={handlePasswordSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <button
                type="button"
                onClick={() => setActiveTab('pin')}
                style={{
                  background: 'transparent',
                  border: 'none',
                  cursor: 'pointer',
                  padding: '4px',
                  display: 'flex',
                  alignItems: 'center',
                  color: 'var(--color-primary, #4f46e5)',
                }}
              >
                <ArrowLeft size={16} />
              </button>
              <span style={{ fontSize: '13px', fontWeight: 600 }}>Back to PIN / Remote</span>
            </div>

            <p style={{ margin: 0, fontSize: '12px', color: 'var(--color-on-surface-variant, #64748b)' }}>
              Emergency fallback: authenticate using full administrator login credentials.
            </p>

            <Input
              label="Admin Email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoFocus
            />

            <Input
              label="Admin Password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              error={passError}
              required
            />

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '4px' }}>
              <Button type="button" variant="ghost" onClick={onClose} disabled={passLoading}>
                Cancel
              </Button>
              <Button type="submit" isLoading={passLoading}>
                Unlock via Password
              </Button>
            </div>
          </form>
        )}

        {/* Footer fallback switch */}
        {activeTab !== 'password' && !activeRequestId && (
          <div style={{
            borderTop: '1px solid var(--color-outline, #f1f5f9)',
            paddingTop: '10px',
            display: 'flex',
            justifyContent: 'center',
          }}>
            <button
              type="button"
              onClick={() => setActiveTab('password')}
              style={{
                background: 'transparent',
                border: 'none',
                color: 'var(--color-on-surface-variant, #94a3b8)',
                fontSize: '11px',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '4px',
                textDecoration: 'underline',
              }}
            >
              <Lock size={12} />
              Need to use full Admin Password instead?
            </button>
          </div>
        )}
      </div>

      <style>{`
        @keyframes pulseRing {
          0% { transform: scale(0.9); opacity: 0.8; }
          50% { transform: scale(1.3); opacity: 0.2; }
          100% { transform: scale(1.6); opacity: 0; }
        }
        @keyframes scaleUp {
          from { transform: scale(0.5); opacity: 0; }
          to { transform: scale(1); opacity: 1; }
        }
      `}</style>
    </Modal>
  );
};
