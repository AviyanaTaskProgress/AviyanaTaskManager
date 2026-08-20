import React, { useState } from 'react';
import { Loader2, Lock, ShieldCheck } from 'lucide-react';
import { supabase } from '../lib/supabaseClient';

export const ResetPasswordScreen: React.FC<{ onDone: () => void }> = ({ onDone }) => {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (password.length < 6) {
      setError('Password must be at least 6 characters.');
      return;
    }
    if (password !== confirm) {
      setError("Passwords don't match.");
      return;
    }
    setLoading(true);
    try {
      const { error: updateError } = await supabase.auth.updateUser({ password });
      if (updateError) throw updateError;
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#0b1a33] px-4">
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center mb-8">
          <div className="w-14 h-14 rounded-2xl bg-[#f4c115] flex items-center justify-center shadow-lg shadow-[#f4c115]/20 mb-4">
            <ShieldCheck className="w-7 h-7 text-[#0b1a33]" />
          </div>
          <h1 className="text-2xl font-bold text-white tracking-tight">Set a new password</h1>
          <p className="text-xs text-slate-400 mt-1">Choose a new password for your account.</p>
        </div>

        <form
          onSubmit={handleSubmit}
          className="bg-[#101f3d] border border-white/10 rounded-2xl p-6 shadow-xl space-y-4"
        >
          <div>
            <label className="text-xs text-slate-300 mb-1 block">New password</label>
            <div className="flex items-center gap-2 bg-[#0b1a33] border border-white/10 rounded-lg px-3 py-2">
              <Lock className="w-4 h-4 text-slate-400" />
              <input
                type="password"
                required
                minLength={6}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="bg-transparent outline-none text-sm text-white w-full placeholder:text-slate-500"
                placeholder="••••••••"
              />
            </div>
          </div>

          <div>
            <label className="text-xs text-slate-300 mb-1 block">Confirm new password</label>
            <div className="flex items-center gap-2 bg-[#0b1a33] border border-white/10 rounded-lg px-3 py-2">
              <Lock className="w-4 h-4 text-slate-400" />
              <input
                type="password"
                required
                minLength={6}
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                className="bg-transparent outline-none text-sm text-white w-full placeholder:text-slate-500"
                placeholder="••••••••"
              />
            </div>
          </div>

          {error && <p className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">{error}</p>}

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-[#f4c115] hover:bg-[#e0b010] text-[#0b1a33] font-semibold rounded-lg py-2.5 text-sm flex items-center justify-center gap-2 transition-colors disabled:opacity-60"
          >
            {loading && <Loader2 className="w-4 h-4 animate-spin" />}
            Update password
          </button>
        </form>
      </div>
    </div>
  );
};
