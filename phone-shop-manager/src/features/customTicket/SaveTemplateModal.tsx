import React from 'react';
import { Save } from 'lucide-react';
import { Button } from '../../components/ui/Button';
import { Modal } from '../../components/ui/Modal';
import styles from './CustomTicket.module.css';

interface SaveTemplateModalProps {
  isSaveTemplateModalOpen: boolean;
  setIsSaveTemplateModalOpen: React.Dispatch<React.SetStateAction<boolean>>;
  newTemplateName: string;
  setNewTemplateName: React.Dispatch<React.SetStateAction<string>>;
  handleSaveAsTemplate: () => void;
}

export const SaveTemplateModal: React.FC<SaveTemplateModalProps> = (props) => {
  const {
    isSaveTemplateModalOpen,
    setIsSaveTemplateModalOpen,
    newTemplateName,
    setNewTemplateName,
    handleSaveAsTemplate,
  } = props;

  return (
    <Modal
      isOpen={isSaveTemplateModalOpen}
      onClose={() => setIsSaveTemplateModalOpen(false)}
      title="Save Current Ticket as Template"
      maxWidth="440px"
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', padding: '8px 0' }}>
        <p style={{ fontSize: '13px', color: '#64748b', margin: 0 }}>
          Save your current specifications, notes, paper format, and layout settings to quickly re-use them for future devices or inventory slips.
        </p>
        <div>
          <label className={styles.label} style={{ marginBottom: '6px', display: 'block' }}>
            Template Name:
          </label>
          <input
            type="text"
            className={styles.input}
            placeholder="e.g. Screen Replacement 3-Mo Warranty"
            value={newTemplateName}
            onChange={e => setNewTemplateName(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') handleSaveAsTemplate();
            }}
            autoFocus
          />
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '6px' }}>
          <Button variant="ghost" onClick={() => setIsSaveTemplateModalOpen(false)}>
            Cancel
          </Button>
          <Button variant="primary" onClick={handleSaveAsTemplate} leftIcon={<Save size={14} />}>
            Save Template
          </Button>
        </div>
      </div>
    </Modal>
  );
};
