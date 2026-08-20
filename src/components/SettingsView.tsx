import React, { useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  ExternalLink,
  Key,
  Layers,
  Lock,
  MessageSquare,
  RefreshCw,
  Send,
  Shield,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';
import { useApp } from '../context/AppContext';

export const SettingsView: React.FC = () => {
  const {
    slackConfig,
    saveSlackConfig,
    testSlackIntegration,
  } = useApp();

  const [isSaving, setIsSaving] = useState(false);

  const [webhookUrl, setWebhookUrl] = useState(slackConfig.webhookUrl);
  const [channel, setChannel] = useState(slackConfig.channel);
  const [botName, setBotName] = useState(slackConfig.botName);
  const [notifyOnTaskAssigned, setNotifyOnTaskAssigned] = useState(slackConfig.notifyOnTaskAssigned);
  const [notifyOnDeadlineAlert, setNotifyOnDeadlineAlert] = useState(slackConfig.notifyOnDeadlineAlert);
  const [notifyOnApprovalRequested, setNotifyOnApprovalRequested] = useState(slackConfig.notifyOnApprovalRequested);
  const [notifyOnTaskCompleted, setNotifyOnTaskCompleted] = useState(slackConfig.notifyOnTaskCompleted);
  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);

  const handleSaveSlack = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);
    try {
      await saveSlackConfig({
        webhookUrl,
        channel,
        botName,
        notifyOnTaskAssigned,
        notifyOnDeadlineAlert,
        notifyOnApprovalRequested,
        notifyOnTaskCompleted,
      });
      setTestResult('Configuration saved successfully!');
    } catch (err) {
      setTestResult(err instanceof Error ? err.message : 'Failed to save configuration');
    } finally {
      setIsSaving(false);
      setTimeout(() => setTestResult(null), 3000);
    }
  };

  const handleTestSlack = async () => {
    setIsTesting(true);
    setTestResult(null);
    const { success, message } = await testSlackIntegration();
    setIsTesting(false);
    setTestResult(
      success ? 'Test packet delivered to Slack webhook successfully!' : `Delivery failed: ${message}`
    );
  };

  return (
    <div id="settings-view" className="space-y-6 animate-in fade-in duration-200">
      {/* Top Banner */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white dark:bg-slate-900 p-5 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <Send className="w-5 h-5 text-purple-600 dark:text-purple-400" />
            <h1 className="text-lg sm:text-xl font-bold text-slate-900 dark:text-white">
              Slack Webhook Integration & Security Vault
            </h1>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Configure real-time Slack broadcasts for impending deadlines, and role approvals.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left 2 Cols: Slack Configuration */}
        <div className="lg:col-span-2 space-y-6">
          {!slackConfig.isConnected && (
            <div className="p-5 rounded-2xl bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-900 space-y-3">
              <div className="flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                <h3 className="text-xs font-bold text-blue-900 dark:text-blue-200">
                  First-time setup — get a webhook URL from Slack
                </h3>
              </div>
              <ol className="text-xs text-blue-800 dark:text-blue-300 space-y-1.5 list-decimal list-inside">
                <li>
                  Go to{' '}
                  <a
                    href="https://api.slack.com/apps"
                    target="_blank"
                    rel="noreferrer"
                    className="underline font-semibold inline-flex items-center gap-0.5"
                  >
                    api.slack.com/apps <ExternalLink className="w-3 h-3" />
                  </a>{' '}
                  and create a new app ("Blank app") in your workspace
                </li>
                <li>
                  In the app's sidebar, open <strong>Incoming Webhooks</strong> and turn it on
                </li>
                <li>
                  Click <strong>Add New Webhook to Workspace</strong>, pick the channel you want alerts
                  in, and allow it
                </li>
                <li>Copy the Webhook URL Slack gives you and paste it below</li>
                <li>Save, then click Test Webhook Dispatch to confirm it reaches Slack</li>
              </ol>
            </div>
          )}

          <form
            onSubmit={handleSaveSlack}
            className="p-5 sm:p-6 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs space-y-5"
          >
            <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-xl bg-purple-600 text-white">
                  <Send className="w-4 h-4" />
                </div>
                <div>
                  <h2 className="text-sm font-bold text-slate-900 dark:text-white">
                    Slack Incoming Webhook Setup
                  </h2>
                  <p className="text-xs text-slate-400">
                    Broadcast tasks, escalations, and approval decisions directly to Slack channels
                  </p>
                </div>
              </div>

              <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-purple-100 dark:bg-purple-950 text-purple-700 dark:text-purple-300">
                {slackConfig.isConnected ? 'Connected' : 'Unconfigured'}
              </span>
            </div>

            <div className="space-y-4 text-xs">
              <div>
                <label className="block font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider mb-1">
                  Incoming Webhook URL *
                </label>
                <input
                  type="url"
                  required
                  value={webhookUrl}
                  onChange={(e) => setWebhookUrl(e.target.value)}
                  placeholder="https://hooks.slack.com/services/T.../B.../..."
                  className="w-full p-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white font-mono"
                />
                <p className="text-[11px] text-slate-400 mt-1">
                  Delivered by a real HTTPS POST from Postgres to your Slack webhook URL.
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider mb-1">
                    Target Channel
                  </label>
                  <input
                    type="text"
                    value={channel}
                    onChange={(e) => setChannel(e.target.value)}
                    placeholder="#work-tracker-alerts"
                    className="w-full p-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white font-semibold"
                  />
                </div>

                <div>
                  <label className="block font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider mb-1">
                    Bot Display Name
                  </label>
                  <input
                    type="text"
                    value={botName}
                    onChange={(e) => setBotName(e.target.value)}
                    placeholder="Aviyana Staff Bot"
                    className="w-full p-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white font-semibold"
                  />
                </div>
              </div>

              {/* Automated Triggers */}
              <div className="pt-3 border-t border-slate-100 dark:border-slate-800 space-y-2.5">
                <p className="font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider">
                  Automated Event Dispatch Triggers
                </p>

                <div className="space-y-2">
                  <label className="flex items-center justify-between p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700/60 cursor-pointer">
                    <div>
                      <p className="font-bold text-slate-900 dark:text-white">
                        Task Assigned by Dept Head
                      </p>
                      <p className="text-[11px] text-slate-400">
                        Pings assignee when a new deliverable is assigned
                      </p>
                    </div>
                    <input
                      type="checkbox"
                      checked={notifyOnTaskAssigned}
                      onChange={(e) => setNotifyOnTaskAssigned(e.target.checked)}
                      className="w-4 h-4 rounded text-purple-600"
                    />
                  </label>

                  <label className="flex items-center justify-between p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700/60 cursor-pointer">
                    <div>
                      <p className="font-bold text-slate-900 dark:text-white">
                        Automated Deadline Proximity Alert (48h & Overdue)
                      </p>
                      <p className="text-[11px] text-slate-400">
                        Escalates urgent deliverables with low progress
                      </p>
                    </div>
                    <input
                      type="checkbox"
                      checked={notifyOnDeadlineAlert}
                      onChange={(e) => setNotifyOnDeadlineAlert(e.target.checked)}
                      className="w-4 h-4 rounded text-purple-600"
                    />
                  </label>

                  <label className="flex items-center justify-between p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700/60 cursor-pointer">
                    <div>
                      <p className="font-bold text-slate-900 dark:text-white">
                        Approval & Sign-off Submissions
                      </p>
                      <p className="text-[11px] text-slate-400">
                        Alerts Dept Heads when an employee requests review
                      </p>
                    </div>
                    <input
                      type="checkbox"
                      checked={notifyOnApprovalRequested}
                      onChange={(e) => setNotifyOnApprovalRequested(e.target.checked)}
                      className="w-4 h-4 rounded text-purple-600"
                    />
                  </label>

                  <label className="flex items-center justify-between p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700/60 cursor-pointer">
                    <div>
                      <p className="font-bold text-slate-900 dark:text-white">
                        Deliverable Completed & Approved
                      </p>
                      <p className="text-[11px] text-slate-400">
                        Broadcasts success message to the department channel
                      </p>
                    </div>
                    <input
                      type="checkbox"
                      checked={notifyOnTaskCompleted}
                      onChange={(e) => setNotifyOnTaskCompleted(e.target.checked)}
                      className="w-4 h-4 rounded text-purple-600"
                    />
                  </label>
                </div>
              </div>
            </div>

            {testResult && (
              <div className="p-3 rounded-xl bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 text-xs font-semibold flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 flex-shrink-0" />
                <span>{testResult}</span>
              </div>
            )}

            <div className="pt-3 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between">
              <button
                type="button"
                id="test-slack-btn"
                onClick={handleTestSlack}
                disabled={isTesting}
                className="px-4 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 text-xs font-bold transition-colors flex items-center gap-1.5"
              >
                <Send className={`w-3.5 h-3.5 ${isTesting ? 'animate-bounce' : ''}`} />
                <span>{isTesting ? 'Dispatching Ping...' : 'Test Webhook Dispatch'}</span>
              </button>

              <button
                type="submit"
                className="px-5 py-2.5 rounded-xl bg-purple-600 hover:bg-purple-500 text-white font-bold text-xs shadow-md shadow-purple-500/25 transition-all"
              >
                Save Slack Configuration
              </button>
            </div>
          </form>

          {/* Slack Live Block Kit Card Preview */}
          <div className="p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs space-y-3">
            <h3 className="font-bold text-xs text-slate-400 uppercase tracking-wider">
              Slack Message Format — Example
            </h3>
            <p className="text-[11px] text-slate-400">
              This is a static example of what a real deadline-alert message
              looks like once your webhook is connected — it isn't pulled
              from a live task.
            </p>

            {/* Slack Mock Container */}
            <div className="p-4 rounded-xl bg-slate-100 dark:bg-slate-950 border border-slate-300 dark:border-slate-800 font-sans text-xs space-y-3">
              <div className="flex items-center gap-2">
                <div className="w-6 h-6 rounded bg-purple-600 text-white flex items-center justify-center font-bold text-[10px]">
                  OT
                </div>
                <span className="font-bold text-slate-900 dark:text-white">
                  {botName || 'Aviyana Staff Bot'}
                </span>
                <span className="px-1 py-0.2 rounded bg-slate-200 dark:bg-slate-800 text-[10px] text-slate-500 font-bold">
                  APP
                </span>
                <span className="text-[10px] text-slate-400">10:45 AM</span>
              </div>

              <div className="p-3 bg-white dark:bg-slate-900 rounded-lg border-l-4 border-l-rose-500 border border-slate-200 dark:border-slate-800 space-y-2">
                <p className="font-bold text-slate-900 dark:text-white">
                  🚨 Deadline Alert: TSK-1092 Zero-Trust API Gateway
                </p>
                <div className="grid grid-cols-2 gap-2 text-[11px] text-slate-600 dark:text-slate-400">
                  <div>
                    <strong>Department:</strong> Engineering
                  </div>
                  <div>
                    <strong>Assignee:</strong> @Alex Chen
                  </div>
                  <div>
                    <strong>Due Date:</strong> 📅 2026-08-18 (CRITICAL)
                  </div>
                  <div>
                    <strong>Progress:</strong> 85% (IN PROGRESS)
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Right Col: Data protection info */}
        <div className="space-y-6">
          <div className="p-5 sm:p-6 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs space-y-4">
            <div className="flex items-center gap-2.5">
              <div className="p-2 rounded-xl bg-slate-600 text-white">
                <Lock className="w-4 h-4" />
              </div>
              <div>
                <h3 className="font-bold text-sm text-slate-900 dark:text-white">
                  Data protection
                </h3>
                <p className="text-xs text-slate-400">What actually protects your data</p>
              </div>
            </div>

            <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 text-xs space-y-2">
              <p className="text-slate-700 dark:text-slate-300">
                Access is enforced by Postgres Row Level Security — each role
                (Super Admin, Chief Officer, Dept Head, Staff) can only read
                or write what its permissions allow. Data at rest is
                protected by Supabase's standard database-level encryption.
                Remarks marked <strong>Confidential</strong> are masked in
                the UI until revealed — this hides them from a quick glance,
                it isn't field-level encryption.
              </p>
            </div>

            <div className="space-y-3 text-xs">
              <div>
                <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">
                  Audit log signatures
                </label>
                <p className="text-slate-600 dark:text-slate-300">
                  Every audit log entry is signed server-side with HMAC-SHA256
                  (see the signature column in Audit &amp; Hash Logs) so entries
                  can't be silently altered.
                </p>
              </div>
            </div>
          </div>

          {/* Slack Dispatch Activity Log */}
          <div className="p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs space-y-3">
            <h3 className="font-bold text-xs text-slate-400 uppercase tracking-wider">
              Recent Slack Webhook Dispatches
            </h3>

            <div className="space-y-2 max-h-48 overflow-y-auto">
              {slackConfig.notificationLog.map((log) => (
                <div
                  key={log.id}
                  className="p-2 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-100 dark:border-slate-800 text-[11px] space-y-0.5"
                >
                  <div className="flex items-center justify-between text-slate-400">
                    <span className="font-bold text-purple-600 dark:text-purple-400">
                      {log.channel}
                    </span>
                    <span>{log.timestamp}</span>
                  </div>
                  <p className="text-slate-800 dark:text-slate-200 font-medium line-clamp-1">
                    {log.summary}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
