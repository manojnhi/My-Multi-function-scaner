import {
  ArrowRight,
  CheckCircle2,
  Eye,
  EyeOff,
  KeyRound,
  Laptop,
  Lock,
  Mail,
  Phone,
  ShieldCheck,
  Smartphone,
  User,
} from 'lucide-react';
import { useState } from 'react';
import {
  signInWithSocialProvider,
  syncFirebaseProfileToFirestore,
  type SocialAuthProviderId,
} from '../firebase';
import { apiFirebaseAuth, apiLogin, apiRegister, apiResetPassword } from '../services/syncClient';
import type { UserAccount, WorkspaceMode } from '../types';
import { BrandLogo } from './BrandLogo';

interface LoginPanelProps {
  onAuthenticated: (token: string, user: UserAccount, chosenWorkspace?: WorkspaceMode) => void;
  onContinueLocal: (chosenWorkspace: WorkspaceMode) => void;
}

export function LoginPanel({ onAuthenticated, onContinueLocal }: LoginPanelProps) {
  const [tab, setTab] = useState<'login' | 'register' | 'reset'>('login');
  const [targetWorkspace, setTargetWorkspace] = useState<WorkspaceMode>(
    typeof window !== 'undefined' && window.innerWidth < 768 ? 'mobile' : 'desktop'
  );

  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [displayName, setDisplayName] = useState('');
  const [recoveryPhrase, setRecoveryPhrase] = useState('');
  const [newPassword, setNewPassword] = useState('');

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  const handleSocial = async (providerId: SocialAuthProviderId) => {
    setBusy(true);
    setError('');
    try {
      const { idToken, firebaseUser } = await signInWithSocialProvider(providerId);
      const res = await apiFirebaseAuth(idToken);
      await syncFirebaseProfileToFirestore(firebaseUser, providerId, res.user.phone);
      onAuthenticated(res.token, res.user, targetWorkspace);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Social sign-in failed');
    } finally {
      setBusy(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    setSuccessMsg('');
    try {
      if (tab === 'login') {
        const res = await apiLogin(email, password);
        onAuthenticated(res.token, res.user, targetWorkspace);
      } else if (tab === 'register') {
        const res = await apiRegister({
          email: email.trim() || undefined,
          phone: phone.trim() || undefined,
          password,
          displayName,
          recoveryPhrase,
        });
        onAuthenticated(res.token, res.user, targetWorkspace);
      } else {
        await apiResetPassword(email, recoveryPhrase, newPassword);
        setSuccessMsg('Password updated. You can now sign in with your new password.');
        setTab('login');
        setPassword('');
        setNewPassword('');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Authentication failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col lg:flex-row">
      {/* Left Brand & Ecosystem Overview Panel */}
      <div className="lg:w-[46%] bg-emerald-950 text-white p-8 lg:p-14 flex flex-col justify-between">
        <div className="space-y-8">
          <div className="flex items-center gap-3.5">
            <BrandLogo size={64} />
            <div>
              <div className="text-lg font-display font-bold tracking-tight text-white">
                Oklivo Scanner
              </div>
              <div className="text-xs text-emerald-300">
                Mobile & Desktop Scanning Ecosystem
              </div>
            </div>
          </div>

          <div className="space-y-4 max-w-md pt-4">
            <h1 className="text-3xl lg:text-4xl font-display font-bold leading-tight text-white [text-wrap:balance]">
              Scan on Mobile. Receive Automatically on Windows.
            </h1>
            <p className="text-sm text-emerald-100/85 leading-relaxed">
              Capture receipts, A4 documents, and ID cards with perspective flattening, Hindi & English offline OCR, full PDF management, and instant WebSocket transfer.
            </p>
          </div>

          <ul className="space-y-3 text-xs text-emerald-100/90 pt-2">
            <li className="flex items-center gap-2.5">
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
              <span>Quick Capture & Auto-Capture with stability detection</span>
            </li>
            <li className="flex items-center gap-2.5">
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
              <span>Offline-first IndexedDB storage & automatic transfer queue</span>
            </li>
            <li className="flex items-center gap-2.5">
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
              <span>PDF organizer, watermark, encryption vault, and signature pad</span>
            </li>
          </ul>
        </div>

        <div className="pt-8 border-t border-emerald-900/80 text-xs text-emerald-300/80 flex items-center gap-2">
          <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0" />
          <span>Salted scrypt credentials & AES-GCM vault protection</span>
        </div>
      </div>

      {/* Right Authentication Form Panel */}
      <div className="flex-1 flex items-center justify-center p-6 lg:p-12">
        <div className="w-full max-w-md bg-white border border-slate-200 rounded-2xl p-6 lg:p-8 space-y-6">
          <div>
            <h2 className="text-xl font-display font-bold text-slate-900">
              {tab === 'login'
                ? 'Sign in to Cloud & Sync'
                : tab === 'register'
                ? 'Create Scanner Account'
                : 'Reset Account Password'}
            </h2>
            <p className="text-xs text-slate-500 mt-1">
              Sign in for encrypted cloud backup across devices, or continue locally without an account.
            </p>
          </div>

          {/* Mode Tabs */}
          <div className="grid grid-cols-3 gap-1 p-1 bg-slate-100 rounded-xl">
            <button
              type="button"
              onClick={() => {
                setTab('login');
                setError('');
              }}
              className={`py-2 text-xs font-semibold rounded-lg transition-colors ${
                tab === 'login' ? 'bg-white text-emerald-950 shadow-sm' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Sign In
            </button>
            <button
              type="button"
              onClick={() => {
                setTab('register');
                setError('');
              }}
              className={`py-2 text-xs font-semibold rounded-lg transition-colors ${
                tab === 'register' ? 'bg-white text-emerald-950 shadow-sm' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Register
            </button>
            <button
              type="button"
              onClick={() => {
                setTab('reset');
                setError('');
              }}
              className={`py-2 text-xs font-semibold rounded-lg transition-colors ${
                tab === 'reset' ? 'bg-white text-emerald-950 shadow-sm' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Reset
            </button>
          </div>

          {/* Workspace Target Selector */}
          <div>
            <div className="text-xs font-medium text-slate-700 mb-1.5">Launch Workspace Mode</div>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setTargetWorkspace('desktop')}
                className={`flex items-center justify-center gap-2 py-2 px-3 rounded-xl border text-xs font-medium transition-colors ${
                  targetWorkspace === 'desktop'
                    ? 'border-emerald-800 bg-emerald-50 text-emerald-950'
                    : 'border-slate-200 text-slate-600 hover:bg-slate-50'
                }`}
              >
                <Laptop className="w-3.5 h-3.5" />
                Windows Desktop
              </button>
              <button
                type="button"
                onClick={() => setTargetWorkspace('mobile')}
                className={`flex items-center justify-center gap-2 py-2 px-3 rounded-xl border text-xs font-medium transition-colors ${
                  targetWorkspace === 'mobile'
                    ? 'border-emerald-800 bg-emerald-50 text-emerald-950'
                    : 'border-slate-200 text-slate-600 hover:bg-slate-50'
                }`}
              >
                <Smartphone className="w-3.5 h-3.5" />
                Mobile Scanner
              </button>
            </div>
          </div>

          {successMsg && (
            <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-xs text-emerald-900">
              {successMsg}
            </div>
          )}

          <div className="space-y-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => handleSocial('google')}
              className="w-full py-2.5 px-4 border border-slate-300 hover:border-emerald-700 bg-white hover:bg-slate-50 text-slate-900 text-xs font-semibold rounded-xl transition-colors"
            >
              Continue with Google
            </button>
            <div className="grid grid-cols-3 gap-2">
              <button
                type="button"
                disabled={busy}
                onClick={() => handleSocial('github')}
                className="py-2 px-2 border border-slate-200 hover:border-slate-400 bg-slate-50 text-slate-800 text-xs font-medium rounded-xl"
              >
                GitHub
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => handleSocial('microsoft')}
                className="py-2 px-2 border border-slate-200 hover:border-slate-400 bg-slate-50 text-slate-800 text-xs font-medium rounded-xl"
              >
                Microsoft
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => handleSocial('apple')}
                className="py-2 px-2 border border-slate-200 hover:border-slate-400 bg-slate-50 text-slate-800 text-xs font-medium rounded-xl"
              >
                Apple
              </button>
            </div>
          </div>

          <form onSubmit={handleSubmit} className="space-y-3.5">
            {tab === 'register' && (
              <label className="block text-xs font-medium text-slate-700">
                Full Name
                <div className="relative mt-1">
                  <User className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    placeholder="Manoj Kumar"
                    className="w-full pl-9 pr-3 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-emerald-700"
                  />
                </div>
              </label>
            )}

            {tab === 'register' && (
              <label className="block text-xs font-medium text-slate-700">
                Mobile Number
                <div className="relative mt-1">
                  <Phone className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="tel"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="+91 9876543210"
                    className="w-full pl-9 pr-3 py-2.5 border border-slate-200 rounded-xl text-sm font-mono focus:outline-none focus:ring-2 focus:ring-emerald-700"
                  />
                </div>
              </label>
            )}

            <label className="block text-xs font-medium text-slate-700">
              {tab === 'register' ? 'Email Address (optional if mobile added)' : 'Email or Mobile Number'}
              <div className="relative mt-1">
                <Mail className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type={tab === 'register' ? 'email' : 'text'}
                  required={tab !== 'register'}
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder={tab === 'register' ? 'name@company.com' : 'name@company.com or +91 9876543210'}
                  className="w-full pl-9 pr-3 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-emerald-700"
                />
              </div>
            </label>

            {tab !== 'reset' && (
              <label className="block text-xs font-medium text-slate-700">
                Password
                <div className="relative mt-1">
                  <Lock className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type={showPassword ? 'text' : 'password'}
                    required
                    minLength={6}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Minimum 6 characters"
                    className="w-full pl-9 pr-10 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-emerald-700"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((s) => !s)}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-slate-700"
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </label>
            )}

            {(tab === 'register' || tab === 'reset') && (
              <label className="block text-xs font-medium text-slate-700">
                {tab === 'register'
                  ? 'Recovery Key / Security Phrase (for password reset)'
                  : 'Recovery Key / Security Phrase'}
                <div className="relative mt-1">
                  <KeyRound className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    required={tab === 'reset'}
                    minLength={tab === 'reset' ? 4 : undefined}
                    value={recoveryPhrase}
                    onChange={(e) => setRecoveryPhrase(e.target.value)}
                    placeholder="e.g. my-office-vault-2026"
                    className="w-full pl-9 pr-3 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-emerald-700"
                  />
                </div>
              </label>
            )}

            {tab === 'reset' && (
              <label className="block text-xs font-medium text-slate-700">
                New Password
                <div className="relative mt-1">
                  <Lock className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="password"
                    required
                    minLength={6}
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="Minimum 6 characters"
                    className="w-full pl-9 pr-3 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-emerald-700"
                  />
                </div>
              </label>
            )}

            {error && (
              <div className="p-2.5 rounded-xl bg-red-50 border border-red-200 text-xs text-red-700">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={busy}
              className="w-full py-3 px-4 bg-emerald-800 hover:bg-emerald-900 text-white text-sm font-semibold rounded-xl transition-colors flex items-center justify-center gap-2 disabled:opacity-60"
            >
              {busy
                ? 'Please wait...'
                : tab === 'login'
                ? 'Sign In & Open Scanner'
                : tab === 'register'
                ? 'Create Account & Launch'
                : 'Reset Password'}
              <ArrowRight className="w-4 h-4" />
            </button>
          </form>

          <div className="pt-3 border-t border-slate-200">
            <button
              type="button"
              onClick={() => onContinueLocal(targetWorkspace)}
              className="w-full py-2.5 px-4 border border-slate-200 hover:border-emerald-700 hover:bg-emerald-50/40 text-slate-800 text-xs font-semibold rounded-xl transition-colors"
            >
              Continue Without Account (Offline Local-Only Mode)
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
