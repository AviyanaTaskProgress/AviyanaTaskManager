import React, { useState } from 'react';
import { Download, Search, Shield } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { AuditLog } from '../types';
import { db } from '../lib/db';
import { mapAuditLog } from '../lib/mappers';
import { showToast, errorMessage } from '../lib/toast';

const PAGE_SIZE = 100;

export const AuditLogsView: React.FC = () => {
  const { auditLogs, currentUser } = useApp();

  const [categoryFilter, setCategoryFilter] = useState<string>('All');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [olderLogs, setOlderLogs] = useState<AuditLog[]>([]);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);

  const allLogs = [...auditLogs, ...olderLogs];

  const handleLoadMore = async () => {
    setIsLoadingMore(true);
    try {
      const oldest = allLogs[allLogs.length - 1];
      const rows = await db.listAuditLogs({ limit: PAGE_SIZE, before: oldest?.timestamp });
      const mapped = rows.map(mapAuditLog);
      setOlderLogs((prev) => [...prev, ...mapped]);
      if (mapped.length < PAGE_SIZE) setHasMore(false);
    } catch (err) {
      showToast('error', `Couldn't load more audit logs: ${errorMessage(err)}`);
    } finally {
      setIsLoadingMore(false);
    }
  };

  const filteredLogs = allLogs.filter((log) => {
    const matchesCat = categoryFilter === 'All' || log.category === categoryFilter;
    const matchesSearch =
      log.action.toLowerCase().includes(searchQuery.toLowerCase()) ||
      log.actorName.toLowerCase().includes(searchQuery.toLowerCase()) ||
      log.details.toLowerCase().includes(searchQuery.toLowerCase()) ||
      log.target.toLowerCase().includes(searchQuery.toLowerCase());
    return matchesCat && matchesSearch;
  });

  const handleExportAuditCSV = () => {
    const headers = ['ID', 'Timestamp', 'Actor', 'Role', 'Action', 'Category', 'Target', 'Details', 'Node Hash', 'SHA256 Signature'];
    const rows = filteredLogs.map((l) => [
      `"${l.id}"`,
      `"${l.timestamp}"`,
      `"${l.actorName}"`,
      `"${l.actorRole}"`,
      `"${l.action}"`,
      `"${l.category}"`,
      `"${l.target.replace(/"/g, '""')}"`,
      `"${l.details.replace(/"/g, '""')}"`,
      `"${l.ipHash}"`,
      `"${l.encryptedSignature}"`,
    ]);

    const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `Aviyana_Audit_Trail_${new Date().toISOString().substring(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div id="audit-logs-view" className="space-y-6 animate-in fade-in duration-200">
      {/* Top Banner */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white dark:bg-slate-900 p-5 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <Shield className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
            <h1 className="text-lg sm:text-xl font-bold text-slate-900 dark:text-white">
              Audit Trail & Signatures
            </h1>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Signed, append-only log of every administrative, delegation, and security action. Each
            entry's signature is generated server-side (HMAC-SHA256) so entries can't be altered undetected.
          </p>
        </div>

        <button
          onClick={handleExportAuditCSV}
          className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 text-slate-800 dark:text-slate-200 text-xs font-bold border border-slate-200 dark:border-slate-700 transition-colors shadow-2xs"
        >
          <Download className="w-3.5 h-3.5" />
          <span>Export Audit Trail</span>
        </button>
      </div>

      {/* Filter and Search Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-white dark:bg-slate-900 p-3.5 rounded-2xl border border-slate-200 dark:border-slate-800 text-xs">
        <div className="relative flex-1">
          <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search by actor, action, target, or details..."
            className="w-full pl-9 pr-4 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        <div className="flex items-center gap-2">
          <span className="font-bold text-slate-500">Category:</span>
          <select
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
            className="px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 font-semibold focus:outline-none"
          >
            <option value="All">All Categories</option>
            <option value="task">Task Operations</option>
            <option value="user">User & RBAC</option>
            <option value="security">Security & Encryption</option>
            <option value="slack">Slack Webhooks</option>
            <option value="approval">Approvals & Sign-offs</option>
          </select>
        </div>
      </div>

      {/* Audit Logs Table */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 overflow-hidden shadow-xs">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/80 text-slate-400 uppercase font-bold text-[10px]">
                <th className="p-3.5">Timestamp</th>
                <th className="p-3.5">Actor & Role</th>
                <th className="p-3.5">Action Event</th>
                <th className="p-3.5">Target</th>
                <th className="p-3.5">Details</th>
                <th className="p-3.5">SecNode</th>
                <th className="p-3.5">SHA-256 Hash</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60 font-medium">
              {filteredLogs.map((log) => (
                <tr key={log.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                  <td className="p-3.5 font-mono text-[11px] text-slate-500 whitespace-nowrap">
                    {log.timestamp}
                  </td>

                  <td className="p-3.5 whitespace-nowrap">
                    <p className="font-bold text-slate-900 dark:text-white">{log.actorName}</p>
                    <span className="text-[10px] text-slate-400 uppercase font-semibold">
                      {log.actorRole.replace('_', ' ')}
                    </span>
                  </td>

                  <td className="p-3.5 whitespace-nowrap">
                    <span
                      className={`px-2 py-0.5 rounded text-[10px] font-bold font-mono ${
                        log.category === 'security'
                          ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300'
                          : log.category === 'approval'
                          ? 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300'
                          : log.category === 'slack'
                          ? 'bg-purple-100 text-purple-700 dark:bg-purple-950 dark:text-purple-300'
                          : 'bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300'
                      }`}
                    >
                      {log.action}
                    </span>
                  </td>

                  <td className="p-3.5 font-semibold text-slate-800 dark:text-slate-200">
                    {log.target}
                  </td>

                  <td className="p-3.5 text-slate-600 dark:text-slate-300 max-w-xs truncate">
                    {log.details}
                  </td>

                  <td className="p-3.5 text-slate-400 text-[10px] whitespace-nowrap">
                    {log.ipHash}
                  </td>

                  <td className="p-3.5 font-mono text-[10px] text-indigo-600 dark:text-indigo-400 whitespace-nowrap">
                    {log.encryptedSignature}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="p-4 flex flex-col items-center gap-2 border-t border-slate-100 dark:border-slate-800">
          <p className="text-[11px] text-slate-400">
            Showing {filteredLogs.length} of {allLogs.length} loaded entries
          </p>
          {hasMore && (
            <button
              onClick={handleLoadMore}
              disabled={isLoadingMore}
              className="px-4 py-2 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 text-xs font-bold transition-colors disabled:opacity-50"
            >
              {isLoadingMore ? 'Loading…' : 'Load older entries'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
