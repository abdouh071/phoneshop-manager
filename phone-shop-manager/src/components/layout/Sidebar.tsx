import { NavLink } from 'react-router-dom';
import {
  LayoutDashboard,
  ShoppingCart,
  Wrench,
  Package,
  Smartphone,
  Users,
  BarChart3,
  Settings,
  LogOut,
  Clock,
  Truck,
  Cpu,
  Printer,
} from 'lucide-react';
import { useAuthStore } from '../../store/authStore';
import { useSettingsStore } from '../../store/settingsStore';
import { usePermissions } from '../../hooks/usePermissions';
import { PrinterStatusPill } from './PrinterStatusPill';
import { useTranslation } from 'react-i18next';
import styles from './Sidebar.module.css';

interface SidebarProps {
  isOpen: boolean;
  onClose: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({ isOpen, onClose }) => {
  const { t } = useTranslation();
  const { user, logout } = useAuthStore();
  const permissions = usePermissions();
  const { storeName } = useSettingsStore();

  const navItems = [
    { icon: LayoutDashboard, label: t('sidebar.dashboard', 'Dashboard'),     path: '/',          permKey: 'dashboard'         },
    { icon: ShoppingCart,    label: t('sidebar.pos', 'Point of Sale'),       path: '/pos',       permKey: 'pos'               },
    { icon: Wrench,          label: t('sidebar.repairs', 'Repairs'),         path: '/repairs',   permKey: 'repairs'           },
    { icon: Cpu,             label: t('sidebar.parts', 'Parts'),             path: '/parts',     permKey: 'inventory_parts'   },
    { icon: Package,         label: t('sidebar.inventory', 'Inventory'),     path: '/inventory', permKey: 'inventory_products'},
    { icon: Printer,         label: t('sidebar.customTicket', 'Custom Ticket'), path: '/custom-ticket', permKey: null         },
    { icon: Truck,           label: t('sidebar.purchasing', 'Purchasing'),   path: '/purchasing',permKey: 'inventory_edit'    },
    { icon: Users,           label: t('sidebar.customers', 'Customers'),     path: '/customers', permKey: 'customers'         },
    { icon: BarChart3,       label: t('sidebar.reports', 'Reports'),         path: '/reports',   permKey: 'reports'           },
    { icon: Clock,           label: t('sidebar.activity', 'Activity Log'),   path: '/activity',  permKey: 'activity'          },
    { icon: Settings,        label: t('sidebar.settings', 'Settings'),       path: '/settings',  permKey: null                },
  ];

  const ROLE_LABELS: Record<string, { label: string; color: string }> = {
    admin:         { label: t('role.admin', 'Store Admin'),   color: '#6366f1' },
    sales_agent:   { label: t('role.sales_agent', 'Sales Agent'),   color: '#10b981' },
    repair_agent:  { label: t('role.repair_agent', 'Repair Agent'),  color: '#f59e0b' },
  };

  return (
    <>
      {/* Mobile backdrop */}
      <div
        className={[styles.backdrop, isOpen && styles.backdropVisible].filter(Boolean).join(' ')}
        onClick={onClose}
        aria-hidden="true"
      />

      <aside className={[styles.sidebar, isOpen && styles.sidebarOpen].filter(Boolean).join(' ')}>
        {/* Brand */}
        <div className={styles.brand}>
          <div className={styles.brandIcon}>
            <Smartphone size={20} />
          </div>
          <div className={styles.brandText}>
            <span className={styles.brandName}>{storeName || 'PhoneShop'}</span>
            <span className={styles.brandTagline}>Manager Pro</span>
          </div>
        </div>

        {/* Navigation */}
        <nav className={styles.nav}>
          <p className={styles.navSection}>{t('sidebar.mainMenu', 'Main Menu')}</p>
          {navItems.map(({ path, icon: Icon, label, permKey }) => {
            if (permKey && !permissions[permKey as keyof typeof permissions]) return null;

            return (
              <NavLink
                key={path}
                to={path}
                end={path === '/'}
                className={({ isActive }) =>
                  [styles.navItem, isActive && styles.active].filter(Boolean).join(' ')
                }
                onClick={onClose}
              >
                <Icon size={18} className={styles.navIcon} />
                <span>{label}</span>
              </NavLink>
            );
          })}
        </nav>

        {/* Hardware Status */}
        <div style={{ padding: '8px 16px', display: 'flex', justifyContent: 'center' }}>
          <PrinterStatusPill />
        </div>

        {/* Footer */}
        <div className={styles.footer}>
          <div className={styles.userInfo}>
            <div className={styles.avatar}>{user?.avatar || 'U'}</div>
            <div className={styles.userMeta}>
              <span className={styles.userName}>{user?.name || 'Unknown User'}</span>
              <span className={styles.userRole} style={{ color: ROLE_LABELS[user?.role ?? '']?.color }}>
                {ROLE_LABELS[user?.role ?? '']?.label ?? 'Staff'}
              </span>
            </div>
          </div>
          <button className={styles.logoutBtn} onClick={logout} aria-label={t('sidebar.logout', 'Log Out')}>
            <LogOut size={16} />
          </button>
        </div>
      </aside>
    </>
  );
};

