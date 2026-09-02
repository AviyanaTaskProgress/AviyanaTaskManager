import React, { useEffect, useRef, useState } from 'react';
import { AlarmClock, Volume2, VolumeX } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { Task } from '../types';

// A short, unmistakable two-tone alarm beep, generated with the Web
// Audio API rather than shipping an audio file — keeps the bundle
// small and avoids asset-licensing questions for something this
// simple. Loops every ~1.6s for as long as there's an active alarm.
function useAlarmSound(active: boolean) {
  const ctxRef = useRef<AudioContext | null>(null);
  const timerRef = useRef<number | null>(null);
  const [blocked, setBlocked] = useState(false);

  const playBeep = () => {
    const ctx = ctxRef.current;
    if (!ctx) return;
    const now = ctx.currentTime;
    [880, 660].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      const start = now + i * 0.18;
      gain.gain.setValueAtTime(0, start);
      gain.gain.linearRampToValueAtTime(0.25, start + 0.02);
      gain.gain.linearRampToValueAtTime(0, start + 0.16);
      osc.connect(gain).connect(ctx.destination);
      osc.start(start);
      osc.stop(start + 0.17);
    });
  };

  const ensureContext = () => {
    if (!ctxRef.current) {
      const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      ctxRef.current = new Ctx();
    }
    return ctxRef.current;
  };

  useEffect(() => {
    if (!active) {
      if (timerRef.current) window.clearInterval(timerRef.current);
      timerRef.current = null;
      return;
    }

    try {
      const ctx = ensureContext();
      if (ctx.state === 'suspended') {
        ctx.resume().catch(() => setBlocked(true));
      }
      playBeep();
      timerRef.current = window.setInterval(playBeep, 1600);
    } catch {
      setBlocked(true);
    }

    return () => {
      if (timerRef.current) window.clearInterval(timerRef.current);
      timerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  // Browsers block audio until the user has interacted with the page
  // at least once — this lets a click anywhere unlock it retroactively
  // for an alarm that was already active when the page loaded.
  const unlock = () => {
    try {
      const ctx = ensureContext();
      if (ctx.state === 'suspended') ctx.resume();
      setBlocked(false);
      if (active) playBeep();
    } catch {
      // Audio genuinely unavailable in this environment — the visual
      // banner below still gets the message across.
    }
  };

  return { blocked, unlock };
}

export const AlarmSiren: React.FC<{ onOpenTask: (task: Task) => void }> = ({ onOpenTask }) => {
  const { notifications, tasks } = useApp();

  // Staff and everyone else alike can RECEIVE an alarm — only ringing
  // one is upper-level-only (see 33_task_reminders_and_alarms.sql /
  // TaskModal's Ring Alarm button). This just renders whatever's
  // addressed to the person currently logged in.
  const activeAlarms = notifications.filter((n) => n.type === 'alarm' && !n.read);
  const current = activeAlarms[0];
  const currentTask = current?.taskId ? tasks.find((t) => t.id === current.taskId) : undefined;

  // "Mute sound" is deliberately NOT the same as dismissing — the
  // banner and the underlying notification both stay exactly as they
  // were (see item #3 of the reminder plan: only opening the task
  // clears it). This just stops the audio for someone who's, say, in a
  // meeting and can't have it ringing right now but hasn't forgotten
  // about it. Tracked by notification id so a genuinely NEW alarm
  // arriving later always rings audibly again, even if a previous one
  // was muted.
  const [mutedNotificationId, setMutedNotificationId] = useState<string | null>(null);
  const isMuted = !!current && mutedNotificationId === current.id;

  const { blocked, unlock } = useAlarmSound(!!current && !isMuted);

  if (!current) return null;

  return (
    <div
      className="fixed inset-x-0 top-0 z-[100] animate-in slide-in-from-top duration-200"
      onClick={blocked ? unlock : undefined}
    >
      <div className="mx-auto max-w-3xl mt-3 px-3">
        <div className="flex items-center gap-3 p-3.5 rounded-2xl bg-rose-600 text-white shadow-2xl shadow-rose-900/40 border border-rose-400/40">
          <div className="shrink-0 p-2 rounded-xl bg-white/15 animate-pulse">
            <AlarmClock className="w-5 h-5" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-extrabold truncate">{current.title}</p>
            <p className="text-xs text-rose-100 truncate">{current.message}</p>
          </div>
          {blocked && (
            <button
              type="button"
              onClick={unlock}
              className="shrink-0 p-2 rounded-xl bg-white/15 hover:bg-white/25 transition-colors"
              aria-label="Enable alarm sound"
              title="Tap to enable sound"
            >
              <VolumeX className="w-4 h-4" />
            </button>
          )}
          {!blocked && (
            <button
              type="button"
              onClick={() => setMutedNotificationId(isMuted ? null : current.id)}
              className="shrink-0 p-2 rounded-xl bg-white/15 hover:bg-white/25 transition-colors"
              aria-label={isMuted ? 'Unmute alarm sound' : 'Mute alarm sound (keeps the banner)'}
              title={isMuted ? 'Sound muted — tap to unmute' : 'Mute the sound (the reminder stays until you open the task)'}
            >
              {isMuted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
            </button>
          )}
          <button
            type="button"
            id="open-alarm-task-btn"
            onClick={() => currentTask && onOpenTask(currentTask)}
            disabled={!currentTask}
            className="shrink-0 px-3.5 py-2 rounded-xl bg-white text-rose-700 text-xs font-extrabold hover:bg-rose-50 transition-colors disabled:opacity-50"
          >
            Open Task
          </button>
        </div>
        {activeAlarms.length > 1 && (
          <p className="text-center text-[11px] text-rose-500 dark:text-rose-400 mt-1 font-semibold">
            +{activeAlarms.length - 1} more alarm{activeAlarms.length - 1 === 1 ? '' : 's'} waiting
          </p>
        )}
      </div>
    </div>
  );
};
