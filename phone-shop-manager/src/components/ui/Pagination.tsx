import React from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import styles from './Pagination.module.css';

interface PaginationProps {
  currentPage: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  itemsPerPage: number;
  totalItems: number;
}

export const Pagination: React.FC<PaginationProps> = ({
  currentPage,
  totalPages,
  onPageChange,
  itemsPerPage,
  totalItems,
}) => {
  if (totalPages <= 1) return null;

  const start = (currentPage - 1) * itemsPerPage + 1;
  const end = Math.min(currentPage * itemsPerPage, totalItems);

  return (
    <div className={styles.container}>
      <div className={styles.info}>
        Showing <span className={styles.bold}>{start}</span> to{' '}
        <span className={styles.bold}>{end}</span> of{' '}
        <span className={styles.bold}>{totalItems}</span> results
      </div>
      
      <div className={styles.controls}>
        <button 
          className={styles.button}
          onClick={() => onPageChange(currentPage - 1)}
          disabled={currentPage === 1}
          aria-label="Previous page"
        >
          <ChevronLeft size={16} />
        </button>
        
        <div className={styles.pages}>
          {Array.from({ length: totalPages }).map((_, i) => {
            const page = i + 1;
            // Simple pagination (show all if few, otherwise we'd need ellipsis logic)
            return (
              <button
                key={page}
                className={[styles.pageBtn, currentPage === page && styles.active].filter(Boolean).join(' ')}
                onClick={() => onPageChange(page)}
              >
                {page}
              </button>
            );
          })}
        </div>

        <button 
          className={styles.button}
          onClick={() => onPageChange(currentPage + 1)}
          disabled={currentPage === totalPages}
          aria-label="Next page"
        >
          <ChevronRight size={16} />
        </button>
      </div>
    </div>
  );
};
