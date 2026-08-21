import React, { useState, useRef, useEffect } from 'react';
import {
  Bell,
  CheckCircle2,
  Clock,
  Crown,
  Key,
  Layers,
  Lock,
  Menu,
  Moon,
  RefreshCw,
  Send,
  Shield,
  ShieldCheck,
  Sun,
  UserCheck,
  X,
  AlertTriangle,
  Radio,
} from 'lucide-react';
import { useApp } from '../context/AppContext';
import { UserRole } from '../types';
import { ROLE_LABEL, ROLE_LABEL_LONG, ROLE_BADGE_CLASSES, ROLE_BADGE_CLASSES_SOFT } from '../lib/roles';

const ROLE_ICON: Record<UserRole, React.ElementType> = {
  super_admin: Crown,
  chief_officer: ShieldCheck,
  dept_head: Shield,
  staff: UserCheck,
};

export const Navbar: React.FC = () => {
  const {
    currentUser,
    signOut,
    notifications,
    markNotificationAsRead,
    darkMode,
    setDarkMode,
    syncDeadlinesNow,
    slackConfig,
    isMobileMenuOpen,
    setIsMobileMenuOpen,
    setActiveTab,
  } = useApp();

  const [showRoleMenu, setShowRoleMenu] = useState(false);
  const [showNotifMenu, setShowNotifMenu] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);

  const roleMenuRef = useRef<HTMLDivElement>(null);
  const notifMenuRef = useRef<HTMLDivElement>(null);

  const unreadCount = notifications.filter((n) => !n.read).length;

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (roleMenuRef.current && !roleMenuRef.current.contains(event.target as Node)) {
        setShowRoleMenu(false);
      }
      if (notifMenuRef.current && !notifMenuRef.current.contains(event.target as Node)) {
        setShowNotifMenu(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleManualSync = () => {
    setIsSyncing(true);
    syncDeadlinesNow();
    setTimeout(() => setIsSyncing(false), 800);
  };

  return (
    <header
      id="app-navbar"
      className="sticky top-0 z-40 w-full border-b border-slate-200 dark:border-slate-800 bg-white/95 dark:bg-slate-900/95 backdrop-blur-md transition-colors"
    >
      <div className="w-full px-4 sm:px-6 lg:px-10 xl:px-14 h-16 flex items-center justify-between gap-4">
        {/* Left branding & mobile menu button */}
        <div className="flex items-center gap-3">
          <button
            id="mobile-menu-toggle-btn"
            onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
            className="lg:hidden p-2 rounded-lg text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
            aria-label="Toggle menu"
          >
            {isMobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>

          <div
            id="brand-logo-container"
            onClick={() => setActiveTab('dashboard')}
            className="flex items-center gap-2.5 cursor-pointer select-none group"
          >
            <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-blue-600 to-indigo-500 flex items-center justify-center text-white shadow-md shadow-blue-500/20 group-hover:scale-105 transition-transform">
              <Layers className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-bold text-lg tracking-tight text-slate-900 dark:text-white">
                  Aviyana
                </span>
                <span className="hidden sm:inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold bg-blue-50 dark:bg-blue-950/60 text-blue-700 dark:text-blue-400 border border-blue-200 dark:border-blue-800">
                  Enterprise
                </span>
              </div>
              <p className="text-[10px] text-slate-500 dark:text-slate-400 hidden sm:block">
                Auto-Deadline & Productivity Engine
              </p>
            </div>
          </div>
        </div>

        {/* Center: Security & Slack pills */}
        <div className="hidden md:flex items-center gap-3">
          {/* Slack Sync Status */}
          <button
            id="slack-sync-badge-btn"
            onClick={() => setActiveTab('settings')}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium border transition-colors ${
              slackConfig.isConnected
                ? 'bg-purple-50 dark:bg-purple-950/40 border-purple-200 dark:border-purple-800/80 text-purple-700 dark:text-purple-400'
                : 'bg-slate-100 dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-500'
            }`}
            title="Slack Webhook Real-time Notifications"
          >
            <Send className="w-3 h-3" />
            <span>Slack {slackConfig.channel}</span>
          </button>

          {/* Auto Deadline Sync Button */}
          <button
            id="manual-deadline-sync-btn"
            onClick={handleManualSync}
            disabled={isSyncing}
            className="flex items-center gap-1 px-2.5 py-1 rounded-md text-xs text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-700 transition-colors"
            title="Recalculate task urgency scores and sync deadlines"
          >
            <RefreshCw className={`w-3 h-3 ${isSyncing ? 'animate-spin text-blue-500' : ''}`} />
            <span>Sync</span>
          </button>
        </div>

        {/* Right side controls: Notifications, Dark mode, Role Switcher, Avatar */}
        <div className="flex items-center gap-2.5">
          {/* Notifications bell */}
          <div className="relative" ref={notifMenuRef}>
            <button
              id="notifications-dropdown-btn"
              onClick={() => setShowNotifMenu(!showNotifMenu)}
              className="relative p-2 rounded-lg text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
              aria-label="Notifications"
            >
              <Bell className="w-5 h-5" />
              {unreadCount > 0 && (
                <span className="absolute top-1 right-1 w-4 h-4 bg-red-500 text-white rounded-full text-[10px] font-bold flex items-center justify-center animate-bounce">
                  {unreadCount}
                </span>
              )}
            </button>

            {/* Notification Menu Dropdown */}
            {showNotifMenu && (
              <div
                id="notifications-menu"
                className="absolute right-0 mt-2 w-80 sm:w-96 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xl py-2 z-50 animate-in fade-in slide-in-from-top-2 duration-150"
              >
                <div className="px-4 py-2 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-sm text-slate-900 dark:text-white">
                      Notifications & Alerts
                    </span>
                    <span className="px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-blue-100 dark:bg-blue-900/60 text-blue-700 dark:text-blue-300">
                      {unreadCount} new
                    </span>
                  </div>
                  {unreadCount > 0 && (
                    <button
                      id="mark-all-read-btn"
                      onClick={() => markNotificationAsRead()}
                      className="text-xs text-blue-600 dark:text-blue-400 hover:underline"
                    >
                      Mark all read
                    </button>
                  )}
                </div>

                <div className="max-h-80 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800/60">
                  {notifications.length === 0 ? (
                    <div className="p-6 text-center text-xs text-slate-400">
                      No notifications yet
                    </div>
                  ) : (
                    notifications.map((notif) => (
                      <div
                        key={notif.id}
                        onClick={() => {
                          markNotificationAsRead(notif.id);
                          if (notif.taskId) setActiveTab('tasks');
                        }}
                        className={`p-3.5 hover:bg-slate-50 dark:hover:bg-slate-800/60 cursor-pointer transition-colors ${
                          !notif.read ? 'bg-blue-50/40 dark:bg-blue-950/20' : ''
                        }`}
                      >
                        <div className="flex items-start gap-2.5">
                          <div
                            className={`p-1.5 rounded-md mt-0.5 flex-shrink-0 ${
                              notif.urgency === 'critical'
                                ? 'bg-red-100 text-red-600 dark:bg-red-950 dark:text-red-400'
                                : notif.urgency === 'high'
                                ? 'bg-amber-100 text-amber-600 dark:bg-amber-950 dark:text-amber-400'
                                : 'bg-blue-100 text-blue-600 dark:bg-blue-950 dark:text-blue-400'
                            }`}
                          >
                            {notif.type === 'deadline' ? (
                              <Clock className="w-3.5 h-3.5" />
                            ) : notif.type === 'approval' ? (
                              <CheckCircle2 className="w-3.5 h-3.5" />
                            ) : notif.type === 'slack' ? (
                              <Send className="w-3.5 h-3.5" />
                            ) : (
                              <Bell className="w-3.5 h-3.5" />
                            )}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center justify-between gap-1">
                              <p className="text-xs font-semibold text-slate-900 dark:text-white truncate">
                                {notif.title}
                              </p>
                              <span className="text-[10px] text-slate-400 flex-shrink-0">
                                {notif.timestamp}
                              </span>
                            </div>
                            <p className="text-xs text-slate-600 dark:text-slate-300 mt-0.5 line-clamp-2">
                              {notif.message}
                            </p>
                          </div>
                        </div>
                      </div>
                    ))
                  )}
                </div>

                <div className="px-4 py-2 border-t border-slate-100 dark:border-slate-800 text-center">
                  <button
                    onClick={() => {
                      setShowNotifMenu(false);
                      setActiveTab('audit');
                    }}
                    className="text-xs font-medium text-slate-600 dark:text-slate-300 hover:text-blue-600 dark:hover:text-blue-400"
                  >
                    View System Audit Stream →
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Dark Mode toggle */}
          <button
            id="dark-mode-toggle-btn"
            onClick={() => setDarkMode((prev) => !prev)}
            className="p-2 rounded-lg text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
            aria-label="Toggle dark mode"
            title={darkMode ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
          >
            {darkMode ? <Sun className="w-5 h-5 text-amber-400" /> : <Moon className="w-5 h-5" />}
          </button>

          {/* Active Role Selector / Avatar Dropdown */}
          <div className="relative" ref={roleMenuRef}>
            <button
              id="user-profile-menu-btn"
              onClick={() => setShowRoleMenu(!showRoleMenu)}
              className="flex items-center gap-2.5 p-1.5 sm:px-2.5 sm:py-1.5 rounded-lg border border-slate-200 dark:border-slate-700/80 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
            >
              <img
                src={currentUser.avatar}
                alt={currentUser.name}
                className="w-7 h-7 rounded-full object-cover ring-2 ring-blue-500/30"
              />
              <div className="text-left hidden sm:block">
                <div className="flex items-center gap-1.5">
                  <span className="text-xs font-semibold text-slate-900 dark:text-white leading-tight">
                    {currentUser.name}
                  </span>
                </div>
                <span
                  className={`text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.2 rounded ${ROLE_BADGE_CLASSES[currentUser.role]}`}
                >
                  {ROLE_LABEL[currentUser.role]}
                </span>
              </div>
            </button>

            {/* Quick Role Switcher Dropdown */}
            {showRoleMenu && (
              <div
                id="role-switcher-menu"
                className="absolute right-0 mt-2 w-72 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xl py-2 z-50 animate-in fade-in slide-in-from-top-2 duration-150"
              >
                <div className="px-4 py-2 border-b border-slate-100 dark:border-slate-800">
                  <p className="text-xs text-slate-500 dark:text-slate-400">Signed in as</p>
                  <p className="text-sm font-bold text-slate-900 dark:text-white">{currentUser.name}</p>
                  <p className="text-xs text-slate-500">{currentUser.title}</p>
                </div>

                <div className="px-3 py-2">
                  <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider px-2 mb-1.5">
                    Role
                  </p>
                  <div
                    className={`w-full flex items-center gap-2 px-2.5 py-2 rounded-lg text-xs font-bold ${ROLE_BADGE_CLASSES_SOFT[currentUser.role]}`}
                  >
                    {React.createElement(ROLE_ICON[currentUser.role], { className: 'w-3.5 h-3.5' })}
                    <span>{ROLE_LABEL_LONG[currentUser.role]}</span>
                  </div>
                </div>

                <div className="px-3 py-2 border-t border-slate-100 dark:border-slate-800">
                  <button
                    onClick={async () => {
                      setShowRoleMenu(false);
                      await signOut();
                    }}
                    className="w-full flex items-center gap-2 px-2.5 py-2 rounded-lg text-xs font-semibold text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40 transition-colors"
                  >
                    <Lock className="w-3.5 h-3.5" />
                    <span>Sign out</span>
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </header>
  );
};
