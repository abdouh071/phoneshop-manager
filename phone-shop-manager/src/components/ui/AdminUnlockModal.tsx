import React from 'react';
import { ApprovalModal, type ApprovalModalProps } from './ApprovalModal';

export interface AdminUnlockModalProps extends ApprovalModalProps {}

/**
 * AdminUnlockModal (Upgraded to Hybrid Approval Modal)
 * Provides:
 * 1. Admin present: Fast 4-6 digit numeric PIN on worker screen (never reveals login password)
 * 2. Admin away: Real-time remote approval push notification to admin device
 * 3. Fallback: Full admin credentials unlock
 */
export const AdminUnlockModal: React.FC<AdminUnlockModalProps> = (props) => {
  return <ApprovalModal {...props} />;
};

export default AdminUnlockModal;
