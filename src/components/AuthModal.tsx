import {
  CheckCircle2,
  Cloud,
  Eye,
  EyeOff,
  HardDrive,
  KeyRound,
  Lock,
  LogOut,
  Mail,
  Phone,
  ShieldCheck,
  Trash2,
  User,
  X,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import {
  deleteFirestoreProfile,
  signInWithSocialProvider,
  signOutFirebase,
  syncFirebaseProfileToFirestore,
  updateFirestorePhone,
  type SocialAuthProviderId,
} from '../firebase';
import { hashPin } from '../services/db';
import {
  apiChangePassword,
  apiDeleteAccount,
  apiFirebaseAuth,
  apiLogin,
  apiRegister,
  apiResetPassword,
  apiUpdatePhone,
} from '../services/syncClient';
import type { ScannerSettings, UserAccount } from '../types';
import { BrandLogo } from './BrandLogo';

interface AuthModalProps {
  user: UserAccount | null;
  authToken: string;
  settings: ScannerSettings;
  onAuthenticated: (token: string, user: UserAccount, driveAccessToken?: string) => void;
  onUserUpdated: (user: UserAccount) => void;
  onOpenDriveBackup: () => void;
  onLogout: () => void;
  onUpdateSettings: (next: ScannerSettings) => Promise<void>;
  onClose: () => void;
}

function GoogleIcon() {
  return (
    <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.82-2.4 3.68v3.05h3.88c2.27-2.09 3.665-5.17 3.665-9.17Z"
      />
      <path
        fill="#34A853"
        d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.05c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.11-6.72-4.96H1.29v3.14C3.26 21.3 7.31 24 12 24Z"
      />
      <path
        fill="#FBBC05"
        d="M5.28 14.24c-.24-.72-.38-1.49-.38-2.24s.14-1.52.38-2.24V6.62H1.29C.47 8.24 0 10.06 0 12s.47 3.76 1.29 5.38l3.99-3.14Z"
      />
      <path
        fill="#EA4335"
        d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.31 0 3.26 2.7 1.29 6.62l3.99 3.14c.95-2.85 3.6-4.96 6.72-4.96Z"
      />
    </svg>
  );
}

function formatSocialAuthError(err: unknown, providerName: string): string {
  const raw = err instanceof Error ? err.message : String(err);
  if (raw.includes('auth/operation-not-allowed')) {
    return `${providerName} sign-in is not yet enabled in Firebase Console (Authentication -> Sign-in method). Google sign-in & Mobile/Email work right now.`;
  }
  if (raw.includes('auth/popup-closed-by-user')) {
    return `${providerName} sign-in popup was closed before completing.`;
  }
  if (raw.includes('auth/popup-blocked')) {
    return 'Browser blocked the sign-in popup. Please allow popups for this app and try again.';
  }
  if (raw.includes('auth/account-exists-with-different-credential')) {
    return 'An account already exists with this email under another sign-in provider. Use Google or your primary method.';
  }
  return raw || `${providerName} sign-in failed.`;
}

export function AuthModal({
  user,
  authToken,
  settings,
  onAuthenticated,
  onUserUpdated,
  onOpenDriveBackup,
  onLogout,
  onUpdateSettings,
  onClose,
}: AuthModalProps) {
  const [mode, setMode] = useState<'login' | 'register' | 'reset'>('login');
  const [identifier, setIdentifier] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [displayName, setDisplayName] = useState('');
  const [recoveryPhrase, setRecoveryPhrase] = useState('');
  const [accountPhoneInput, setAccountPhoneInput] = useState(user?.phone || '');
  const [currentPwd, setCurrentPwd] = useState('');
  const [newPwd, setNewPwd] = useState('');
  const [pinInput, setPinInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [socialBusy, setSocialBusy] = useState<SocialAuthProviderId | null>(null);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');

  useEffect(() => {
    setAccountPhoneInput(user?.phone || '');
  }, [user?.phone]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  const handleSocialLogin = async (providerId: SocialAuthProviderId, label: string) => {
    setSocialBusy(providerId);
    setError('');
    setInfo('');
    try {
      const { idToken, firebaseUser, driveAccessToken } = await signInWithSocialProvider(providerId);
      const res = await apiFirebaseAuth(idToken);
      await syncFirebaseProfileToFirestore(firebaseUser, providerId, res.user.phone);
      onAuthenticated(res.token, res.user, driveAccessToken);
      onClose();
    } catch (err) {
      setError(formatSocialAuthError(err, label));
    } finally {
      setSocialBusy(null);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    setInfo('');
    try {
      if (mode === 'login') {
        const res = await apiLogin(identifier, password);
        onAuthenticated(res.token, res.user);
        onClose();
      } else if (mode === 'register') {
        const res = await apiRegister({
          email: email.trim() || undefined,
          phone: phone.trim() || undefined,
          password,
          displayName,
          recoveryPhrase,
        });
        onAuthenticated(res.token, res.user);
        onClose();
      } else {
        await apiResetPassword(identifier, recoveryPhrase, newPwd);
        setInfo('Password updated! You can now sign in with your new password.');
        setMode('login');
        setPassword('');
        setNewPwd('');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Authentication failed');
    } finally {
      setBusy(false);
    }
  };

  const handleSaveMobileNumber = async () => {
    if (!authToken) return;
    setBusy(true);
    setError('');
    setInfo('');
    try {
      const res = await apiUpdatePhone(authToken, accountPhoneInput);
      await updateFirestorePhone(res.user.phone || '');
      onUserUpdated(res.user);
      setInfo(res.user.phone ? `Mobile number saved: ${res.user.phone}` : 'Mobile number removed.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update mobile number');
    } finally {
      setBusy(false);
    }
  };

  const handleDeleteAccount = async () => {
    if (!authToken) return;
    setBusy(true);
    try {
      await deleteFirestoreProfile();
      await apiDeleteAccount(authToken);
      await signOutFirebase();
      onLogout();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not delete account');
    } finally {
      setBusy(false);
    }
  };

  const handleSavePin = async () => {
    if (pinInput.length > 0 && pinInput.length < 4) {
      setError('App lock PIN must be at least 4 digits.');
      return;
    }
    const nextHash = pinInput ? await hashPin(pinInput) : undefined;
    await onUpdateSettings({ ...settings, appLockPinHash: nextHash });
    setPinInput('');
    setInfo(nextHash ? 'App lock PIN enabled.' : 'App lock PIN cleared.');
  };

  const headerTitle = user
    ? 'Account & Cloud Sync'
    : mode === 'register'
      ? 'Create Scanner Account'
      : mode === 'reset'
        ? 'Reset Account Password'
        : 'Sign In to Scanner';

  const providerLabel =
    user?.provider === 'google'
      ? 'Google Account'
      : user?.provider === 'github'
        ? 'GitHub Account'
        : user?.provider === 'microsoft'
          ? 'Microsoft Account'
          : user?.provider === 'apple'
            ? 'Apple Account'
            : user?.provider === 'phone'
              ? 'Mobile Number Account'
              : 'Email / Mobile Account';

  const canChangePassword = !user?.provider || user.provider === 'password' || user.provider === 'phone';

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 backdrop-blur-sm p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Login and Account Popup"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-md max-h-[92vh] overflow-y-auto bg-white rounded-2xl border border-slate-200 shadow-2xl">
        {/* Popup Header */}
        <div className="flex items-center justify-between px-5 py-4 bg-emerald-950 text-white sticky top-0 z-10">
          <div className="flex items-center gap-3 min-w-0">
            <BrandLogo size={32} />
            <div className="min-w-0">
              <div className="text-sm font-display font-bold text-white truncate">{headerTitle}</div>
              <div className="text-[11px] text-emerald-300 truncate">
                My Multi Functional Scanner · Cloud & Local Vault
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 text-emerald-200 hover:text-white rounded-lg hover:bg-emerald-900 transition-colors"
            aria-label="Close login popup"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-5">
          {user ? (
            <div className="space-y-4">
              <div className="p-4 rounded-xl bg-emerald-50 border border-emerald-200 flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-emerald-800 text-white flex items-center justify-center shrink-0">
                  <User className="w-5 h-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-semibold text-emerald-950 truncate">{user.displayName}</div>
                  {user.email && <div className="text-xs text-emerald-800 truncate">{user.email}</div>}
                  {user.phone && (
                    <div className="text-xs text-emerald-800 font-mono truncate">{user.phone}</div>
                  )}
                  <div className="text-[11px] font-medium text-emerald-700 mt-0.5">{providerLabel}</div>
                </div>
              </div>

              {/* Add / Update Mobile Number */}
              <div className="p-3 rounded-xl border border-slate-200 space-y-2">
                <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-800">
                  <Phone className="w-3.5 h-3.5 text-emerald-700" />
                  Mobile Number (Add / Update)
                </div>
                <div className="flex gap-2">
                  <input
                    type="tel"
                    value={accountPhoneInput}
                    onChange={(e) => setAccountPhoneInput(e.target.value)}
                    placeholder="+91 9876543210"
                    className="flex-1 px-3 py-1.5 text-xs border border-slate-200 rounded-lg font-mono focus:outline-none focus:border-emerald-700"
                  />
                  <button
                    type="button"
                    disabled={busy}
                    onClick={handleSaveMobileNumber}
                    className="px-3.5 py-1.5 text-xs font-semibold bg-emerald-800 hover:bg-emerald-900 text-white rounded-lg disabled:opacity-50"
                  >
                    Save No.
                  </button>
                </div>
                <p className="text-[11px] text-slate-500">
                  Link a mobile number for quick identification and mobile-number sign-in.
                </p>
              </div>

              <button
                type="button"
                onClick={() => {
                  onClose();
                  onOpenDriveBackup();
                }}
                className="w-full py-2.5 px-3 bg-emerald-800 hover:bg-emerald-900 text-white text-xs font-semibold rounded-xl flex items-center justify-center gap-2 transition-colors"
              >
                <HardDrive className="w-4 h-4" />
                Save & Restore Data with Google Drive
              </button>

              <label className="flex items-center justify-between p-3 rounded-xl border border-slate-200 text-xs">
                <span className="flex items-center gap-2 font-medium text-slate-800">
                  <Cloud className="w-4 h-4 text-emerald-700" />
                  Automatic Cloud Backup
                </span>
                <input
                  type="checkbox"
                  checked={settings.autoCloudBackup}
                  onChange={(e) => onUpdateSettings({ ...settings, autoCloudBackup: e.target.checked })}
                  className="accent-emerald-700 w-4 h-4"
                />
              </label>

              {canChangePassword && (
                <div className="p-3 rounded-xl border border-slate-200 space-y-2">
                  <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-800">
                    <KeyRound className="w-3.5 h-3.5 text-emerald-700" />
                    Change Password
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <input
                      type="password"
                      value={currentPwd}
                      onChange={(e) => setCurrentPwd(e.target.value)}
                      placeholder="Current password"
                      className="px-2.5 py-1.5 text-xs border border-slate-200 rounded-lg"
                    />
                    <input
                      type="password"
                      value={newPwd}
                      onChange={(e) => setNewPwd(e.target.value)}
                      placeholder="New password"
                      className="px-2.5 py-1.5 text-xs border border-slate-200 rounded-lg"
                    />
                  </div>
                  <button
                    type="button"
                    disabled={busy || !currentPwd || newPwd.length < 6}
                    onClick={async () => {
                      setBusy(true);
                      setError('');
                      try {
                        await apiChangePassword(authToken, currentPwd, newPwd);
                        setCurrentPwd('');
                        setNewPwd('');
                        setInfo('Account password updated.');
                      } catch (err) {
                        setError(err instanceof Error ? err.message : 'Password update failed');
                      } finally {
                        setBusy(false);
                      }
                    }}
                    className="px-3 py-1.5 text-xs font-medium bg-slate-900 text-white rounded-lg disabled:opacity-50"
                  >
                    Update Password
                  </button>
                </div>
              )}

              {error && (
                <p className="p-2.5 rounded-xl bg-red-50 border border-red-200 text-xs text-red-700">
                  {error}
                </p>
              )}

              <div className="flex items-center gap-2 pt-1">
                <button
                  type="button"
                  onClick={async () => {
                    await signOutFirebase();
                    onLogout();
                    onClose();
                  }}
                  className="flex-1 inline-flex items-center justify-center gap-1.5 py-2.5 px-3 text-xs font-semibold border border-slate-200 rounded-xl hover:bg-slate-50"
                >
                  <LogOut className="w-3.5 h-3.5" />
                  Sign Out (Local Mode)
                </button>
                <button
                  type="button"
                  onClick={handleDeleteAccount}
                  disabled={busy}
                  className="inline-flex items-center justify-center gap-1.5 py-2.5 px-3 text-xs font-medium text-red-700 border border-red-200 rounded-xl hover:bg-red-50"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  Delete Account
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              {/* Google & Other Accounts */}
              <div className="space-y-2.5">
                <button
                  type="button"
                  disabled={socialBusy !== null || busy}
                  onClick={() => handleSocialLogin('google', 'Google')}
                  className="w-full py-2.5 px-4 border border-slate-300 hover:border-emerald-700 bg-white hover:bg-slate-50 text-slate-900 text-xs font-semibold rounded-xl flex items-center justify-center gap-2.5 transition-colors disabled:opacity-50"
                >
                  <GoogleIcon />
                  <span>{socialBusy === 'google' ? 'Connecting to Google...' : 'Continue with Google'}</span>
                </button>

                <div className="grid grid-cols-3 gap-2">
                  <button
                    type="button"
                    disabled={socialBusy !== null || busy}
                    onClick={() => handleSocialLogin('github', 'GitHub')}
                    className="py-2 px-2.5 border border-slate-200 hover:border-slate-400 bg-slate-50 hover:bg-white text-slate-800 text-xs font-medium rounded-xl transition-colors disabled:opacity-50"
                  >
                    {socialBusy === 'github' ? 'Opening...' : 'GitHub'}
                  </button>
                  <button
                    type="button"
                    disabled={socialBusy !== null || busy}
                    onClick={() => handleSocialLogin('microsoft', 'Microsoft')}
                    className="py-2 px-2.5 border border-slate-200 hover:border-slate-400 bg-slate-50 hover:bg-white text-slate-800 text-xs font-medium rounded-xl transition-colors disabled:opacity-50"
                  >
                    {socialBusy === 'microsoft' ? 'Opening...' : 'Microsoft'}
                  </button>
                  <button
                    type="button"
                    disabled={socialBusy !== null || busy}
                    onClick={() => handleSocialLogin('apple', 'Apple')}
                    className="py-2 px-2.5 border border-slate-200 hover:border-slate-400 bg-slate-50 hover:bg-white text-slate-800 text-xs font-medium rounded-xl transition-colors disabled:opacity-50"
                  >
                    {socialBusy === 'apple' ? 'Opening...' : 'Apple'}
                  </button>
                </div>
              </div>

              <div className="relative flex items-center justify-center">
                <div className="border-t border-slate-200 w-full" />
                <span className="px-2.5 bg-white text-[11px] font-medium text-slate-400 whitespace-nowrap">
                  or with Email / Mobile Number
                </span>
                <div className="border-t border-slate-200 w-full" />
              </div>

              <form onSubmit={handleSubmit} className="space-y-3.5">
                {/* Auth Mode Tabs */}
                <div className="grid grid-cols-3 p-1 bg-slate-100 rounded-xl">
                  <button
                    type="button"
                    onClick={() => {
                      setMode('login');
                      setError('');
                    }}
                    className={`py-2 text-xs font-semibold rounded-lg transition-colors ${
                      mode === 'login' ? 'bg-white text-emerald-950 shadow-sm' : 'text-slate-600'
                    }`}
                  >
                    Sign In
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setMode('register');
                      setError('');
                    }}
                    className={`py-2 text-xs font-semibold rounded-lg transition-colors ${
                      mode === 'register' ? 'bg-white text-emerald-950 shadow-sm' : 'text-slate-600'
                    }`}
                  >
                    Register
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setMode('reset');
                      setError('');
                    }}
                    className={`py-2 text-xs font-semibold rounded-lg transition-colors ${
                      mode === 'reset' ? 'bg-white text-emerald-950 shadow-sm' : 'text-slate-600'
                    }`}
                  >
                    Reset
                  </button>
                </div>

                {mode === 'register' && (
                  <label className="block text-xs font-medium text-slate-700">
                    Full Name
                    <div className="relative mt-1">
                      <User className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                      <input
                        type="text"
                        required
                        value={displayName}
                        onChange={(e) => setDisplayName(e.target.value)}
                        placeholder="Your Name"
                        className="w-full pl-9 pr-3 py-2 border border-slate-200 rounded-xl text-sm focus:outline-none focus:border-emerald-700"
                      />
                    </div>
                  </label>
                )}

                {mode === 'register' ? (
                  <>
                    <label className="block text-xs font-medium text-slate-700">
                      Mobile Number <span className="text-slate-400 font-normal">(with country code or 10 digits)</span>
                      <div className="relative mt-1">
                        <Phone className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                        <input
                          type="tel"
                          value={phone}
                          onChange={(e) => setPhone(e.target.value)}
                          placeholder="+91 9876543210"
                          className="w-full pl-9 pr-3 py-2 border border-slate-200 rounded-xl text-sm font-mono focus:outline-none focus:border-emerald-700"
                        />
                      </div>
                    </label>
                    <label className="block text-xs font-medium text-slate-700">
                      Email Address <span className="text-slate-400 font-normal">(optional if Mobile added)</span>
                      <div className="relative mt-1">
                        <Mail className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                        <input
                          type="email"
                          value={email}
                          onChange={(e) => setEmail(e.target.value)}
                          placeholder="name@company.com"
                          className="w-full pl-9 pr-3 py-2 border border-slate-200 rounded-xl text-sm focus:outline-none focus:border-emerald-700"
                        />
                      </div>
                    </label>
                  </>
                ) : (
                  <label className="block text-xs font-medium text-slate-700">
                    Email Address or Mobile Number
                    <div className="relative mt-1">
                      <Phone className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                      <input
                        type="text"
                        required
                        value={identifier}
                        onChange={(e) => setIdentifier(e.target.value)}
                        placeholder="name@company.com or +91 9876543210"
                        autoFocus
                        className="w-full pl-9 pr-3 py-2 border border-slate-200 rounded-xl text-sm focus:outline-none focus:border-emerald-700"
                      />
                    </div>
                  </label>
                )}

                {mode !== 'reset' && (
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
                        className="w-full pl-9 pr-10 py-2 border border-slate-200 rounded-xl text-sm focus:outline-none focus:border-emerald-700"
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword((prev) => !prev)}
                        className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700"
                        aria-label="Toggle password visibility"
                      >
                        {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                  </label>
                )}

                {(mode === 'register' || mode === 'reset') && (
                  <label className="block text-xs font-medium text-slate-700">
                    {mode === 'register' ? 'Recovery Phrase (optional for reset)' : 'Account Recovery Phrase'}
                    <div className="relative mt-1">
                      <KeyRound className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                      <input
                        type="text"
                        required={mode === 'reset'}
                        value={recoveryPhrase}
                        onChange={(e) => setRecoveryPhrase(e.target.value)}
                        placeholder={
                          mode === 'register' ? 'e.g. my-office-scanner-key' : 'Enter saved recovery phrase'
                        }
                        className="w-full pl-9 pr-3 py-2 border border-slate-200 rounded-xl text-sm focus:outline-none focus:border-emerald-700"
                      />
                    </div>
                  </label>
                )}

                {mode === 'reset' && (
                  <label className="block text-xs font-medium text-slate-700">
                    New Password
                    <div className="relative mt-1">
                      <Lock className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                      <input
                        type={showPassword ? 'text' : 'password'}
                        required
                        minLength={6}
                        value={newPwd}
                        onChange={(e) => setNewPwd(e.target.value)}
                        placeholder="New password (min 6 chars)"
                        className="w-full pl-9 pr-10 py-2 border border-slate-200 rounded-xl text-sm focus:outline-none focus:border-emerald-700"
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword((prev) => !prev)}
                        className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700"
                        aria-label="Toggle new password visibility"
                      >
                        {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                  </label>
                )}

                {error && (
                  <p className="p-2.5 rounded-xl bg-red-50 border border-red-200 text-xs text-red-700">
                    {error}
                  </p>
                )}

                {info && (
                  <p className="p-2.5 rounded-xl bg-emerald-50 border border-emerald-200 text-xs text-emerald-800 flex items-center gap-1.5">
                    <CheckCircle2 className="w-4 h-4 shrink-0" />
                    <span>{info}</span>
                  </p>
                )}

                <button
                  type="submit"
                  disabled={busy || socialBusy !== null}
                  className="w-full py-2.5 px-4 bg-emerald-800 hover:bg-emerald-900 text-white text-xs font-semibold rounded-xl transition-colors disabled:opacity-50"
                >
                  {busy
                    ? 'Authenticating...'
                    : mode === 'register'
                      ? 'Create Account & Sign In'
                      : mode === 'reset'
                        ? 'Update Account Password'
                        : 'Sign In'}
                </button>

                <p className="text-[11px] text-slate-500 text-center">
                  Local scanning & LAN PC transfer work offline without login. Sign in for encrypted Cloud Sync.
                </p>
              </form>
            </div>
          )}

          {/* Local App Lock PIN */}
          <div className="pt-4 border-t border-slate-200 space-y-2.5">
            <div className="flex items-center gap-2 text-xs font-semibold text-slate-800">
              <Lock className="w-3.5 h-3.5 text-emerald-700" />
              Local Privacy App Lock
            </div>
            <div className="flex gap-2">
              <input
                type="password"
                inputMode="numeric"
                maxLength={8}
                value={pinInput}
                onChange={(e) => setPinInput(e.target.value.replace(/\D/g, ''))}
                placeholder={settings.appLockPinHash ? 'New PIN (blank to clear)' : 'Set 4-6 digit PIN'}
                className="flex-1 px-3 py-2 text-xs border border-slate-200 rounded-xl font-mono"
              />
              <button
                type="button"
                onClick={handleSavePin}
                className="px-3.5 py-2 text-xs font-medium border border-slate-200 rounded-xl hover:bg-slate-50"
              >
                {settings.appLockPinHash ? 'Update / Clear' : 'Set PIN'}
              </button>
            </div>
            {user && info && (
              <p className="text-xs text-emerald-700 flex items-center gap-1">
                <ShieldCheck className="w-3.5 h-3.5" />
                {info}
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
