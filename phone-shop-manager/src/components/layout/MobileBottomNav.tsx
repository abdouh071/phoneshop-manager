import React from 'react';
import { NavLink } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  LayoutDashboard,
  ShoppingCart,
  Wrench,
  Package,
  Menu,
  Cpu,
  Users,
  BarChart3,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useAuthStore } from '../../store/authStore';
import { usePermissions } from '../../hooks/usePermissions';
import { ApprovalsNotificationButton } from '../../features/approvals/ApprovalsNotificationButton';
import styles from './MobileBottomNav.module.css';

interface MobileBottomNavProps {
  onMenuOpen: () => void;
}

type PrimaryTab = {
  icon: LucideIcon;
  labelKey: string;
  path: string;
  end?: boolean;
};

export const MobileBottomNav: React.FC<MobileBottomNavProps> = ({ onMenuOpen }) => {
  const { t } = useTranslation();
  const { user } = useAuthStore();
  const permissions = usePermissions();

  // Build role-specific primary tabs (max 4 + menu)
  const tabs = React.useMemo<PrimaryTab[]>(() => {
    const role = user?.role;

    if (role === 'repair_agent') {
      return [
        permissions.dashboard !== false && { icon: LayoutDashboard, labelKey: 'nav.home',     path: '/',        end: true },
        permissions.repairs       && { icon: Wrench,          labelKey: 'sidebar.repairs',   path: '/repairs'  },
        permissions.inventory_parts && { icon: Cpu,           labelKey: 'sidebar.parts',     path: '/parts'    },
        permissions.customers     && { icon: Users,           labelKey: 'sidebar.customers', path: '/customers'},
      ].filter(Boolean) as PrimaryTab[];
    }

    if (role === 'sales_agent') {
      return [
        permissions.dashboard !== false && { icon: LayoutDashboard, labelKey: 'nav.home',         path: '/',        end: true },
        permissions.pos               && { icon: ShoppingCart,      labelKey: 'sidebar.pos',        path: '/pos'      },
        permissions.inventory_products && { icon: Package,          labelKey: 'sidebar.inventory',  path: '/inventory'},
        permissions.customers         && { icon: Users,             labelKey: 'sidebar.customers',  path: '/customers'},
      ].filter(Boolean) as PrimaryTab[];
    }

    // Admin — show high-value tabs
    return [
      { icon: LayoutDashboard, labelKey: 'nav.home',        path: '/',        end: true },
      { icon: ShoppingCart,    labelKey: 'sidebar.pos',     path: '/pos'               },
      { icon: Wrench,          labelKey: 'sidebar.repairs', path: '/repairs'           },
      { icon: BarChart3,       labelKey: 'sidebar.reports', path: '/reports'           },
    ];
  }, [user?.role, permissions]);

  if (!tabs.length) return null;

  return (
    <nav className={styles.nav} role="navigation" aria-label="Primary Navigation">
      {tabs.slice(0, 4).map(tab => (
        <NavLink
          key={tab.path}
          to={tab.path}
          end={tab.end}
          className={({ isActive }) =>
            [styles.tab, isActive && styles.tabActive].filter(Boolean).join(' ')
          }
        >
          <tab.icon size={22} className={styles.tabIcon} />
          <span className={styles.tabLabel}>{t(tab.labelKey)}</span>
        </NavLink>
      ))}

      {/* More / Approvals */}
      <div className={styles.tab} style={{ position: 'relative' }}>
        <ApprovalsNotificationButton variant="mobile-tab" />
        <button
          className={styles.menuTabBtn}
          onClick={onMenuOpen}
          aria-label={t('nav.more')}
        >
          <Menu size={22} className={styles.tabIcon} />
          <span className={styles.tabLabel}>{t('nav.more')}</span>
        </button>
      </div>
    </nav>
  );
};
