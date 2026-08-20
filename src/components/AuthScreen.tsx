import React, { useState } from 'react';
import { Loader2, Lock, Mail, ShieldCheck, User as UserIcon } from 'lucide-react';
import { supabase } from '../lib/supabaseClient';

export const AuthScreen: React.FC = () => {
  const [mode, setMode] = useState<'sign_in' | 'sign_up' | 'forgot_password'>('sign_in');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setInfo(null);
    setLoading(true);
    try {
      if (mode === 'sign_in') {
        const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
        if (signInError) throw signInError;
      } else if (mode === 'sign_up') {
        const { error: signUpError } = await supabase.auth.signUp({
          email,
          password,
          options: { data: { name } },
        });
        if (signUpError) throw signUpError;
        setInfo('Account created. Check your email to confirm, then sign in.');
        setMode('sign_in');
      } else {
        const { error: resetError } = await supabase.auth.resetPasswordForEmail(email, {
          redirectTo: window.location.origin,
        });
        if (resetError) throw resetError;
        setInfo("If an account exists for that email, we've sent a password reset link.");
        setMode('sign_in');
      }
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
          <h1 className="text-2xl font-bold text-white tracking-tight">Aviyana</h1>
          <p className="text-xs text-[#f4c115]/80 mt-1 uppercase tracking-widest">Staff Work Management</p>
        </div>

        <form
          onSubmit={handleSubmit}
          className="bg-[#101f3d] border border-white/10 rounded-2xl p-6 shadow-xl space-y-4"
        >
          <h2 className="text-white font-semibold text-lg">
            {mode === 'sign_in' ? 'Sign in' : mode === 'sign_up' ? 'Create an account' : 'Reset your password'}
          </h2>

          {mode === 'sign_up' && (
            <div>
              <label className="text-xs text-slate-300 mb-1 block">Full name</label>
              <div className="flex items-center gap-2 bg-[#0b1a33] border border-white/10 rounded-lg px-3 py-2">
                <UserIcon className="w-4 h-4 text-slate-400" />
                <input
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="bg-transparent outline-none text-sm text-white w-full placeholder:text-slate-500"
                  placeholder="Kasun Perera"
                />
              </div>
            </div>
          )}

          <div>
            <label className="text-xs text-slate-300 mb-1 block">Email</label>
            <div className="flex items-center gap-2 bg-[#0b1a33] border border-white/10 rounded-lg px-3 py-2">
              <Mail className="w-4 h-4 text-slate-400" />
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="bg-transparent outline-none text-sm text-white w-full placeholder:text-slate-500"
                placeholder="you@aviyanaceylon.com"
              />
            </div>
          </div>

          {mode !== 'forgot_password' && (
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-xs text-slate-300 block">Password</label>
                {mode === 'sign_in' && (
                  <button
                    type="button"
                    onClick={() => {
                      setMode('forgot_password');
                      setError(null);
                      setInfo(null);
                    }}
                    className="text-[11px] text-[#f4c115]/90 hover:text-[#f4c115]"
                  >
                    Forgot password?
                  </button>
                )}
              </div>
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
          )}

          {error && <p className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">{error}</p>}
          {info && <p className="text-xs text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 rounded-lg px-3 py-2">{info}</p>}

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-[#f4c115] hover:bg-[#e0b010] text-[#0b1a33] font-semibold rounded-lg py-2.5 text-sm flex items-center justify-center gap-2 transition-colors disabled:opacity-60"
          >
            {loading && <Loader2 className="w-4 h-4 animate-spin" />}
            {mode === 'sign_in' ? 'Sign in' : mode === 'sign_up' ? 'Sign up' : 'Send reset link'}
          </button>

          <button
            type="button"
            onClick={() => {
              setMode(mode === 'sign_up' ? 'sign_in' : mode === 'forgot_password' ? 'sign_in' : 'sign_up');
              setError(null);
              setInfo(null);
            }}
            className="w-full text-xs text-slate-400 hover:text-white transition-colors"
          >
            {mode === 'sign_in'
              ? "Don't have an account? Sign up"
              : mode === 'sign_up'
              ? 'Already have an account? Sign in'
              : 'Back to sign in'}
          </button>
        </form>
      </div>
    </div>
  );
};
