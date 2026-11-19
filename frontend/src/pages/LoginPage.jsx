import React, { useMemo, useState } from 'react';
import Navbar from '../components/Navbar.jsx';
import Footer from '../components/Footer.jsx';
import { Button, Card, Input } from '../components/ui.jsx';
import bugifyLogo from '../../bugify-logo.png';

function initialMode() {
  return new URLSearchParams(window.location.search).get('mode') === 'signup' ? 'signup' : 'login';
}

function safeReturnPath() {
  const next = new URLSearchParams(window.location.search).get('next');
  return next && next.startsWith('/') && !next.startsWith('//') ? next : '/analytics';
}

export default function LoginPage() {
  const [mode, setMode] = useState(initialMode);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [errors, setErrors] = useState({});
  const [notice, setNotice] = useState('');
  const [serverError, setServerError] = useState('');
  const [loading, setLoading] = useState(false);
  const isSignup = mode === 'signup';
  const returnPath = useMemo(safeReturnPath, []);

  function validate() {
    const nextErrors = {};
    if (isSignup && !name.trim()) nextErrors.name = 'Enter your name.';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) nextErrors.email = 'Enter a valid email address.';
    if (!password) nextErrors.password = 'Enter your password.';
    else if (isSignup && password.length < 8) nextErrors.password = 'Use at least 8 characters.';
    else if (password.length > 128) nextErrors.password = 'Password must be 128 characters or fewer.';
    setErrors(nextErrors);
    return Object.keys(nextErrors).length === 0;
  }

  async function submit(event) {
    event.preventDefault();
    setServerError('');
    setNotice('');
    if (!validate()) return;
    setLoading(true);
    try {
      const response = await fetch(`/api/auth/${isSignup ? 'register' : 'login'}`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), email: email.trim(), password, remember }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.success) {
        setServerError(data.message || 'We couldn’t complete that request. Please try again.');
        return;
      }
      setNotice(isSignup ? 'Account created. Opening your analytics…' : 'Signed in. Opening your analytics…');
      window.setTimeout(() => window.location.assign(returnPath), 650);
    } catch {
      setServerError('Unable to reach Bugify. Check your connection and try again.');
    } finally {
      setLoading(false);
    }
  }

  function changeMode(nextMode) {
    const params = new URLSearchParams(window.location.search);
    params.set('mode', nextMode);
    window.location.assign(`/login?${params.toString()}`);
  }

  return (
    <div className="page page-login">
      <Navbar currentPage="login" />
      <main className="auth-main">
        <div className="auth-heading">
          <span className="eyebrow"><i /> DEBUG INTELLIGENCE WORKSPACE</span>
          <h1>{isSignup ? 'Create your account.' : 'Welcome back.'}</h1>
          <p>{isSignup ? 'Start making more sense of every error.' : 'Sign in to continue to your debugging insights.'}</p>
        </div>
        <Card className="auth-card">
          <div className="auth-card-brand">
            <img src={bugifyLogo} alt="" />
            <div><strong>BUGIFY</strong><span>Debug Intelligence</span></div>
          </div>
          {serverError && <div className="form-alert" role="alert">{serverError}</div>}
          {notice && <div className="form-success" role="status">{notice}</div>}
          <form onSubmit={submit} noValidate>
            {isSignup && (
              <Input id="name" label="Name" autoComplete="name" value={name} onChange={(event) => setName(event.target.value)} error={errors.name} />
            )}
            <Input id="email" label="Email address" type="email" autoComplete="email" inputMode="email" value={email} onChange={(event) => setEmail(event.target.value)} error={errors.email} />
            <div className="password-field">
              <Input id="password" label="Password" type={showPassword ? 'text' : 'password'} autoComplete={isSignup ? 'new-password' : 'current-password'} value={password} onChange={(event) => setPassword(event.target.value)} error={errors.password} />
              <button className="password-toggle" type="button" onClick={() => setShowPassword((visible) => !visible)} aria-label={showPassword ? 'Hide password' : 'Show password'}>
                {showPassword ? 'Hide' : 'Show'}
              </button>
            </div>
            <div className="form-options">
              <label className="check-label"><input type="checkbox" checked={remember} onChange={(event) => setRemember(event.target.checked)} /> <span>Remember me</span></label>
              {!isSignup && <button className="text-button" type="button" onClick={() => setNotice('Password reset is not configured yet. Contact your account administrator.')}>Forgot password?</button>}
            </div>
            <Button type="submit" className="auth-submit" disabled={loading}>
              {loading ? 'Please wait…' : isSignup ? 'Create account' : 'Login'}
              {!loading && <span aria-hidden="true">↗</span>}
            </Button>
          </form>
          <p className="auth-switch">
            {isSignup ? 'Already have an account?' : 'New to Bugify?'}{' '}
            <button type="button" onClick={() => changeMode(isSignup ? 'login' : 'signup')}>{isSignup ? 'Sign in' : 'Sign up'}</button>
          </p>
          <p className="auth-security">Your account is protected with an encrypted, HTTP-only session.</p>
        </Card>
      </main>
      <Footer />
    </div>
  );
}
