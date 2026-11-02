import { describe, it, expect } from 'vitest';
import type { Customer, RepairTicket } from '../types';
import { normalizePhoneDigits, isPhoneMatch } from './phoneUtils';
import { matchesCustomer } from './customerFinancials';

describe('Customer Directory Search & Discovery Logic', () => {
  const mockCustomer: Customer = {
    id: 'cust-1',
    name: 'Amrouch Reda',
    phone: '0555 12 34 56',
    normalizedPhone: '0555123456',
    email: 'amrouch@example.com',
    accountType: 'retail',
    totalPurchases: 1,
    totalSpent: 3400,
    totalDebt: 0,
    joinDate: '2026-01-01T10:00:00Z',
    lastVisitDate: '2026-01-01T10:00:00Z',
    registeredDevices: [
      {
        id: 'dev-oppo-a5s',
        brand: 'Oppo',
        model: 'a5s',
        imei: '861234567890123',
        createdAt: '2026-01-01T10:00:00Z',
      },
    ],
  };

  const mockTickets: RepairTicket[] = [
    {
      id: 'ticket-1',
      ticketNumber: 'TKT-0039',
      customerId: 'cust-1',
      customerName: 'Amrouch Reda',
      customerPhone: '0555 12 34 56',
      deviceBrand: 'Oppo',
      deviceModel: 'a5s',
      deviceImei: '861234567890123',
      issueDescription: 'Broken Screen and battery replacement',
      status: 'ready',
      assignedTechnician: 'Karim Tech',
      createdAt: '2026-01-01T10:00:00Z',
    } as RepairTicket,
  ];

  const ticketsMap = new Map<string, RepairTicket[]>([
    ['cust-1', mockTickets],
  ]);

  const searchMatcher = (c: Customer, query: string): boolean => {
    const q = query.toLowerCase().trim();
    const cleanDigits = normalizePhoneDigits(query);
    const rawDigits = query.replace(/\D/g, '');

    // Name & Shop
    if (c.name && c.name.toLowerCase().includes(q)) return true;
    if (c.shopName && c.shopName.toLowerCase().includes(q)) return true;

    // Phone
    if (c.phone && c.phone.toLowerCase().includes(q)) return true;
    if (c.normalizedPhone && c.normalizedPhone.includes(q)) return true;
    if (cleanDigits.length >= 2) {
      if (c.normalizedPhone && c.normalizedPhone.includes(cleanDigits)) return true;
      if (normalizePhoneDigits(c.phone).includes(cleanDigits)) return true;
      if (isPhoneMatch(c.phone, query)) return true;
    }
    if (rawDigits.length >= 2 && c.phone && c.phone.replace(/\D/g, '').includes(rawDigits)) return true;

    // Email, Address, Notes
    if (c.email && c.email.toLowerCase().includes(q)) return true;
    if (c.address && c.address.toLowerCase().includes(q)) return true;
    if (c.notes && c.notes.toLowerCase().includes(q)) return true;

    // Devices
    if (c.registeredDevices && c.registeredDevices.length > 0) {
      const devMatch = c.registeredDevices.some(d =>
        (d.brand && d.brand.toLowerCase().includes(q)) ||
        (d.model && d.model.toLowerCase().includes(q)) ||
        (`${d.brand || ''} ${d.model || ''}`.toLowerCase().includes(q)) ||
        (d.imei && d.imei.toLowerCase().includes(q)) ||
        (d.notes && d.notes.toLowerCase().includes(q))
      );
      if (devMatch) return true;
    }

    // Tickets
    const cTickets = ticketsMap.get(c.id) || [];
    if (cTickets.length > 0) {
      const tktMatch = cTickets.some(t =>
        (t.ticketNumber && t.ticketNumber.toLowerCase().includes(q)) ||
        (t.deviceBrand && t.deviceBrand.toLowerCase().includes(q)) ||
        (t.deviceModel && t.deviceModel.toLowerCase().includes(q)) ||
        (`${t.deviceBrand || ''} ${t.deviceModel || ''}`.toLowerCase().includes(q)) ||
        (t.deviceImei && t.deviceImei.toLowerCase().includes(q)) ||
        (t.issueDescription && t.issueDescription.toLowerCase().includes(q)) ||
        (t.assignedTechnician && t.assignedTechnician.toLowerCase().includes(q))
      );
      if (tktMatch) return true;
    }

    return false;
  };

  it('matches customer by name (case-insensitive and partial)', () => {
    expect(searchMatcher(mockCustomer, 'amrouch')).toBe(true);
    expect(searchMatcher(mockCustomer, 'Reda')).toBe(true);
    expect(searchMatcher(mockCustomer, 'amr')).toBe(true);
  });

  it('matches customer by phone number in various formats', () => {
    expect(searchMatcher(mockCustomer, '0555123456')).toBe(true);
    expect(searchMatcher(mockCustomer, '0555 12 34 56')).toBe(true);
    expect(searchMatcher(mockCustomer, '123456')).toBe(true);
  });

  it('matches customer by ticket number (e.g. TKT-0039 or 0039)', () => {
    expect(searchMatcher(mockCustomer, 'TKT-0039')).toBe(true);
    expect(searchMatcher(mockCustomer, '0039')).toBe(true);
    expect(searchMatcher(mockCustomer, 'tkt-0039')).toBe(true);
  });

  it('matches customer by registered device brand and model', () => {
    expect(searchMatcher(mockCustomer, 'Oppo')).toBe(true);
    expect(searchMatcher(mockCustomer, 'a5s')).toBe(true);
    expect(searchMatcher(mockCustomer, 'Oppo a5s')).toBe(true);
  });

  it('matches customer by device IMEI number', () => {
    expect(searchMatcher(mockCustomer, '861234567890123')).toBe(true);
    expect(searchMatcher(mockCustomer, '861234')).toBe(true);
  });

  it('matches customer by repair ticket issue description', () => {
    expect(searchMatcher(mockCustomer, 'Broken Screen')).toBe(true);
    expect(searchMatcher(mockCustomer, 'battery')).toBe(true);
  });

  it('matches customer by assigned technician', () => {
    expect(searchMatcher(mockCustomer, 'Karim Tech')).toBe(true);
  });

  it('returns false for unrelated query', () => {
    expect(searchMatcher(mockCustomer, 'Samsung Galaxy S22')).toBe(false);
    expect(searchMatcher(mockCustomer, '0661999999')).toBe(false);
  });

  it('correctly associates orphan ticket with customer via matchesCustomer', () => {
    const orphanTicket = {
      id: 'tkt-2',
      customerName: 'Amrouch Reda',
      customerPhone: '0555 12 34 56',
    };
    expect(matchesCustomer(mockCustomer, orphanTicket)).toBe(true);
  });
});

