import { formatCurrency } from '../../utils/formatCurrency';
import type { TFunction } from 'i18next';
import type { ReportData } from '../../services/reportsService';

interface ExecReportHtmlParams {
  data: ReportData;
  storeName: string;
  authorizedByName: string;
  t: TFunction;
}

export const buildExecutiveReportHtml = ({
  data,
  storeName,
  authorizedByName,
  t,
}: ExecReportHtmlParams): string => {
  const html = `
      <div class="report-header">
        <div>
          <div class="shop-name">${storeName}</div>
          <div class="report-title">${t('reports.execTitle', 'Executive Financial & Operations Report')}</div>
        </div>
        <div class="meta-info">
          <div><strong>${t('reports.execPeriod', 'Period:')}</strong> ${data.timeframeLabel}</div>
          <div><strong>${t('reports.execGenerated', 'Generated:')}</strong> ${new Date().toLocaleString()}</div>
          <div><strong>${t('reports.execAuthorizedBy', 'Authorized by:')}</strong> ${authorizedByName}</div>
        </div>
      </div>

      <div class="kpi-grid">
        <div class="kpi-card">
          <div class="kpi-label">${t('reports.grossRevenue', 'Gross Revenue')}</div>
          <div class="kpi-value">${formatCurrency(data.financialSummary.grossRevenue)}</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-label">${t('reports.execTotalCogs', 'Total COGS (Cost)')}</div>
          <div class="kpi-value text-danger">-${formatCurrency(data.financialSummary.totalCOGS)}</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-label">${t('reports.netProfit', 'Net Profit')}</div>
          <div class="kpi-value text-success">${formatCurrency(data.financialSummary.grossProfit)}</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-label">${t('reports.profitMargin', 'Profit Margin')}</div>
          <div class="kpi-value">${data.financialSummary.profitMarginPercent}%</div>
        </div>
      </div>

      <div class="section-title">${t('reports.execDetailedDaily', 'Detailed Daily Income & End-of-Day Closures (POS & Repairs)')}</div>
      <table>
        <thead>
          <tr>
            <th>${t('common.date', 'Date')}</th>
            <th>${t('reports.execEodStatus', 'EOD Status')}</th>
            <th class="text-right">${t('reports.execPosRevenue', 'POS Revenue')}</th>
            <th class="text-right">${t('reports.execRepairRevenue', 'Repair Revenue')}</th>
            <th class="text-right">${t('reports.execCashInDrawer', 'Cash in Drawer')}</th>
            <th class="text-right">${t('reports.execTotalNetProfit', 'Total Net Profit')}</th>
          </tr>
        </thead>
        <tbody>
          ${(data.dailyIncomeDetails || []).map(d => `
            <tr>
              <td><strong>${d.dayLabel}</strong> (${d.date})</td>
              <td>${d.isClosed ? (d.isAutoClose ? t('reports.execSealedAuto', 'Sealed (Auto 00:00)') : t('reports.execSealedBy', 'Sealed ({{name}})', { name: d.closedByName || 'Admin' })) : t('reports.execOpenLive', 'Open / Live')}</td>
              <td class="text-right font-mono">${formatCurrency(d.salesGrossRevenue)}</td>
              <td class="text-right font-mono">${formatCurrency(d.repairsRevenue)}</td>
              <td class="text-right font-mono">${formatCurrency(d.totalPhysicalCash)}</td>
              <td class="text-right font-mono text-success"><strong>+${formatCurrency(d.totalNetProfit)}</strong></td>
            </tr>
          `).join('')}
        </tbody>
      </table>

      <div class="section-title">${t('reports.execCashReconciliation', 'Cash Drawer & Payment Reconciliation')}</div>
      <table>
        <thead>
          <tr>
            <th>${t('reports.execPaymentMethod', 'Payment Method')}</th>
            <th class="text-right">${t('reports.execAmountCollected', 'Amount Collected')}</th>
            <th class="text-right">${t('reports.execShare', 'Share')}</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>💵 ${t('reports.execCash', 'Cash')}</td>
            <td class="text-right font-mono">${formatCurrency(data.paymentBreakdown.cash)}</td>
            <td class="text-right">${data.paymentBreakdown.totalCollected > 0 ? Math.round((data.paymentBreakdown.cash / data.paymentBreakdown.totalCollected) * 100) : 0}%</td>
          </tr>
          <tr>
            <td>💳 ${t('reports.execCard', 'Card')}</td>
            <td class="text-right font-mono">${formatCurrency(data.paymentBreakdown.card)}</td>
            <td class="text-right">${data.paymentBreakdown.totalCollected > 0 ? Math.round((data.paymentBreakdown.card / data.paymentBreakdown.totalCollected) * 100) : 0}%</td>
          </tr>
          <tr>
            <td>📱 ${t('reports.execMobilePay', 'Mobile Pay')}</td>
            <td class="text-right font-mono">${formatCurrency(data.paymentBreakdown.mobile)}</td>
            <td class="text-right">${data.paymentBreakdown.totalCollected > 0 ? Math.round((data.paymentBreakdown.mobile / data.paymentBreakdown.totalCollected) * 100) : 0}%</td>
          </tr>
          ${(data.paymentBreakdown.transfer || 0) > 0 ? `
          <tr>
            <td>🏦 ${t('reports.execBankTransfer', 'Bank Transfer')}</td>
            <td class="text-right font-mono">${formatCurrency(data.paymentBreakdown.transfer || 0)}</td>
            <td class="text-right">${data.paymentBreakdown.totalCollected > 0 ? Math.round(((data.paymentBreakdown.transfer || 0) / data.paymentBreakdown.totalCollected) * 100) : 0}%</td>
          </tr>` : ''}
          ${(data.paymentBreakdown.storeCredit || 0) > 0 ? `
          <tr>
            <td>🎫 ${t('reports.execStoreCredit', 'Store Credit')}</td>
            <td class="text-right font-mono">${formatCurrency(data.paymentBreakdown.storeCredit || 0)}</td>
            <td class="text-right">${data.paymentBreakdown.totalCollected > 0 ? Math.round(((data.paymentBreakdown.storeCredit || 0) / data.paymentBreakdown.totalCollected) * 100) : 0}%</td>
          </tr>` : ''}
          <tr>
            <td><strong>${t('reports.execTotalReconciled', 'Total Reconciled')}</strong></td>
            <td class="text-right font-mono"><strong>${formatCurrency(data.paymentBreakdown.totalCollected)}</strong></td>
            <td class="text-right"><strong>100%</strong></td>
          </tr>
        </tbody>
      </table>

      <div class="section-title">${t('reports.execTopSelling', 'Top Selling Products')}</div>
      <table>
        <thead>
          <tr>
            <th>${t('reports.execProduct', 'Product')}</th>
            <th class="text-right">${t('reports.execUnitsSold', 'Units Sold')}</th>
            <th class="text-right">${t('reports.execRevenue', 'Revenue')}</th>
            <th class="text-right">${t('reports.netProfit', 'Net Profit')}</th>
            <th class="text-right">${t('reports.execMargin', 'Margin')}</th>
          </tr>
        </thead>
        <tbody>
          ${data.topProducts.map(p => `
            <tr>
              <td>${p.name}</td>
              <td class="text-right">${p.units}</td>
              <td class="text-right font-mono">${formatCurrency(p.revenue)}</td>
              <td class="text-right font-mono text-success">${formatCurrency(p.profit)}</td>
              <td class="text-right">${p.marginPercent}%</td>
            </tr>
          `).join('')}
        </tbody>
      </table>

      <div class="section-title">${t('reports.execStaffPerf', 'Staff Performance & Accountability')}</div>
      <table>
        <thead>
          <tr>
            <th>${t('reports.execStaffMember', 'Staff Member')}</th>
            <th class="text-right">${t('reports.execSalesCount', 'Sales Count')}</th>
            <th class="text-right">${t('reports.execSalesRevenue', 'Sales Revenue')}</th>
            <th class="text-right">${t('reports.execRepairsHandled', 'Repairs Handled')}</th>
            <th class="text-right">${t('reports.execRepairRevenue', 'Repair Revenue')}</th>
            <th class="text-right">${t('reports.execTotalRevenue', 'Total Revenue')}</th>
          </tr>
        </thead>
        <tbody>
          ${data.staffPerformance.map(s => `
            <tr>
              <td><strong>${s.name}</strong></td>
              <td class="text-right">${s.salesCount}</td>
              <td class="text-right font-mono">${formatCurrency(s.salesRevenue)}</td>
              <td class="text-right">${s.repairsCount}</td>
              <td class="text-right font-mono">${formatCurrency(s.repairsRevenue)}</td>
              <td class="text-right font-mono"><strong>${formatCurrency(s.totalRevenue)}</strong></td>
            </tr>
          `).join('')}
        </tbody>
      </table>

      <div class="signature-box">
        <div class="sig-line">${t('reports.execManagerSignature', 'Store Manager Signature')}</div>
        <div class="sig-line">${t('reports.execAccountant', 'Accountant / Auditor')}</div>
      </div>
    `;

  return html;
};
