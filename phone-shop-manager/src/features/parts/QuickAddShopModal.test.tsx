// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { AdminUnlockModalProps } from '../../components/ui/AdminUnlockModal';
import { QuickAddShopModal } from './QuickAddShopModal';

const fake = vi.hoisted(() => ({
  role: 'sales',
  addCustomer: vi.fn(),
  success: vi.fn(),
  close: vi.fn(),
  created: vi.fn(),
}));

vi.mock('../../store/customerStore', () => ({ useCustomerStore: () => ({ addCustomer: fake.addCustomer }) }));
vi.mock('../../store/authStore', () => ({ useAuthStore: () => ({ user: { role: fake.role } }) }));
vi.mock('../../components/ui/Toast', () => ({ useToast: () => ({ success: fake.success }) }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('../../components/ui/AdminUnlockModal', () => ({
  AdminUnlockModal: ({ isOpen, onSuccess, onClose }: AdminUnlockModalProps) => isOpen ? (
    <div role="dialog" aria-label="Test approval">
      <button onClick={() => onSuccess()}>Approve fixture</button>
      <button onClick={onClose}>Cancel approval</button>
    </div>
  ) : null,
}));

const field = (name: string) => screen.getByLabelText(`parts.quickAdd.${name}`) as HTMLInputElement;
const change = (name: string, value: string) => fireEvent.change(field(name), { target: { value } });
const submit = () => fireEvent.click(screen.getByRole('button', { name: 'parts.quickAdd.openAccountButton' }));
const fillValid = (limit = '') => {
  change('shopNameLabel', 'Fixture Shop');
  change('contactNameLabel', 'Fixture Contact');
  change('phoneLabel', '0555000000');
  if (limit) change('creditLimitLabel', limit);
};

beforeEach(() => {
  vi.clearAllMocks();
  fake.role = 'sales';
  fake.addCustomer.mockResolvedValue({ id: 'fixture-customer' });
});
afterEach(cleanup);

const open = () => render(<QuickAddShopModal isOpen onClose={fake.close} onCustomerCreated={fake.created} />);

describe('QuickAddShopModal', () => {
  it('allows staff to save an account without a credit limit', async () => {
    open();
    fillValid();
    submit();
    await waitFor(() => expect(fake.created).toHaveBeenCalledWith({ id: 'fixture-customer' }));
    expect(fake.addCustomer).toHaveBeenCalledWith(expect.objectContaining({ creditLimit: undefined }));
    expect(screen.queryByRole('dialog', { name: 'Test approval' })).toBeNull();
  });

  it('allows an admin to save a positive credit limit without an approval prompt', async () => {
    fake.role = 'admin';
    open();
    fillValid('5000');
    submit();
    await waitFor(() => expect(fake.close).toHaveBeenCalledTimes(1));
    expect(fake.addCustomer).toHaveBeenCalledWith(expect.objectContaining({ creditLimit: 5000 }));
    expect(screen.queryByRole('dialog', { name: 'Test approval' })).toBeNull();
  });

  it('requires staff approval and submits once after approval', async () => {
    open();
    fillValid('5000');
    submit();
    expect(fake.addCustomer).not.toHaveBeenCalled();
    fireEvent.click(await screen.findByRole('button', { name: 'Approve fixture' }));
    await waitFor(() => expect(fake.close).toHaveBeenCalledTimes(1));
    expect(fake.addCustomer).toHaveBeenCalledTimes(1);
    expect(fake.addCustomer).toHaveBeenCalledWith(expect.objectContaining({ creditLimit: 5000 }));
  });

  it('does not submit when approval is cancelled and retains the draft', async () => {
    open();
    fillValid('5000');
    submit();
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel approval' }));
    expect(fake.addCustomer).not.toHaveBeenCalled();
    expect(field('shopNameLabel').value).toBe('Fixture Shop');
    submit();
    expect(await screen.findByRole('dialog', { name: 'Test approval' })).toBeTruthy();
  });

  it('rejects missing shop, missing contact and an invalid phone', () => {
    open();
    submit();
    expect(screen.getByText('parts.quickAdd.errorShopName')).toBeTruthy();
    change('shopNameLabel', 'Fixture Shop');
    submit();
    expect(screen.getByText('parts.quickAdd.errorContactName')).toBeTruthy();
    change('contactNameLabel', 'Fixture Contact');
    change('phoneLabel', '123');
    submit();
    expect(screen.getByText('parts.quickAdd.errorPhone')).toBeTruthy();
    expect(fake.addCustomer).not.toHaveBeenCalled();
  });

  it('retains the draft on save failure and permits retry', async () => {
    fake.addCustomer.mockRejectedValueOnce(new Error('Fixture save refused'));
    open();
    fillValid();
    submit();
    expect(await screen.findByText('Fixture save refused')).toBeTruthy();
    expect(fake.close).not.toHaveBeenCalled();
    expect(field('shopNameLabel').value).toBe('Fixture Shop');
    submit();
    await waitFor(() => expect(fake.close).toHaveBeenCalledTimes(1));
    expect(fake.addCustomer).toHaveBeenCalledTimes(2);
  });

  it('requires fresh approval when a failed-save draft changes its credit limit', async () => {
    fake.addCustomer.mockRejectedValueOnce(new Error('Fixture save refused'));
    open();
    fillValid('5000');
    submit();
    fireEvent.click(await screen.findByRole('button', { name: 'Approve fixture' }));
    await screen.findByText('Fixture save refused');
    change('creditLimitLabel', '6000');
    submit();
    expect(fake.addCustomer).toHaveBeenCalledTimes(1);
    expect(await screen.findByRole('dialog', { name: 'Test approval' })).toBeTruthy();
  });

  it('blocks repeated submit and closing while a save is pending', async () => {
    let finish!: (value: { id: string }) => void;
    fake.addCustomer.mockReturnValue(new Promise(resolve => { finish = resolve; }));
    open();
    fillValid();
    submit();
    submit();
    fireEvent.keyDown(document, { key: 'Escape' });
    fireEvent.click(screen.getByRole('button', { name: 'common.close' }));
    expect(fake.close).not.toHaveBeenCalled();
    expect(fake.addCustomer).toHaveBeenCalledTimes(1);
    await act(async () => finish({ id: 'fixture-customer' }));
    expect(fake.close).toHaveBeenCalledTimes(1);
  });
});
