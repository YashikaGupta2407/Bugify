import React, { useEffect, useState } from 'react';
import './App.css';
import NeuralBackground from './NeuralBackground.jsx';
import HomePage from './pages/HomePage.jsx';
import LoginPage from './pages/LoginPage.jsx';
import AnalyticsPage from './pages/AnalyticsPage.jsx';
import { Button, ErrorNotice, Skeleton } from './components/ui.jsx';

function ProtectedAnalytics() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError('');
    fetch('/api/auth/me', { credentials: 'include', signal: controller.signal })
      .then(async (response) => {
        const body = await response.json().catch(() => ({}));
        if (response.status === 401) {
          window.location.replace(`/login?next=${encodeURIComponent(`${window.location.pathname}${window.location.search}`)}`);
          return null;
        }
        if (!response.ok || !body.success || !body.user) throw new Error(body.message || 'We couldn’t verify your session.');
        return body.user;
      })
      .then((authenticatedUser) => { if (authenticatedUser) setUser(authenticatedUser); })
      .catch((cause) => { if (cause.name !== 'AbortError') setError(cause.message || 'Unable to verify your session.'); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [retry]);

  if (loading) {
    return (
      <main className="auth-check content-width" aria-label="Checking your account">
        <Skeleton className="check-skeleton" />
        <span>Checking your session…</span>
      </main>
    );
  }
  if (error) {
    return <main className="auth-check content-width"><ErrorNotice message={error} onRetry={() => setRetry((value) => value + 1)} /><Button href="/login" variant="outline">Go to login</Button></main>;
  }
  return user ? <AnalyticsPage user={user} /> : null;
}

export default function App() {
  const path = window.location.pathname.replace(/\/+$/, '') || '/';
  const page = path === '/analytics' ? 'analytics' : path === '/login' ? 'login' : 'home';

  useEffect(() => {
    const title = page === 'analytics' ? 'Your Error Analytics | Bugify' : page === 'login' ? 'Login | Bugify' : 'Bugify | Debug Intelligence';
    document.title = title;
  }, [page]);

  return (
    <div className={`app-root page-${page}`}>
      <NeuralBackground staticMode={page === 'analytics'} />
      {page === 'analytics' ? <ProtectedAnalytics /> : page === 'login' ? <LoginPage /> : <HomePage />}
    </div>
  );
}
