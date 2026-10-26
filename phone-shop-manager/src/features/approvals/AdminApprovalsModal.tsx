import React, { useState } from 'react';
import {
  ShieldCheck,
  CheckCircle2,
  XCircle,
  Clock,
  User,
  AlertCircle,
  Send,
  CornerDownRight,
  ChevronRight,
  History,
  Check,
  X,
} from 'lucide-react';
import { Modal } from '../../components/ui/Modal';
import { Button } from '../../components/ui/Button';
import { Badge } from '../../components/ui/Badge';
import { useApprovalStore, type ApprovalRequest } from '../../store/approvalStore';
import { useToast } from '../../components/ui/Toast';
import { RequestDetailsCard } from './RequestDetailsCard';

interface AdminApprovalsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const AdminApprovalsModal: React.FC<AdminApprovalsModalProps> = ({ isOpen, onClose }) => {
  const { pendingRequests, recentResolved, approveRequest, rejectRequest } = useApprovalStore();
  const toast = useToast();

  const [activeTab, setActiveTab] = useState<'pending' | 'history'>('pending');
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [actionInProgress, setActionInProgress] = useState<string | null>(null);

  const handleApprove = async (request: ApprovalRequest) => {
    setActionInProgress(request.id);
    try {
      await approveRequest(request.id, 'remote');
      toast.success('Request Approved', `Approved "${request.actionLabel}" for ${request.requestedBy.name}`);
    } catch (err: any) {
      toast.error('Approval Failed', err.message);
    } finally {
      setActionInProgress(null);
    }
  };

  const handleConfirmReject = async (requestId: string) => {
    setActionInProgress(requestId);
    try {
      await rejectRequest(requestId, rejectReason);
      toast.info('Request Rejected', 'The staff member has been notified.');
      setRejectingId(null);
      setRejectReason('');
    } catch (err: any) {
      toast.error('Rejection Failed', err.message);
    } finally {
      setActionInProgress(null);
    }
  };

