import React from 'react';
import {
  BarChart3,
  CheckSquare,
  Clock,
  FileSpreadsheet,
  FileText,
  Key,
  LayoutDashboard,
  Layers,
  Lock,
  MessageSquare,
  Send,
  Shield,
  ShieldAlert,
  Sparkles,
  UserCog,
  Users,
  Zap,
} from 'lucide-react';
import { useApp } from '../context/AppContext';

export const Sidebar: React.FC = () => {
  const {
    activeTab,
    setActiveTab,
    currentUser,
    tasks,
    notifications,
    isMobileMenuOpen,
    setIsMobileMenuOpen,
    slackConfig,
    isDataEncrypted,
  } = useApp();

  const pendingApprovalsCount = tasks.filter(
    (t) => t.status === 'pending_approval' || t.approvalStatus === 'pending'
  ).length;

  const urgentTasksCount = tasks.filter(
    (t) =>
      t.status !== 'completed' &&
      (t.priority === 'critical' || (t.autoPriorityScore && t.autoPriorityScore >= 80))
  ).length;

  const navItems = [
    {
      id: 'dashboard',
      label: 'Real-time Analytics',
      icon: LayoutDashboard,
      badge: null,
      description: 'Efficiency & Velocity Dashboard',
    },
    {
      id: 'tasks',
      label: 'Tasks & Delegation',
      icon: CheckSquare,
      badge: urgentTasksCount > 0 ? `${urgentTasksCount} Urgent` : null,
      badgeColor: 'bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300',
      description: 'Dept Head Task Matrix & Deadlines',
    },
    {
      id: 'productivity',
      label: 'Productivity Monitor',
      icon: Clock,
      badge: 'Live',
      badgeColor: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300',
      description: 'Employee Sessions & Focus Tracking',
    },
    {
      id: 'approvals',
      label: 'Approvals & Sign-off',
      icon: ShieldAlert,
      badge: pendingApprovalsCount > 0 ? `${pendingApprovalsCount}` : null,
      badgeColor: 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300',
      description: 'Manager Review Workflow',
    },
    {
      id: 'team',
      label: 'Team & RBAC Roles',
      icon: UserCog,
      badge: null,
      description: 'Permissions & User Management',
    },
    {
      id: 'reports',
      label: 'Monthly Reports',
      icon: FileSpreadsheet,
      badge: 'PDF/CSV',
      badgeColor: 'bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300',
      description: 'Activity & Efficiency Exports',
    },
    {
      id: 'audit',
      label: 'Audit & Hash Logs',
      icon: Shield,
      badge: 'SHA-256',
      badgeColor: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300',
      description: 'Immutable Cryptographic Stream',
    },
    {
      id: 'settings',
      label: 'Slack & Security',
      icon: Send,
      badge: slackConfig.isConnected ? 'Synced' : null,
      badgeColor: 'bg-purple-100 text-purple-700 dark:bg-purple-950 dark:text-purple-300',
      description: 'Webhooks & Encryption Vault',
    },
  ];

  const handleNavClick = (tabId: string) => {
    setActiveTab(tabId);
    setIsMobileMenuOpen(false);
  };

  return (
    <>
      {/* Mobile Backdrop */}
      {isMobileMenuOpen && (
        <div
          id="mobile-nav-backdrop"
          onClick={() => setIsMobileMenuOpen(false)}
          className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-40 lg:hidden"
        />
      )}

      {/* Sidebar container */}
      <aside
        id="app-sidebar"
        className={`fixed lg:sticky top-16 left-0 z-40 h-[calc(100vh-4rem)] w-64 flex-shrink-0 bg-slate-50/70 dark:bg-slate-900/90 border-r border-slate-200 dark:border-slate-800 p-4 flex flex-col justify-between transition-transform duration-200 ease-in-out lg:translate-x-0 ${
          isMobileMenuOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        {/* Top section with navigation */}
        <div className="space-y-6 overflow-y-auto">
          {/* Active User mini card */}
          <div className="p-3 rounded-xl bg-white dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700/60 shadow-xs">
            <div className="flex items-center gap-3">
              <img
                src={currentUser.avatar}
                alt={currentUser.name}
                className="w-10 h-10 rounded-xl object-cover ring-2 ring-blue-500/20"
              />
              <div className="min-w-0 flex-1">
                <p className="text-xs font-bold text-slate-900 dark:text-white truncate">
                  {currentUser.name}
                </p>
                <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                  {currentUser.department}
                </p>
              </div>
            </div>
            <div className="mt-3 pt-2.5 border-t border-slate-100 dark:border-slate-700/40 flex items-center justify-between text-[11px]">
              <span className="text-slate-500 dark:text-slate-400">Productivity Score:</span>
              <span className="font-bold text-emerald-600 dark:text-emerald-400">
                {currentUser.productivityScore}%
              </span>
            </div>
          </div>

          {/* Navigation Links */}
          <nav className="space-y-1">
            <p className="px-3 text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500 mb-2">
              Enterprise Workspace
            </p>
            {navItems.map((item) => {
              const Icon = item.icon;
              const isActive = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  id={`nav-link-${item.id}`}
                  onClick={() => handleNavClick(item.id)}
                  className={`w-full flex items-center justify-between px-3 py-2.5 rounded-xl text-xs font-medium transition-all ${
                    isActive
                      ? 'bg-blue-600 text-white shadow-md shadow-blue-500/20 font-semibold'
                      : 'text-slate-700 dark:text-slate-300 hover:bg-slate-200/60 dark:hover:bg-slate-800/60'
                  }`}
                >
                  <div className="flex items-center gap-2.5 truncate">
                    <Icon className={`w-4 h-4 flex-shrink-0 ${isActive ? 'text-white' : 'text-slate-500 dark:text-slate-400'}`} />
                    <span className="truncate">{item.label}</span>
                  </div>
                  {item.badge && (
                    <span
                      className={`text-[10px] px-1.5 py-0.5 rounded-md font-bold flex-shrink-0 ${
                        isActive ? 'bg-white/20 text-white' : item.badgeColor || 'bg-slate-200 text-slate-700'
                      }`}
                    >
                      {item.badge}
                    </span>
                  )}
                </button>
              );
            })}
          </nav>
        </div>

        {/* Bottom system security box */}
        <div className="pt-4 border-t border-slate-200 dark:border-slate-800 space-y-2">
          <div className="p-3 rounded-xl bg-gradient-to-br from-slate-100 to-slate-200/50 dark:from-slate-800/80 dark:to-slate-800/40 border border-slate-200 dark:border-slate-700/60">
            <div className="flex items-center gap-2 text-xs font-semibold text-slate-800 dark:text-slate-200">
              <Lock className="w-3.5 h-3.5 text-blue-500" />
              <span>RBAC & SOC2 Shield</span>
            </div>
            <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1 leading-snug">
              Role: <span className="font-semibold text-blue-600 dark:text-blue-400 uppercase">{currentUser.role.replace('_', ' ')}</span>
            </p>
            <div className="mt-2 flex items-center justify-between text-[10px] text-slate-500">
              <span>Auto-Priority: <strong className="text-emerald-500">Active</strong></span>
              <span>Slack: <strong className="text-purple-500">Synced</strong></span>
            </div>
          </div>
        </div>
      </aside>
    </>
  );
};
