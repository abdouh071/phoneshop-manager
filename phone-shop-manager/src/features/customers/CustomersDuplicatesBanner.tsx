import React from 'react';
import { GitMerge } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '../../components/ui/Button';
import type { Customer } from '../../types';

interface CustomersDuplicatesBannerProps {
  detectedDuplicates: Array<{ retail: Customer; shop: Customer; reason: string }>;
  isAutoResolving: boolean;
  onReviewIndividually: () => void;
  onAutoResolveAll: () => void;
}

export const CustomersDuplicatesBanner: React.FC<CustomersDuplicatesBannerProps> = ({
  detectedDuplicates,
  isAutoResolving,
  onReviewIndividually,
  onAutoResolveAll,
}) => {
  const { t } = useTranslation();

  return (
    <>
      {/* Detected Duplicates Alert Banner */}
      {detectedDuplicates.length > 0 && (
        <div style={{
          background: '#fefce8',
          border: '1px solid #fde047',
          borderRadius: '10px',
          padding: '12px 18px',
          marginBottom: '16px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '14px',
          flexWrap: 'wrap',
          boxShadow: '0 1px 4px rgba(234, 179, 8, 0.1)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div style={{
              background: '#fef08a',
              color: '#854d0e',
              width: '36px',
              height: '36px',
              borderRadius: '8px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}>
              <GitMerge size={20} />
            </div>
            <div>
              <h4 style={{ margin: '0 0 2px 0', fontSize: '13.5px', fontWeight: 700, color: '#854d0e' }}>
                {t('customers.duplicatesDetectedTitle', '{{count}} Duplicate Account(s) Detected', { count: detectedDuplicates.length })}
              </h4>
              <p style={{ margin: 0, fontSize: '12px', color: '#a16207' }}>
                {t('customers.duplicatesDetectedDesc', 'Matching customer accounts detected (including walk-ins & phoneless records). Click Auto Resolve to safely consolidate all debts, repairs, and orders into primary accounts and delete duplicate customer records.')}
              </p>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
            <Button
              size="sm"
              variant="outline"
              onClick={onReviewIndividually}
              disabled={isAutoResolving}
              style={{ background: '#ffffff', borderColor: '#ca8a04', color: '#854d0e' }}
            >
              {t('customers.reviewIndividually', 'Review Individually')}
            </Button>
            <Button
              size="sm"
              variant="primary"
              leftIcon={<GitMerge size={14} />}
              onClick={onAutoResolveAll}
              isLoading={isAutoResolving}
              style={{
                background: '#ca8a04',
                borderColor: '#a16207',
                color: '#ffffff',
                fontWeight: 700,
              }}
            >
              {t('customers.autoResolveAll', '⚡ Auto Resolve All ({{count}})', { count: detectedDuplicates.length })}
            </Button>
          </div>
        </div>
      )}
    </>
  );
};
