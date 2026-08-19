import React, { useState } from 'react';
import { Loader2, Lock, Mail, ShieldCheck, User as UserIcon } from 'lucide-react';
import { supabase } from '../lib/supabaseClient';

export const AuthScreen: React.FC = () => {
  const [mode, setMode] = useState<'sign_in' | 'sign_up'>('sign_in');
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
      } else {
        const { error: signUpError } = await supabase.auth.signUp({
          email,
          password,
          options: { data: { name } },
        });
        if (signUpError) throw signUpError;
        setInfo('Account created. Check your email to confirm, then sign in.');
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
            {mode === 'sign_in' ? 'Sign in' : 'Create an account'}
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

          <div>
            <label className="text-xs text-slate-300 mb-1 block">Password</label>
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

          {error && <p className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">{error}</p>}
          {info && <p className="text-xs text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 rounded-lg px-3 py-2">{info}</p>}

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-[#f4c115] hover:bg-[#e0b010] text-[#0b1a33] font-semibold rounded-lg py-2.5 text-sm flex items-center justify-center gap-2 transition-colors disabled:opacity-60"
          >
            {loading && <Loader2 className="w-4 h-4 animate-spin" />}
            {mode === 'sign_in' ? 'Sign in' : 'Sign up'}
          </button>

          <button
            type="button"
            onClick={() => {
              setMode(mode === 'sign_in' ? 'sign_up' : 'sign_in');
              setError(null);
              setInfo(null);
            }}
            className="w-full text-xs text-slate-400 hover:text-white transition-colors"
          >
            {mode === 'sign_in' ? "Don't have an account? Sign up" : 'Already have an account? Sign in'}
          </button>
        </form>
      </div>
    </div>
  );
};
