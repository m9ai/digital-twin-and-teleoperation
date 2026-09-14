import type { ReactNode } from 'react';
import { BrandLogo } from './BrandLogo';

interface LayoutProps {
  children: ReactNode;
}

export function Layout({ children }: LayoutProps) {
  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-slate-950">
      <header className="flex h-14 items-center justify-between border-b border-slate-800 bg-slate-900 px-4">
        <div className="flex items-center gap-2">
          <BrandLogo className="h-6 w-6 text-cyan-400" />
          <h1 className="text-lg font-bold tracking-wide text-slate-100">
            ROS 2 Digital Twin & Teleoperation
          </h1>
        </div>
        <div className="text-xs font-medium text-slate-500">
          Embodied AI Platform
        </div>
      </header>
      <main className="flex-1 overflow-hidden">{children}</main>
    </div>
  );
}
