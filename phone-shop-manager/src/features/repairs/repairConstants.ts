import type { RepairTicket } from '../../types';

/**
 * Intelligent helper to extract a clean icon and category tag from issue description
 */
export const detectIssueTag = (desc: string = '') => {
  const raw = desc.trim();
  const d = raw.toLowerCase();
  if (!d) return { icon: '🔧', label: 'General Repair' };

  // Microphone (keep strictly as Microphone, not Audio/Speaker)
  if (d.includes('mic') || d.includes('micro')) {
    return { icon: '🎙️', label: raw.length <= 25 ? raw : 'Microphone' };
  }
  // Speaker
  if (d.includes('speaker') || d.includes('haut-parleur') || d.includes('haut parleur') || d.includes('baffle')) {
    return { icon: '🔊', label: raw.length <= 25 ? raw : 'Speaker' };
  }
  // Glass
  if (d.includes('glass') || d.includes('vitre')) {
    return { icon: '🔨', label: raw.length <= 25 ? raw : 'Glass' };
  }
  // Screen / Display
  if (d.includes('screen') || d.includes('ecran') || d.includes('lcd') || d.includes('oled') || d.includes('display') || d.includes('tactile')) {
    return { icon: '📱', label: raw.length <= 25 ? raw : 'Screen' };
  }
  // Battery
  if (d.includes('battery') || d.includes('batterie') || d.includes('drain') || d.includes('charge rapide')) {
    return { icon: '🔋', label: raw.length <= 25 ? raw : 'Battery' };
  }
  // Charging Port
  if (d.includes('port') || d.includes('connecteur') || d.includes('charge') || d.includes('cable')) {
    return { icon: '⚡', label: raw.length <= 25 ? raw : 'Charging Port' };
  }
  // Camera Lens
  if (d.includes('lens') || d.includes('lentille')) {
    return { icon: '🔍', label: raw.length <= 25 ? raw : 'Camera Lens' };
  }
  // Camera
  if (d.includes('camera') || d.includes('photo') || d.includes('appareil')) {
    return { icon: '📷', label: raw.length <= 25 ? raw : 'Camera' };
  }
  // Water Damage
  if (d.includes('water') || d.includes('eau') || d.includes('liquid') || d.includes('liquide') || d.includes('moisture') || d.includes('oxyd')) {
    return { icon: '💧', label: raw.length <= 25 ? raw : 'Water Damage' };
  }
  // Back Glass
  if (d.includes('back') || d.includes('arriere') || d.includes('chassis')) {
    return { icon: '🔘', label: raw.length <= 25 ? raw : 'Back Glass' };
  }
  // Unlock
  if (d.includes('unlock') || d.includes('debloqu') || d.includes('frp') || d.includes('icloud') || d.includes('code')) {
    return { icon: '🔓', label: raw.length <= 25 ? raw : 'Unlock' };
  }
  // Software
  if (d.includes('software') || d.includes('flash') || d.includes('system') || d.includes('reset') || d.includes('logiciel')) {
    return { icon: '💻', label: raw.length <= 25 ? raw : 'Software' };
  }
  // Audio
  if (d.includes('audio') || d.includes('son')) {
    return { icon: '🔊', label: raw.length <= 25 ? raw : 'Audio' };
  }

  return { icon: '🔧', label: raw.length <= 25 ? raw : raw.substring(0, 22) + '…' };
};

export const getBrandIcon = (brand: string = '') => {
  const b = brand.toLowerCase();
  if (b.includes('apple') || b.includes('iphone') || b.includes('ipad')) return '🍏';
  if (b.includes('samsung') || b.includes('galaxy')) return '📱';
  if (b.includes('xiaomi') || b.includes('redmi') || b.includes('poco')) return '⚡';
  return '📱';
};

export const nextStatusMap: Partial<Record<RepairTicket['status'], RepairTicket['status']>> = {
  pending: 'in_progress',
  in_progress: 'ready',
  ready: 'completed',
  returned: 'in_progress',
};

export const nextActionLabels: Partial<Record<RepairTicket['status'], { label: string; title: string }>> = {
  pending: { label: 'Start →', title: 'Move to In Progress / Workbench' },
  in_progress: { label: 'Ready →', title: 'Mark Ready for Pickup' },
  ready: { label: 'Settle →', title: 'Handover & Settlement' },
  returned: { label: 'Restart →', title: 'Restart Repair / Warranty Re-work' },
};
