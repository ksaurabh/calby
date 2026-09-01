import type { ReactNode } from 'react';
import type { View } from '../../types/view';
import { Header } from './Header';
import { Sidebar } from './Sidebar';

interface LayoutProps {
  currentView: View;
  onViewChange: (view: View) => void;
  children: ReactNode;
}

export function Layout({ currentView, onViewChange, children }: LayoutProps) {
  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      <Header />
      <div className="flex flex-1">
        <Sidebar currentView={currentView} onViewChange={onViewChange} />
        <main className="flex-1 p-6 max-w-7xl w-full mx-auto">{children}</main>
      </div>
    </div>
  );
}
