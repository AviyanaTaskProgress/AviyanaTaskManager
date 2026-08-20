import React, { useState } from 'react';
import {
  Check,
  CheckCircle2,
  Key,
  Lock,
  Plus,
  Search,
  Shield,
  ShieldAlert,
  ShieldCheck,
  UserCheck,
  UserCog,
  UserPlus,
  Users,
  X,
} from 'lucide-react';
import { useApp } from '../context/AppContext';
import { Department, User, UserPermissions, UserRole } from '../types';
import { ROLE_LABEL, ROLE_BADGE_CLASSES, defaultPermissionsForRole } from '../lib/roles';
import { ChiefOfficerAccessPanel } from './ChiefOfficerAccessPanel';

export const TeamManagementView: React.FC = () => {
  const { users, currentUser, updateUserPermissions, addUser } = useApp();

  const [searchQuery, setSearchQuery] = useState('');
  const [selectedDept, setSelectedDept] = useState('All');
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [isAddUserOpen, setIsAddUserOpen] = useState(false);
  const [justProvisioned, setJustProvisioned] = useState<{ name: string; email: string } | null>(null);

  // New User Form State
  const [newName, setNewName] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [newRole, setNewRole] = useState<UserRole>('staff');
  const [newDept, setNewDept] = useState<Department>(
    currentUser.role === 'dept_head' ? currentUser.department : 'Engineering'
  );
  const [newTitle, setNewTitle] = useState('');

  // What roles/departments the signed-in admin is allowed to provision,
  // mirrors the RLS policies in 05_role_based_access.sql.
  const canProvisionUsers =
    currentUser.role === 'super_admin' ||
    currentUser.role === 'dept_head' ||
    (currentUser.role === 'chief_officer' && currentUser.permissions.canManageUsers);

  const assignableRoles: UserRole[] =
    currentUser.role === 'super_admin'
      ? ['staff', 'dept_head', 'chief_officer', 'super_admin']
      : currentUser.role === 'chief_officer'
      ? ['staff', 'dept_head']
      : ['staff']; // dept_head can only add staff

  const deptLocked = currentUser.role === 'dept_head'; // always their own department

  const filteredUsers = users.filter((u) => {
    const matchesSearch =
      u.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      u.email.toLowerCase().includes(searchQuery.toLowerCase()) ||
      u.title.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesDept = selectedDept === 'All' || u.department === selectedDept;
    return matchesSearch && matchesDept;
  });

  const handleTogglePermission = async (
    userId: string,
    permissionKey: keyof UserPermissions,
    currentVal: boolean
  ) => {
    await updateUserPermissions(userId, { [permissionKey]: !currentVal });
  };

  const handleAddUserSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim() || !newEmail.trim()) return;

    const defaultPerms: UserPermissions = defaultPermissionsForRole(newRole);
    const effectiveDept = deptLocked ? currentUser.department : newDept;

    await addUser({
      name: newName,
      email: newEmail,
      role: newRole,
      department: effectiveDept,
      title: newTitle || `${newRole.toUpperCase()} in ${effectiveDept}`,
      avatar: `https://images.unsplash.com/photo-${1500000000000 + Math.floor(Math.random() * 90000000)}?w=150&auto=format&fit=crop&q=80`,
      status: 'active',
      productivityScore: 90,
      permissions: defaultPerms,
    });

    setJustProvisioned({ name: newName, email: newEmail });
    setIsAddUserOpen(false);
    setNewName('');
    setNewEmail('');
    setNewTitle('');
  };

  const permissionLabels: Array<{ key: keyof UserPermissions; label: string; desc: string }> = [
    { key: 'canCreateTasks', label: 'Delegate Tasks', desc: 'Create and assign tasks across departments' },
    { key: 'canApproveTasks', label: 'Approve & Sign-off', desc: 'Authorize task milestones and production rollouts' },
    { key: 'canManageUsers', label: 'Manage RBAC', desc: 'Modify user permissions and invite staff' },
    { key: 'canViewAuditLogs', label: 'Audit Logs Access', desc: 'Inspect encrypted SHA-256 system trails' },
    { key: 'canExportReports', label: 'Export Activity Reports', desc: 'Generate monthly PDF & CSV executive summaries' },
    { key: 'canConfigureSlack', label: 'Slack Webhook Control', desc: 'Update webhook URLs and notification triggers' },
    { key: 'canEditAllTasks', label: 'Global Task Override', desc: 'Edit or delete deliverables across all departments' },
    { key: 'canViewExecutiveAnalytics', label: 'Executive Analytics', desc: 'View high-level team efficiency & velocity' },
  ];

  return (
    <div id="team-management-view" className="space-y-6 animate-in fade-in duration-200">
      {/* Top Banner */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white dark:bg-slate-900 p-5 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <UserCog className="w-5 h-5 text-blue-600 dark:text-blue-400" />
            <h1 className="text-lg sm:text-xl font-bold text-slate-900 dark:text-white">
              User Management & Role-Based Access Control (RBAC)
            </h1>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Define department hierarchies, grant fine-grained permissions, and audit user roles.
          </p>
        </div>

        {canProvisionUsers && (
          <button
            id="open-add-user-modal-btn"
            onClick={() => setIsAddUserOpen(true)}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs shadow-md shadow-blue-500/25 transition-all"
          >
            <UserPlus className="w-4 h-4" />
            <span>Provision New User</span>
          </button>
        )}
      </div>

      {currentUser.role === 'super_admin' && (
        <ChiefOfficerAccessPanel users={users} />
      )}

      {/* Filter and Search Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-white dark:bg-slate-900 p-3.5 rounded-2xl border border-slate-200 dark:border-slate-800">
        <div className="relative flex-1">
          <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search users by name, email, or role title..."
            className="w-full pl-9 pr-4 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        <select
          value={selectedDept}
          onChange={(e) => setSelectedDept(e.target.value)}
          className="px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs text-slate-700 dark:text-slate-300 font-semibold focus:outline-none"
        >
          <option value="All">All Departments</option>
          <option value="Engineering">Engineering</option>
          <option value="Product & Design">Product & Design</option>
          <option value="Marketing">Marketing</option>
          <option value="Operations">Operations</option>
        </select>
      </div>

      {/* Users Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {filteredUsers.map((u) => (
          <div
            key={u.id}
            className="p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs flex flex-col justify-between space-y-4 hover:border-blue-300 dark:hover:border-blue-800 transition-colors"
          >
            <div className="space-y-3">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-3">
                  <img
                    src={u.avatar}
                    alt={u.name}
                    className="w-11 h-11 rounded-2xl object-cover ring-2 ring-blue-500/20"
                  />
                  <div>
                    <h3 className="font-bold text-sm text-slate-900 dark:text-white">
                      {u.name}
                    </h3>
                    <p className="text-xs text-slate-500 dark:text-slate-400">{u.title}</p>
                    <p className="text-[11px] text-slate-400">{u.email}</p>
                  </div>
                </div>

                <span
                  className={`px-2 py-0.5 rounded text-[10px] font-extrabold uppercase ${ROLE_BADGE_CLASSES[u.role]}`}
                >
                  {ROLE_LABEL[u.role]}
                </span>
              </div>

              {!u.accountActivated && (
                <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900 text-[10px] text-amber-700 dark:text-amber-300 font-semibold">
                  <UserPlus className="w-3 h-3 shrink-0" />
                  <span>Invited — hasn't signed up with {u.email} yet</span>
                </div>
              )}

              {/* Stats pill */}
              <div className="grid grid-cols-3 gap-2 p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800/60 text-center border border-slate-100 dark:border-slate-800 text-xs">
                <div>
                  <span className="text-[10px] text-slate-400 block">Productivity</span>
                  <strong className="text-emerald-600 dark:text-emerald-400 font-black">
                    {u.productivityScore}%
                  </strong>
                </div>
                <div>
                  <span className="text-[10px] text-slate-400 block">Done</span>
                  <strong className="text-slate-800 dark:text-slate-200">
                    {u.tasksCompleted}
                  </strong>
                </div>
                <div>
                  <span className="text-[10px] text-slate-400 block">Hours</span>
                  <strong className="text-slate-800 dark:text-slate-200">
                    {u.hoursLoggedThisMonth}h
                  </strong>
                </div>
              </div>
            </div>

            {/* Permission Matrix Action */}
            <div className="pt-3 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between">
              <span className="text-[11px] text-slate-400">
                Department: <strong>{u.department}</strong>
              </span>

              <button
                id={`edit-perms-btn-${u.id}`}
                onClick={() => setEditingUser(u)}
                className="px-3 py-1.5 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 text-xs font-bold transition-colors flex items-center gap-1"
              >
                <Key className="w-3 h-3 text-blue-500" />
                <span>Permissions Matrix</span>
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* Edit Permissions Modal */}
      {editingUser && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="w-full max-w-xl bg-white dark:bg-slate-900 rounded-2xl p-5 sm:p-6 border border-slate-200 dark:border-slate-800 shadow-2xl space-y-5 max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-4">
              <div className="flex items-center gap-3">
                <img
                  src={editingUser.avatar}
                  alt={editingUser.name}
                  className="w-10 h-10 rounded-xl object-cover ring-2 ring-blue-500/20"
                />
                <div>
                  <h3 className="font-bold text-base text-slate-900 dark:text-white">
                    {editingUser.name} — Access Control
                  </h3>
                  <p className="text-xs text-slate-400">
                    {editingUser.title} • {editingUser.role.toUpperCase()}
                  </p>
                </div>
              </div>

              <button
                onClick={() => setEditingUser(null)}
                className="p-2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto space-y-3 pr-1">
              <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">
                Granular Security Privileges
              </p>

              {permissionLabels.map(({ key, label, desc }) => {
                const isEnabled = editingUser.permissions[key];
                return (
                  <div
                    key={key}
                    className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200/80 dark:border-slate-700/60 flex items-center justify-between gap-3"
                  >
                    <div>
                      <p className="text-xs font-bold text-slate-900 dark:text-white">
                        {label}
                      </p>
                      <p className="text-[11px] text-slate-500 dark:text-slate-400">{desc}</p>
                    </div>

                    <button
                      id={`toggle-perm-${key}`}
                      onClick={() => {
                        handleTogglePermission(editingUser.id, key, isEnabled);
                        setEditingUser((prev) =>
                          prev
                            ? {
                                ...prev,
                                permissions: { ...prev.permissions, [key]: !isEnabled },
                              }
                            : null
                        );
                      }}
                      className={`w-11 h-6 flex items-center rounded-full p-1 transition-colors ${
                        isEnabled ? 'bg-blue-600 justify-end' : 'bg-slate-300 dark:bg-slate-700 justify-start'
                      }`}
                    >
                      <span className="w-4 h-4 rounded-full bg-white shadow-xs" />
                    </button>
                  </div>
                );
              })}
            </div>

            <div className="pt-3 border-t border-slate-100 dark:border-slate-800 flex justify-end">
              <button
                onClick={() => setEditingUser(null)}
                className="px-5 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs shadow-md transition-colors"
              >
                Done & Apply Changes
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Post-provisioning instructions */}
      {justProvisioned && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-white dark:bg-slate-900 rounded-2xl p-6 border border-slate-200 dark:border-slate-800 shadow-2xl space-y-4">
            <div className="flex items-center gap-2 text-emerald-600 dark:text-emerald-400">
              <CheckCircle2 className="w-5 h-5" />
              <h3 className="font-bold text-base text-slate-900 dark:text-white">
                {justProvisioned.name} was added to the directory
              </h3>
            </div>
            <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
              We don't set passwords for people — that has to be done by the
              person themselves, for security. Their role and permissions are
              already saved. To activate their login, ask them to:
            </p>
            <ol className="text-xs text-slate-700 dark:text-slate-300 space-y-1.5 list-decimal list-inside bg-slate-50 dark:bg-slate-800/60 rounded-xl p-3">
              <li>Open the Aviyana login page</li>
              <li>
                Tap <strong>"Don't have an account? Sign up"</strong>
              </li>
              <li>
                Sign up using this exact email:{' '}
                <strong className="text-slate-900 dark:text-white">{justProvisioned.email}</strong> and
                a password of their choosing
              </li>
            </ol>
            <p className="text-[11px] text-slate-400">
              Their account will automatically link to the role you just set —
              they won't be created as a fresh employee-level account.
            </p>
            <div className="flex justify-end pt-2">
              <button
                onClick={() => setJustProvisioned(null)}
                className="px-5 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs shadow-md"
              >
                Got it
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add User Modal */}
      {isAddUserOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="w-full max-w-lg bg-white dark:bg-slate-900 rounded-2xl p-5 sm:p-6 border border-slate-200 dark:border-slate-800 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
              <h3 className="font-bold text-base text-slate-900 dark:text-white">
                Provision New Team Member (RBAC)
              </h3>
              <button
                onClick={() => setIsAddUserOpen(false)}
                className="p-1 text-slate-400 hover:text-slate-600"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleAddUserSubmit} className="space-y-4 text-xs">
              <div>
                <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">
                  Full Name *
                </label>
                <input
                  type="text"
                  required
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="e.g. Jordan Miller"
                  className="w-full p-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
                />
              </div>

              <div>
                <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">
                  Corporate Email *
                </label>
                <input
                  type="email"
                  required
                  value={newEmail}
                  onChange={(e) => setNewEmail(e.target.value)}
                  placeholder="e.g. jordan.miller@enterprise.corp"
                  className="w-full p-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">
                    Department
                  </label>
                  {deptLocked ? (
                    <div className="w-full p-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/60 text-slate-500 dark:text-slate-400">
                      {currentUser.department} <span className="text-[10px]">(your department)</span>
                    </div>
                  ) : (
                    <select
                      value={newDept}
                      onChange={(e) => setNewDept(e.target.value as Department)}
                      className="w-full p-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
                    >
                      <option value="Engineering">Engineering</option>
                      <option value="Product & Design">Product & Design</option>
                      <option value="Marketing">Marketing</option>
                      <option value="Operations">Operations</option>
                      <option value="Human Resources">HR</option>
                      <option value="Sales & Growth">Sales</option>
                    </select>
                  )}
                </div>

                <div>
                  <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">
                    RBAC Role Tier
                  </label>
                  <select
                    value={newRole}
                    onChange={(e) => setNewRole(e.target.value as UserRole)}
                    className="w-full p-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white font-bold"
                  >
                    {assignableRoles.map((r) => (
                      <option key={r} value={r}>
                        {ROLE_LABEL[r]}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">
                  Professional Title
                </label>
                <input
                  type="text"
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  placeholder="e.g. Infrastructure Security Engineer"
                  className="w-full p-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
                />
              </div>

              <div className="pt-3 border-t border-slate-100 dark:border-slate-800 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setIsAddUserOpen(false)}
                  className="px-4 py-2 rounded-xl text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-bold shadow-md"
                >
                  Provision User
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
