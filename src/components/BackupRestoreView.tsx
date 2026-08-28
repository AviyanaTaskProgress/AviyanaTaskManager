import React, { useEffect, useState } from 'react';
import {
  AlertTriangle,
  ArchiveRestore,
  Calendar,
  Database,
  Download,
  RotateCcw,
  ShieldAlert,
  Trash2,
} from 'lucide-react';
import { db } from '../lib/db';
import { BackupRow, BackupSettingsRow } from '../lib/api';
import { showToast, errorMessage } from '../lib/toast';

const FREQUENCY_LABEL: Record<BackupSettingsRow['frequency'], string> = {
  daily: 'Daily',
  weekly: 'Weekly',
  monthly: 'Monthly',
};

const FREQUENCY_DAYS: Record<BackupSettingsRow['frequency'], number> = {
  daily: 1,
  weekly: 7,
  monthly: 30,
};

export const BackupRestoreView: React.FC = () => {
  const [backups, setBackups] = useState<BackupRow[]>([]);
  const [settings, setSettings] = useState<BackupSettingsRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [isBackingUp, setIsBackingUp] = useState(false);
  const [label, setLabel] = useState('');
  const [savingFrequency, setSavingFrequency] = useState(false);
  const [confirmRestoreId, setConfirmRestoreId] = useState<string | null>(null);
  const [confirmText, setConfirmText] = useState('');
  const [isRestoring, setIsRestoring] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const [b, s] = await Promise.all([db.listBackups(), db.getBackupSettings()]);
      setBackups(b);
      setSettings(s);
    } catch (err) {
      showToast('error', `Couldn't load backups: ${errorMessage(err)}`);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const handleBackupNow = async () => {
    setIsBackingUp(true);
    try {
      await db.createBackup(label.trim() || undefined);
      setLabel('');
      showToast('success', 'Backup created successfully.');
      await load();
    } catch (err) {
      showToast('error', `Backup failed: ${errorMessage(err)}`);
    } finally {
      setIsBackingUp(false);
    }
  };

  const handleFrequencyChange = async (frequency: BackupSettingsRow['frequency']) => {
    setSavingFrequency(true);
    try {
      await db.updateBackupFrequency(frequency);
      await load();
    } catch (err) {
      showToast('error', `Couldn't update schedule: ${errorMessage(err)}`);
    } finally {
      setSavingFrequency(false);
    }
  };

  const handleRestore = async (id: string) => {
    if (confirmText !== 'RESTORE') return;
    setIsRestoring(true);
    try {
      const result = await db.restoreBackup(id);
      showToast(
        'success',
        `Restore complete. ${result.users_restored}/${result.users_in_backup} users restored` +
          (result.users_skipped > 0 ? ` (${result.users_skipped} skipped — their login was deleted since this backup).` : '.')
      );
      setConfirmRestoreId(null);
      setConfirmText('');
      await load();
    } catch (err) {
      showToast('error', `Restore failed: ${errorMessage(err)}`);
    } finally {
      setIsRestoring(false);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await db.deleteBackup(id);
      setConfirmDeleteId(null);
      await load();
    } catch (err) {
      showToast('error', `Couldn't delete backup: ${errorMessage(err)}`);
    }
  };

  const lastBackupAt = backups[0]?.created_at ? new Date(backups[0].created_at) : null;
  const daysSinceLastBackup = lastBackupAt
    ? Math.floor((Date.now() - lastBackupAt.getTime()) / (1000 * 60 * 60 * 24))
    : null;
  const isOverdue =
    settings && daysSinceLastBackup !== null && daysSinceLastBackup >= FREQUENCY_DAYS[settings.frequency];
  const neverBackedUp = backups.length === 0;

  if (loading) {
    return <div className="p-8 text-sm text-slate-400">Loading backups\u2026</div>;
  }

  return (
    <div className="space-y-6 max-w-4xl">
      <div>
        <h2 className="text-lg font-bold text-slate-900 dark:text-white flex items-center gap-2">
          <Database className="w-5 h-5 text-blue-600" />
          Backup &amp; Restore
        </h2>
        <p className="text-xs text-slate-400 mt-1">
          Super Admin only. Snapshots every task, user, chat, notification, and audit log record in the system.
        </p>
      </div>

      {(neverBackedUp || isOverdue) && (
        <div className="flex items-start gap-3 p-4 rounded-2xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900">
          <AlertTriangle className="w-5 h-5 text-amber-600 dark:text-amber-400 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-bold text-amber-800 dark:text-amber-300">
              {neverBackedUp ? 'No backup has ever been taken' : 'Backup overdue'}
            </p>
            <p className="text-xs text-amber-700 dark:text-amber-400 mt-0.5">
              {neverBackedUp
                ? 'Create your first backup below.'
                : `Last backup was ${daysSinceLastBackup} day${daysSinceLastBackup === 1 ? '' : 's'} ago. Schedule is set to ${settings ? FREQUENCY_LABEL[settings.frequency].toLowerCase() : ''}.`}
            </p>
          </div>
        </div>
      )}

      {/* Schedule reminder setting */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-5">
        <div className="flex items-center gap-2 mb-3">
          <Calendar className="w-4 h-4 text-slate-400" />
          <h3 className="text-sm font-bold text-slate-900 dark:text-white">Backup Reminder Schedule</h3>
        </div>
        <p className="text-xs text-slate-400 mb-3">
          This is a reminder, not an automatic job \u2014 backups are always triggered manually below by a Super
          Admin. The banner above will appear once this many days have passed since the last backup.
        </p>
        <div className="flex gap-2">
          {(['daily', 'weekly', 'monthly'] as const).map((freq) => (
            <button
              key={freq}
              type="button"
              disabled={savingFrequency}
              onClick={() => handleFrequencyChange(freq)}
              className={`px-4 py-2 rounded-xl text-xs font-bold transition-colors disabled:opacity-50 ${
                settings?.frequency === freq
                  ? 'bg-blue-600 text-white'
                  : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
              }`}
            >
              {FREQUENCY_LABEL[freq]}
            </button>
          ))}
        </div>
      </div>

      {/* Backup now */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-5">
        <h3 className="text-sm font-bold text-slate-900 dark:text-white mb-3 flex items-center gap-2">
          <Download className="w-4 h-4 text-emerald-600" />
          Create a Backup Now
        </h3>
        <div className="flex gap-2">
          <input
            type="text"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="Optional label (e.g. 'Before rollout')"
            className="flex-1 px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white text-xs focus:ring-2 focus:ring-blue-500 focus:outline-none"
          />
          <button
            type="button"
            onClick={handleBackupNow}
            disabled={isBackingUp}
            className="px-5 py-2 rounded-xl bg-emerald-600 text-white text-xs font-bold hover:bg-emerald-700 disabled:opacity-50 flex items-center gap-2"
          >
            <Download className="w-3.5 h-3.5" />
            {isBackingUp ? 'Backing up\u2026' : 'Backup Now'}
          </button>
        </div>
      </div>

      {/* Backup history */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 overflow-hidden">
        <div className="p-5 pb-0">
          <h3 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
            <ArchiveRestore className="w-4 h-4 text-slate-400" />
            Backup History
          </h3>
        </div>
        {backups.length === 0 ? (
          <p className="p-8 text-center text-xs text-slate-400 italic">No backups yet.</p>
        ) : (
          <div className="divide-y divide-slate-100 dark:divide-slate-800 mt-3">
            {backups.map((b) => (
              <div key={b.id} className="p-4 flex items-center justify-between gap-4">
                <div className="min-w-0">
                  <p className="text-xs font-bold text-slate-900 dark:text-white truncate">
                    {b.label || 'Untitled backup'}
                  </p>
                  <p className="text-[11px] text-slate-400 mt-0.5">
                    {new Date(b.created_at).toLocaleString()}
                  </p>
                  <p className="text-[10px] text-slate-400 mt-1">
                    {Object.entries(b.table_counts)
                      .map(([k, v]) => `${v} ${k.replace('_', ' ')}`)
                      .join(' \u00B7 ')}
                  </p>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <button
                    type="button"
                    onClick={() => {
                      setConfirmRestoreId(b.id);
                      setConfirmText('');
                    }}
                    className="px-3 py-1.5 rounded-lg bg-blue-50 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300 text-[11px] font-bold hover:bg-blue-100 dark:hover:bg-blue-900 flex items-center gap-1"
                  >
                    <RotateCcw className="w-3 h-3" /> Restore
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmDeleteId(b.id)}
                    aria-label="Delete backup"
                    title="Delete backup"
                    className="p-1.5 rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/40"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Restore confirmation modal */}
      {confirmRestoreId && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-6 max-w-md w-full">
            <div className="flex items-center gap-2 mb-3">
              <ShieldAlert className="w-5 h-5 text-red-600" />
              <h3 className="text-sm font-bold text-slate-900 dark:text-white">Confirm Restore</h3>
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400 mb-3">
              This replaces <strong>all current tasks, users, chat, notifications, and audit logs</strong> with
              the contents of this backup. A safety snapshot of the current state is taken automatically first,
              so this can itself be undone by restoring that snapshot afterward \u2014 but nothing created since
              this backup was taken will otherwise survive.
            </p>
            <p className="text-xs text-slate-500 dark:text-slate-400 mb-3">
              Type <strong>RESTORE</strong> to confirm.
            </p>
            <input
              type="text"
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white text-xs mb-4 focus:ring-2 focus:ring-red-500 focus:outline-none"
              placeholder="RESTORE"
            />
            <div className="flex gap-2 justify-end">
              <button
                type="button"
                onClick={() => {
                  setConfirmRestoreId(null);
                  setConfirmText('');
                }}
                className="px-4 py-2 rounded-xl text-xs font-bold text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={confirmText !== 'RESTORE' || isRestoring}
                onClick={() => handleRestore(confirmRestoreId)}
                className="px-4 py-2 rounded-xl text-xs font-bold bg-red-600 text-white hover:bg-red-700 disabled:opacity-40"
              >
                {isRestoring ? 'Restoring\u2026' : 'Restore Now'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete confirmation modal */}
      {confirmDeleteId && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-6 max-w-sm w-full">
            <h3 className="text-sm font-bold text-slate-900 dark:text-white mb-2">Delete this backup?</h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 mb-4">
              This only removes the backup file itself \u2014 it does not affect any current data.
            </p>
            <div className="flex gap-2 justify-end">
              <button
                type="button"
                onClick={() => setConfirmDeleteId(null)}
                className="px-4 py-2 rounded-xl text-xs font-bold text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => handleDelete(confirmDeleteId)}
                className="px-4 py-2 rounded-xl text-xs font-bold bg-red-600 text-white hover:bg-red-700"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
