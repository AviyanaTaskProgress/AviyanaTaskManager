import React, { useEffect, useState } from 'react';
import { ShieldCheck, Eye, CheckCircle2 } from 'lucide-react';
import { db } from '../lib/db';
import { useApp } from '../context/AppContext';
import { Department, User } from '../types';

const ALL_DEPARTMENTS: Department[] = [
  'Engineering',
  'Product & Design',
  'Marketing',
  'Operations',
  'Human Resources',
  'Sales & Growth',
];

interface Props {
  users: User[];
}

/**
 * Super Admin-only tool: dial a specific Chief Officer down to 'limited'
 * (read-only, no report/user-creation rights) for individual departments.
 * No override row for a department = 'full' access (the default).
 */
export const ChiefOfficerAccessPanel: React.FC<Props> = ({ users }) => {
  const { setChiefOfficerAccess } = useApp();
  const chiefOfficers = users.filter((u) => u.role === 'chief_officer');

  // chiefOfficerId -> department -> 'full' | 'limited'
  const [accessMap, setAccessMap] = useState<Record<string, Record<string, 'full' | 'limited'>>>({});
  const [loading, setLoading] = useState(true);
  const [savingKey, setSavingKey] = useState<string | null>(null);

  useEffect(() => {
    if (chiefOfficers.length === 0) {
      setLoading(false);
      return;
    }
    (async () => {
      try {
        const rows = await db.listAllChiefOfficerAccess();
        const map: Record<string, Record<string, 'full' | 'limited'>> = {};
        for (const row of rows) {
          map[row.chief_officer_id] = map[row.chief_officer_id] || {};
          map[row.chief_officer_id][row.department] = row.access_level;
        }
        setAccessMap(map);
      } catch {
        // Non-fatal — panel just shows everything as 'full' if this fails.
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chiefOfficers.length]);

  if (chiefOfficers.length === 0) return null;

  const levelFor = (chiefId: string, dept: string): 'full' | 'limited' =>
    accessMap[chiefId]?.[dept] ?? 'full';

  const toggle = async (chiefId: string, dept: Department) => {
    const key = `${chiefId}:${dept}`;
    const current = levelFor(chiefId, dept);
    const next: 'full' | 'limited' = current === 'full' ? 'limited' : 'full';

    setSavingKey(key);
    setAccessMap((prev) => ({
      ...prev,
      [chiefId]: { ...(prev[chiefId] || {}), [dept]: next },
    }));
    try {
      await setChiefOfficerAccess(chiefId, dept, next);
    } finally {
      setSavingKey(null);
    }
  };

  return (
    <div className="bg-white dark:bg-slate-900 p-5 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs space-y-4">
      <div className="flex items-center gap-2">
        <ShieldCheck className="w-4.5 h-4.5 text-amber-600 dark:text-amber-400" />
        <div>
          <h2 className="text-sm font-bold text-slate-900 dark:text-white">
            Chief Officer — Department Access
          </h2>
          <p className="text-[11px] text-slate-500 dark:text-slate-400">
            Chief Officers have full access (reports + user creation) to every department by
            default. Click a department to switch that officer to read-only there.
          </p>
        </div>
      </div>

      {loading ? (
        <p className="text-xs text-slate-400">Loading access map…</p>
      ) : (
        <div className="space-y-4">
          {chiefOfficers.map((officer) => (
            <div
              key={officer.id}
              className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-100 dark:border-slate-800"
            >
              <div className="flex items-center gap-2 mb-2.5">
                <img src={officer.avatar} alt={officer.name} className="w-6 h-6 rounded-lg object-cover" />
                <span className="text-xs font-bold text-slate-900 dark:text-white">{officer.name}</span>
                <span className="text-[11px] text-slate-400">{officer.email}</span>
              </div>
              <div className="flex flex-wrap gap-2">
                {ALL_DEPARTMENTS.map((dept) => {
                  const level = levelFor(officer.id, dept);
                  const key = `${officer.id}:${dept}`;
                  const isFull = level === 'full';
                  return (
                    <button
                      key={dept}
                      onClick={() => toggle(officer.id, dept)}
                      disabled={savingKey === key}
                      className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-semibold transition-colors disabled:opacity-50 ${
                        isFull
                          ? 'bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300'
                          : 'bg-amber-100 dark:bg-amber-950 text-amber-700 dark:text-amber-300'
                      }`}
                      title={isFull ? 'Full access — click to limit' : 'Limited (read-only) — click to restore full access'}
                    >
                      {isFull ? <CheckCircle2 className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
                      <span>{dept}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
