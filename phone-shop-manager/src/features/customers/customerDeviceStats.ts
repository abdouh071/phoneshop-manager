import type { Customer, RepairTicket } from '../../types';
import { normalizeDeviceDetails } from '../../utils/customerFinancials';

export type CustomerDeviceStat = {
  id?: string;
  displayName: string;
  brand: string;
  model: string;
  imei?: string;
  notes?: string;
  count: number;
  totalSpent: number;
  issues: string[];
  tickets: RepairTicket[];
  isRegisteredOnly?: boolean;
};

// Device Fleet calculation (smart canonical normalization + IMEI deduplication + repair tickets & registered devices)
export function buildCustomerDeviceStats(customer: Customer, customerTickets: RepairTicket[]): Array<readonly [string, CustomerDeviceStat]> {
  const map: Record<string, CustomerDeviceStat> = {};

  // 1. From repair tickets
  customerTickets.forEach(tk => {
    const { brand, model, displayName, canonicalKey } = normalizeDeviceDetails(tk.deviceBrand, tk.deviceModel);
    const imei = (tk.serialNumber || tk.imei || '').trim();

    // Find by IMEI if available, or by canonical key
    let key = canonicalKey;
    if (imei) {
      const existingKey = Object.keys(map).find(k => map[k].imei && map[k].imei === imei);
      if (existingKey) key = existingKey;
    }

    if (!map[key]) {
      map[key] = {
        displayName,
        brand,
        model,
        imei: imei || undefined,
        count: 0,
        totalSpent: 0,
        issues: [],
        tickets: [],
      };
    } else {
      if (displayName.length > map[key].displayName.length) {
        map[key].displayName = displayName;
      }
      if (imei && !map[key].imei) {
        map[key].imei = imei;
      }
    }

    map[key].count++;
    const cost = tk.actualCost != null && tk.actualCost > 0 ? tk.actualCost : (tk.estimatedCost || 0);
    map[key].totalSpent += cost;
    if (tk.issueDescription && !map[key].issues.includes(tk.issueDescription)) {
      map[key].issues.push(tk.issueDescription);
    }
    map[key].tickets.push(tk);
  });

  // 2. From customer.registeredDevices
  (customer.registeredDevices || []).forEach(dev => {
    const { brand, model, displayName, canonicalKey } = normalizeDeviceDetails(dev.brand, dev.model);
    const imei = (dev.imei || '').trim();

    let key = canonicalKey;
    if (imei) {
      const existingKey = Object.keys(map).find(k => map[k].imei && map[k].imei === imei);
      if (existingKey) key = existingKey;
    }

    if (!map[key]) {
      map[key] = {
        id: dev.id,
        displayName,
        brand,
        model,
        imei: imei || undefined,
        notes: dev.notes,
        count: 0,
        totalSpent: 0,
        issues: [],
        tickets: [],
        isRegisteredOnly: true,
      };
    } else {
      map[key].id = dev.id || map[key].id;
      map[key].imei = imei || map[key].imei;
      map[key].notes = dev.notes || map[key].notes;
    }
  });

  // Sort tickets inside each device newest first
  Object.values(map).forEach(d => {
    d.tickets.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  });

  return Object.entries(map).map(([_, data]) => [data.displayName, data] as const);
}