  const formatTimeAgo = (dateStr?: string) => {
    if (!dateStr) return '';
    const date = new Date(dateStr);
    const now = new Date();
    const diffSec = Math.floor((now.getTime() - date.getTime()) / 1000);
    if (diffSec < 60) return 'Just now';
    const diffMin = Math.floor(diffSec / 60);
    if (diffMin < 60) return `${diffMin}m ago`;
    const diffHour = Math.floor(diffMin / 60);
    if (diffHour < 24) return `${diffHour}h ago`;
    return date.toLocaleDateString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Staff Approval Requests"
      size="md"
    >
      <div style={{ padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
        
        {/* Navigation Tabs */}
        <div style={{
          display: 'flex',
          borderBottom: '1px solid var(--color-outline, #e2e8f0)',
          gap: '16px',
        }}>
          <button
            type="button"
            onClick={() => setActiveTab('pending')}
            style={{
              padding: '8px 4px 12px',
              background: 'none',
              border: 'none',
              borderBottom: activeTab === 'pending' ? '2px solid var(--color-primary, #4f46e5)' : '2px solid transparent',
              fontSize: '14px',
              fontWeight: 600,
              cursor: 'pointer',
              color: activeTab === 'pending' ? 'var(--color-primary, #4f46e5)' : 'var(--color-on-surface-variant, #64748b)',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
            }}
          >
            <span>Pending</span>
            {pendingRequests.length > 0 && (
              <span style={{
                background: '#ef4444',
                color: '#ffffff',
                fontSize: '11px',
                fontWeight: 700,
                padding: '2px 7px',
                borderRadius: '12px',
                lineHeight: 1,
              }}>
                {pendingRequests.length}
              </span>
            )}
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('history')}
            style={{
              padding: '8px 4px 12px',
              background: 'none',
              border: 'none',
              borderBottom: activeTab === 'history' ? '2px solid var(--color-primary, #4f46e5)' : '2px solid transparent',
              fontSize: '14px',
              fontWeight: 600,
              cursor: 'pointer',
              color: activeTab === 'history' ? 'var(--color-primary, #4f46e5)' : 'var(--color-on-surface-variant, #64748b)',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
            }}
          >
            <History size={15} />
            <span>Recent History</span>
          </button>
        </div>

        {/* ─── PENDING REQUESTS TAB ─── */}
        {activeTab === 'pending' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', maxHeight: '60vh', overflowY: 'auto' }}>
            {pendingRequests.length === 0 ? (
              <div style={{
                padding: '48px 20px',
                textAlign: 'center',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: '12px',
              }}>
                <div style={{
                  width: '56px',
                  height: '56px',
                  borderRadius: '50%',
                  background: 'rgba(16, 185, 129, 0.1)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: '#10b981',
                }}>
                  <CheckCircle2 size={30} />
                </div>
                <div>
                  <h4 style={{ margin: 0, fontSize: '15px', fontWeight: 600 }}>All Clear!</h4>
                  <p style={{ margin: '4px 0 0', fontSize: '13px', color: 'var(--color-on-surface-variant, #64748b)' }}>
                    No pending approval requests from staff.
                  </p>
                </div>
              </div>
            ) : (
              pendingRequests.map((req) => (
                <div
                  key={req.id}
                  style={{
                    padding: '16px',
                    borderRadius: '12px',
                    border: '1px solid var(--color-outline, #e2e8f0)',
                    background: 'var(--color-surface, #ffffff)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '12px',
                    boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
                  }}
                >
                  {/* Request Details: Worker Identity, Target Product / Item, and Reason */}
                  <RequestDetailsCard
                    actionLabel={req.actionLabel}
                    actionType={req.actionType}
                    actionData={req.actionData}
                    requestedBy={req.requestedBy}
                    requestedAt={req.requestedAt}
                    reason={req.reason}
                  />

                  {/* Reject reason input prompt if active */}
                  {rejectingId === req.id ? (
                    <div style={{
                      padding: '12px',
                      background: 'rgba(239, 68, 68, 0.05)',
                      border: '1px solid rgba(239, 68, 68, 0.2)',
                      borderRadius: '8px',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '8px',
                    }}>
                      <div style={{ fontSize: '12px', fontWeight: 600, color: '#b91c1c' }}>
                        Reason for rejection (sent to staff):
                      </div>
                      <input
                        type="text"
                        placeholder="e.g. Discount too high, manager approval needed"
                        value={rejectReason}
                        onChange={(e) => setRejectReason(e.target.value)}
                        autoFocus
                        style={{
                          width: '100%',
                          padding: '8px 10px',
                          fontSize: '13px',
                          borderRadius: '6px',
                          border: '1px solid rgba(239,68,68,0.3)',
                          outline: 'none',
                          boxSizing: 'border-box',
                        }}
                      />
                      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => { setRejectingId(null); setRejectReason(''); }}
                        >
                          Cancel
                        </Button>
                        <Button
                          size="sm"
                          variant="danger"
                          onClick={() => handleConfirmReject(req.id)}
                          isLoading={actionInProgress === req.id}
                        >
                          Confirm Reject
                        </Button>
                      </div>
                    </div>
                  ) : (
                    /* Approval & Rejection Action Buttons */
                    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '4px' }}>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => { setRejectingId(req.id); setRejectReason(''); }}
                        disabled={actionInProgress === req.id}
                        leftIcon={<X size={14} />}
                        style={{ color: '#ef4444' }}
                      >
                        Reject
                      </Button>
                      <Button
                        size="sm"
                        variant="primary"
                        onClick={() => handleApprove(req)}
                        isLoading={actionInProgress === req.id}
                        leftIcon={<Check size={14} />}
                        style={{ background: '#10b981', borderColor: '#10b981' }}
                      >
                        Approve
                      </Button>
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        )}

        {/* ─── RECENT HISTORY TAB ─── */}
        {activeTab === 'history' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', maxHeight: '60vh', overflowY: 'auto' }}>
            {recentResolved.length === 0 ? (
              <div style={{ padding: '32px', textAlign: 'center', color: 'var(--color-on-surface-variant, #64748b)', fontSize: '13px' }}>
                No past approval history recorded.
              </div>
            ) : (
              recentResolved.map((req) => (
                <div
                  key={req.id}
                  style={{
                    padding: '12px 14px',
                    borderRadius: '8px',
                    border: '1px solid var(--color-outline, #e2e8f0)',
                    background: 'var(--color-surface, #ffffff)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '6px',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      {req.status === 'approved' ? (
                        <CheckCircle2 size={16} style={{ color: '#10b981', flexShrink: 0 }} />
                      ) : (
                        <XCircle size={16} style={{ color: '#ef4444', flexShrink: 0 }} />
                      )}
                      <span style={{ fontSize: '13px', fontWeight: 600 }}>
                        {req.actionLabel}
                      </span>
                    </div>

                    <span style={{
                      fontSize: '11px',
                      fontWeight: 700,
                      textTransform: 'uppercase',
                      padding: '2px 6px',
                      borderRadius: '4px',
                      background: req.status === 'approved' ? 'rgba(16,185,129,0.1)' : 'rgba(239,68,68,0.1)',
                      color: req.status === 'approved' ? '#10b981' : '#ef4444',
                    }}>
                      {req.status}
                    </span>
                  </div>

                  <RequestDetailsCard
                    actionLabel={req.actionLabel}
                    actionType={req.actionType}
                    actionData={req.actionData}
                    requestedBy={req.requestedBy}
                    requestedAt={req.requestedAt}
                    compact={true}
                  />

                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: 'var(--color-on-surface-variant, #64748b)', borderTop: '1px solid var(--color-outline, #f1f5f9)', paddingTop: '6px' }}>
                    <span>Worker: <strong>{req.requestedBy.name}</strong></span>
                    <span>Resolved by <strong>{req.resolvedBy?.name || 'Admin'}</strong> • {formatTimeAgo(req.resolvedAt)}</span>
                  </div>

                  {req.rejectionReason && (
                    <div style={{ fontSize: '11px', color: '#b91c1c', fontStyle: 'italic', background: 'rgba(239,68,68,0.06)', padding: '4px 8px', borderRadius: '4px' }}>
                      Reason: {req.rejectionReason}
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        )}

      </div>
    </Modal>
  );
};
