import { useAuth } from '../../context/AuthContext';
import type { View } from '../../types/view';

interface NavItem {
  view: View;
  label: string;
  icon: string;
  adminOnly?: boolean;
}

const NAV_ITEMS: NavItem[] = [
  { view: 'orgs', label: 'Organizations', icon: '▦' },
  { view: 'admin', label: 'Administration', icon: '⚙', adminOnly: true },
];

interface SidebarProps {
  currentView: View;
  onViewChange: (view: View) => void;
}

export function Sidebar({ currentView, onViewChange }: SidebarProps) {
  const { isAdmin } = useAuth();

  const items = NAV_ITEMS.filter(item => (item.adminOnly ? isAdmin : true));

  return (
    <aside className="w-56 bg-white border-r border-gray-200 flex-shrink-0 hidden md:block">
      <nav className="p-3 space-y-1">
        {items.map(item => (
          <button
            key={item.view}
            onClick={() => onViewChange(item.view)}
            className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
              currentView === item.view
                ? 'bg-blue-50 text-blue-700'
                : 'text-gray-700 hover:bg-gray-100'
            }`}
          >
            <span className="w-5 text-center text-base">{item.icon}</span>
            {item.label}
          </button>
        ))}
      </nav>
    </aside>
  );
}
