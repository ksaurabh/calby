import type { ReactNode } from 'react';
import type { View } from '../../types/view';
import { ResizeHandle, useResizableWidth } from '../common';
import { Header } from './Header';
import { Sidebar } from './Sidebar';

interface LayoutProps {
  currentView: View;
  onViewChange: (view: View) => void;
  children: ReactNode;
}

export function Layout({ currentView, onViewChange, children }: LayoutProps) {
  const sidebar = useResizableWidth('calby:sidebar-width', 224, 160, 400);
  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      <Header />
      <div className="flex flex-1">
        <Sidebar currentView={currentView} onViewChange={onViewChange} width={sidebar.width} />
        <ResizeHandle label="Resize navigation" className="hidden md:flex -ml-1.5" {...sidebar.handleProps} />
        <main className="flex-1 min-w-0 p-6 max-w-7xl w-full mx-auto">{children}</main>
      </div>
    </div>
  );
}
