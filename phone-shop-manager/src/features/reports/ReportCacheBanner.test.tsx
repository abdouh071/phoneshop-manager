// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ReportCacheBanner } from './ReportCacheBanner';

afterEach(cleanup);

describe('ReportCacheBanner', () => {
  it('renders nothing when report data is live and complete', () => {
    const { container } = render(
      <ReportCacheBanner data={{ isCached: false, isIncomplete: false, cachedSources: [], incompleteSources: [] }} />
    );
    expect(container.firstChild).toBeNull();
  });

  it('displays cached warning with affected sources and invokes retry handler', () => {
    const onRetry = vi.fn();
    render(
      <ReportCacheBanner
        data={{ isCached: true, isIncomplete: false, cachedSources: ['sales', 'debts'], incompleteSources: [] }}
        onRetry={onRetry}
      />
    );
    const status = screen.getByRole('status');
    expect(status.textContent).toContain('Cached Report Data');
    expect(status.textContent).toContain('Sales, Customer Debts');

    fireEvent.click(screen.getByRole('button', { name: /Retry Live Sync/i }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('highlights incomplete collections when a source fails live and cache reads', () => {
    render(
      <ReportCacheBanner
        data={{ isCached: true, isIncomplete: true, cachedSources: ['eod'], incompleteSources: ['eod'] }}
      />
    );
    const status = screen.getByRole('status');
    expect(status.textContent).toContain('Incomplete Report Data');
    expect(status.textContent).toContain('End-of-Day Closings');
  });
});
