import React from 'react';
import { Tag, Plus, Trash2 } from 'lucide-react';
import styles from './CustomTicket.module.css';
import type { CustomTicketData } from './customTicketTypes';

interface SpecLinesCardProps {
  ticket: CustomTicketData;
  handleAddSpec: () => void;
  handleUpdateSpec: (id: string, field: 'label' | 'value', val: string) => void;
  handleRemoveSpec: (id: string) => void;
}

export const SpecLinesCard: React.FC<SpecLinesCardProps> = (props) => {
  const {
    ticket,
    handleAddSpec,
    handleUpdateSpec,
    handleRemoveSpec,
  } = props;

  return (
    <div className={styles.card}>
      <div className={styles.cardHeader}>
        <div className={styles.cardTitle}>
          <Tag size={16} />
          <span>3. Custom Technical Spec Lines</span>
        </div>
        <button
          type="button"
          className={styles.addSpecBtn}
          onClick={handleAddSpec}
        >
          <Plus size={14} /> Add Line
        </button>
      </div>

      {ticket.specs.length === 0 ? (
        <p style={{ fontSize: '12px', color: '#94a3b8', fontStyle: 'italic', margin: '6px 0' }}>
          No custom lines added. Click &quot;Add Line&quot; to specify Screen, RAM, Face ID, Network, or Box details.
        </p>
      ) : (
        <div className={styles.specsList}>
          {ticket.specs.map(item => (
            <div key={item.id} className={styles.specRow}>
              <input
                type="text"
                className={styles.input}
                placeholder="Spec (e.g. Screen)"
                value={item.label}
                onChange={e => handleUpdateSpec(item.id, 'label', e.target.value)}
              />
              <input
                type="text"
                className={styles.input}
                placeholder="Value (e.g. Original / True Tone OK)"
                value={item.value}
                onChange={e => handleUpdateSpec(item.id, 'value', e.target.value)}
              />
              <button
                type="button"
                className={styles.removeSpecBtn}
                onClick={() => handleRemoveSpec(item.id)}
                title="Remove line"
              >
                <Trash2 size={15} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
