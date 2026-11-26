// @vitest-environment jsdom
/**
 * Phase 6 TDD Tests — Settings save feedback & draft preservation
 * + RepairSettlementModal queued vs synced vs error distinction.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { RepairTicket } from '../../types';

const state = vi.hoisted(() => ({
  saveResult: true,
  receiptHeader: 'Original Header',
  receiptFooter: 'Original Footer',
  labelFont: '2' as '1' | '2',
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
  toastInfo: vi.fn(),
  toastWarning: vi.fn(),
  updateSetting: vi.fn(),
  updateSettingsBulk: vi.fn(),
  setTechnicianRate: vi.fn(),
  updateTicket: vi.fn(),
  updateDebtAmount: vi.fn(),
  recordDebtPayment: vi.fn(),
  addDebt: vi.fn(),
  onSettled: vi.fn(),
  onClose: vi.fn(),
}));

vi.mock('../../components/ui/Toast', () => ({
  useToast: () => ({
    success: state.toastSuccess,
    error: state.toastError,
    info: state.toastInfo,
    warning: state.toastWarning,
  }),
}));

vi.mock('react-i18next', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    useTranslation: () => ({ t: (_k: string, d?: string) => d || _k }),
  };
});

vi.mock('../../store/settingsStore', () => {
  const getMockSettings = () => ({
    receiptHeader: state.receiptHeader,
    receiptFooter: state.receiptFooter,
    storeName: 'Test Shop',
    currency: 'DZD',
    logoUrl: '',
    receiptPaperWidth: '80mm',
    autoCutReceipt: true,
    labelFont: state.labelFont,
    technicianProfitPercentage: 50,
    technicianRates: {},
    error: 'Firestore write rejected',
    updateSetting: state.updateSetting,
    updateSettingsBulk: state.updateSettingsBulk,
    setTechnicianRate: state.setTechnicianRate,
    getTechnicianRate: () => 50,
  });
  return {
    useSettingsStore: Object.assign(
      (sel?: (s: ReturnType<typeof getMockSettings>) => unknown) => {
        const s = getMockSettings();
        return typeof sel === 'function' ? sel(s) : s;
      },
      { getState: () => ({ currency: 'DZD', getTechnicianRate: () => 50 }) }
    ),
  };
});

vi.mock('../../hooks/usePrinterStatus', () => ({
  usePrinterStatus: () => ({
    isOnline: false,
    printer: null,
    labelPrinter: null,
    hasCutter: false,
    isChecking: false,
    refresh: vi.fn(),
  }),
}));

vi.mock('../../store/repairStore', () => ({
  useRepairStore: Object.assign(
    () => ({
      tickets: [],
      updateTicket: state.updateTicket,
    }),
    { getState: () => ({ tickets: [], updateTicket: state.updateTicket }) }
  ),
}));

vi.mock('../../store/customerStore', () => ({
  useCustomerStore: Object.assign(
    () => ({
      customers: [],
      findOrCreateCustomer: vi.fn(async () => null),
      updateCustomer: vi.fn(async () => undefined),
      addDebt: state.addDebt,
      updateDebtAmount: state.updateDebtAmount,
      recordDebtPayment: state.recordDebtPayment,
      recalculateCustomer: vi.fn(async () => undefined),
    }),
    {
      getState: () => ({
        enrichCustomer: vi.fn(async () => undefined),
      }),
    }
  ),
}));

vi.mock('../../store/authStore', () => ({
  useAuthStore: () => ({ user: { id: 'u1', name: 'Counter', role: 'sales' }, staff: [], fetchStaff: vi.fn() }),
}));

vi.mock('../../services/activityLogService', () => ({ activityLogService: { log: vi.fn(async () => undefined) } }));
vi.mock('../../services/customerLogService', () => ({ customerLogService: { log: vi.fn(async () => undefined) } }));
vi.mock('../../services/offlineQueue', () => ({ offlineQueue: { getPendingCount: () => 0 } }));

import { ReceiptTab } from './ReceiptTab';
import { PrintersTab } from './PrintersTab';
import { TechnicianSettlementsTab } from '../repairs/TechnicianSettlementsTab';
import { RepairSettlementModal } from '../repairs/RepairSettlementModal';

const TICKET: RepairTicket = {
  id: 'tkt_srv_1',
  ticketNumber: 'TKT-0101',
  customerName: 'Samir',
  customerPhone: '0550112233',
  deviceBrand: 'Samsung',
  deviceModel: 'A54',
  issueDescription: 'Screen',
  estimatedCost: 4000,
  status: 'ready',
  createdAt: '2026-11-10T10:00:00.000Z',
  updatedAt: '2026-11-10T10:00:00.000Z',
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('navigator', { onLine: true });
  state.saveResult = true;
  state.receiptHeader = 'Original Header';
  state.receiptFooter = 'Original Footer';
  state.updateSetting.mockImplementation(async () => state.saveResult);
  state.updateSettingsBulk.mockImplementation(async () => state.saveResult);
  state.setTechnicianRate.mockImplementation(async () => state.saveResult);
  state.updateTicket.mockImplementation(async (_id: string, _u: unknown, opts?: { onOutcome?: (o: 'committed' | 'queued') => void }) => {
    opts?.onOutcome?.('committed');
  });
  state.updateDebtAmount.mockResolvedValue({});
  state.recordDebtPayment.mockResolvedValue({});
  state.addDebt.mockResolvedValue({ id: 'debt_srv_1' });
});

afterEach(cleanup);

describe('Phase 6 — Settings failed-save feedback & draft preservation', () => {
  it('ReceiptTab rejects failed save with error toast and preserves typed draft across snapshot re-renders', async () => {
    state.saveResult = false;
    const { rerender } = render(<ReceiptTab />);

    const headerInput = screen.getByLabelText('Header Message') as HTMLTextAreaElement;
    fireEvent.change(headerInput, { target: { value: 'Drafted New Header' } });
    expect(headerInput.value).toBe('Drafted New Header');

    // Simulate external snapshot update arriving while user is actively editing
    state.receiptHeader = 'Remote Snapshot Header';
    rerender(<ReceiptTab />);
    expect((screen.getByLabelText('Header Message') as HTMLTextAreaElement).value).toBe('Drafted New Header');

    fireEvent.click(screen.getByRole('button', { name: /Save Receipt Settings/i }));
    await waitFor(() => expect(state.updateSettingsBulk).toHaveBeenCalledTimes(1));

    expect(state.toastSuccess).not.toHaveBeenCalled();
    expect(state.toastError).toHaveBeenCalled();
    expect((screen.getByLabelText('Header Message') as HTMLTextAreaElement).value).toBe('Drafted New Header');
  });

  it('PrintersTab announces error and never success when save returns false', async () => {
    state.saveResult = false;
    render(<PrintersTab />);

    fireEvent.click(screen.getByRole('button', { name: /Save Printer Preferences/i }));
    await waitFor(() => expect(state.updateSettingsBulk).toHaveBeenCalledTimes(1));
    expect(state.toastSuccess).not.toHaveBeenCalled();
    expect(state.toastError).toHaveBeenCalled();

    state.toastError.mockClear();
    fireEvent.click(screen.getByRole('button', { name: /Save Font Preference/i }));
    await waitFor(() => expect(state.updateSetting).toHaveBeenCalledTimes(1));
    expect(state.toastSuccess).not.toHaveBeenCalled();
    expect(state.toastError).toHaveBeenCalled();
  });

  it('TechnicianSettlementsTab does not flash saved badge when updateSetting returns false', async () => {
    state.saveResult = false;
    render(<TechnicianSettlementsTab />);

    fireEvent.click(screen.getByRole('button', { name: '40%' }));
    await waitFor(() => expect(state.updateSetting).toHaveBeenCalledTimes(1));
    expect(screen.queryByText(/Saved to cloud/i)).toBeNull();
    expect(state.toastError).toHaveBeenCalled();
  });
});

describe('Phase 6 — RepairSettlementModal queued vs synced vs failed distinction', () => {
  it('announces queued offline status rather than confirmed completion when offline or ticket update is queued', async () => {
    vi.stubGlobal('navigator', { onLine: false });
    state.updateTicket.mockImplementationOnce(async (_id: string, _u: unknown, opts?: { onOutcome?: (o: 'committed' | 'queued') => void }) => {
      opts?.onOutcome?.('queued');
    });

    render(
      <RepairSettlementModal isOpen ticket={TICKET} onClose={state.onClose} onSettled={state.onSettled} />
    );

    fireEvent.click(screen.getByRole('button', { name: /Confirm Handover/i }));
    await waitFor(() => expect(state.updateTicket).toHaveBeenCalledTimes(1));

    expect(state.toastSuccess).not.toHaveBeenCalled();
    expect(state.toastInfo.mock.calls.length + state.toastWarning.mock.calls.length).toBeGreaterThan(0);
    const msg = [...state.toastInfo.mock.calls, ...state.toastWarning.mock.calls].flat().join(' ');
    expect(msg.toLowerCase()).toContain('queue');
  });

  it('fails loudly instead of swallowing errors on an existing debt update', async () => {
    state.updateDebtAmount.mockRejectedValueOnce(new Error('Debt entry missing or offline'));
    render(
      <RepairSettlementModal
        isOpen
        ticket={{ ...TICKET, debtEntryId: 'debt_missing' }}
        onClose={state.onClose}
        onSettled={state.onSettled}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /Confirm Handover/i }));
    await waitFor(() => expect(state.toastError).toHaveBeenCalled());
    expect(state.updateTicket).not.toHaveBeenCalled();
    expect(state.toastSuccess).not.toHaveBeenCalled();
    expect(state.onClose).not.toHaveBeenCalled();
  });
});
