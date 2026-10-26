import React from 'react';
import { NavLink } from 'react-router-dom';
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
import { useAuthStore } from '../../store/authStore';
import { usePermissions } from '../../hooks/usePermissions';
import { ApprovalsNotificationButton } from '../../features/approvals/ApprovalsNotificationButton';
import styles from './MobileBottomNav.module.css';

interface MobileBottomNavProps {
  onMenuOpen: () => void;
}

export const MobileBottomNav: React.FC<MobileBottomNavProps> = ({ onMenuOpen }) => {
  const { user } = useAuthStore();
  const permissions = usePermissions();

  // Build role-specific primary tabs (max 4 + menu)
  const tabs = React.useMemo(() => {
    const role = user?.role;

    if (role === 'repair_agent') {
      return [
        permissions.dashboard !== false && { icon: LayoutDashboard, label: 'Home',    path: '/',        end: true },
        permissions.repairs       && { icon: Wrench,          label: 'Repairs',  path: '/repairs'  },
        permissions.inventory_parts && { icon: Cpu,           label: 'Parts',    path: '/parts'    },
        permissions.customers     && { icon: Users,           label: 'Customers',path: '/customers'},
      ].filter(Boolean);
    }

    if (role === 'sales_agent') {
      return [
        permissions.dashboard !== false && { icon: LayoutDashboard, label: 'Home',      path: '/',        end: true },
        permissions.pos               && { icon: ShoppingCart,      label: 'POS',        path: '/pos'      },
        permissions.inventory_products && { icon: Package,          label: 'Inventory',  path: '/inventory'},
        permissions.customers         && { icon: Users,             label: 'Customers',  path: '/customers'},
      ].filter(Boolean);
    }

    // Admin — show high-value tabs
    return [
      { icon: LayoutDashboard, label: 'Home',     path: '/',        end: true },
      { icon: ShoppingCart,    label: 'POS',      path: '/pos'               },
      { icon: Wrench,          label: 'Repairs',  path: '/repairs'           },
      { icon: BarChart3,       label: 'Reports',  path: '/reports'           },
    ];
  }, [user?.role, permissions]);

  if (!tabs.length) return null;

  return (
    <nav className={styles.nav} role="navigation" aria-label="Primary Navigation">
      {tabs.slice(0, 4).map((tab: any) => (
        <NavLink
          key={tab.path}
          to={tab.path}
          end={tab.end}
          className={({ isActive }) =>
            [styles.tab, isActive && styles.tabActive].filter(Boolean).join(' ')
          }
        >
          <tab.icon size={22} className={styles.tabIcon} />
          <span className={styles.tabLabel}>{tab.label}</span>
        </NavLink>
      ))}

      {/* More / Approvals */}
      <div className={styles.tab} style={{ position: 'relative' }}>
        <ApprovalsNotificationButton variant="mobile-tab" />
        <button
          className={styles.menuTabBtn}
          onClick={onMenuOpen}
          aria-label="Open full menu"
        >
          <Menu size={22} className={styles.tabIcon} />
          <span className={styles.tabLabel}>More</span>
        </button>
      </div>
    </nav>
  );
};
