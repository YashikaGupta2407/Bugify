import React, { useEffect, useState } from 'react';
import Navbar from '../components/Navbar.jsx';
import Footer from '../components/Footer.jsx';
import { BarChart, Button, Card, EmptyState, ErrorNotice, LoadingBlock, RankedList, SectionLabel, Skeleton, StatCard } from '../components/ui.jsx';

const RANGE_OPTIONS = [
  ['7d', 'Last 7 days'],
  ['30d', 'Last 30 days'],
  ['90d', 'Last 3 months'],
  ['all', 'All time'],
];

function initials(name, email) {
  const source = name?.trim() || email?.trim() || '';
  const parts = source.includes('@') ? [source.split('@')[0]] : source.split(/\s+/).filter(Boolean);
  return (parts.length > 1 ? `${parts[0][0]}${parts[parts.length - 1][0]}` : (parts[0] || 'B').slice(0, 2)).toUpperCase();
}

function StatSkeleton() {
  return <Card className="stat-card stat-skeleton"><Skeleton /><Skeleton /><Skeleton /></Card>;
}

function AnalyticsSection({ number, title, description, rows, nameKey, countKey, percentageKey, descriptionKey, loading, error, onRetry }) {
  return (
    <Card className="analytics-card">
      <div className="analytics-card-heading">
        <SectionLabel number={number}>ERROR PATTERNS</SectionLabel>
        <h2>{title}</h2>
        <p>{description}</p>
      </div>
      {loading ? <LoadingBlock label={`Loading ${title.toLowerCase()}`} /> : error ? <ErrorNotice message={error} onRetry={onRetry} /> : rows.length ? (
        <div className="analytics-data-layout">
          <div className="chart-column">
            <h3>Distribution</h3>
            <BarChart rows={rows} label={title} nameKey={nameKey} countKey={countKey} />
          </div>
          <div className="ranking-column">
            <h3>Ranked breakdown</h3>
            <RankedList rows={rows} label={`${title} ranking`} nameKey={nameKey} countKey={countKey} percentageKey={percentageKey} descriptionKey={descriptionKey} />
          </div>
        </div>
      ) : <EmptyState />}
    </Card>
  );
}

export default function AnalyticsPage({ user }) {
  const [range, setRange] = useState('30d');
  const [refreshKey, setRefreshKey] = useState(0);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [loggingOut, setLoggingOut] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError('');
    setData(null);
    fetch(`/api/analytics/errors?range=${encodeURIComponent(range)}`, { credentials: 'include', signal: controller.signal })
      .then(async (response) => {
        const body = await response.json().catch(() => ({}));
        if (response.status === 401) {
          window.location.replace('/login?next=%2Fanalytics');
          return null;
        }
        if (!response.ok || !body.success) throw new Error(body.message || 'Analytics are temporarily unavailable.');
        return body;
      })
      .then((body) => { if (body) setData(body); })
      .catch((cause) => { if (cause.name !== 'AbortError') setError(cause.message || 'Unable to load your analytics.'); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [range, refreshKey]);

  async function logout() {
    setLoggingOut(true);
    try { await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' }); } catch { /* The session check on the next visit handles network failures. */ }
    finally { window.location.assign('/login'); }
  }

  const overview = data?.overview;
  return (
    <div className="page page-analytics">
      <Navbar currentPage="analytics" />
      <main className="analytics-main">
        <header className="analytics-page-header">
          <div>
            <SectionLabel number="05">PERSONAL ERROR INTELLIGENCE</SectionLabel>
            <h1>Your Error Analytics</h1>
            <p>Understand your coding patterns and discover where you need to improve.</p>
          </div>
          <div className="analytics-user">
            <span className="user-avatar" aria-label={`Avatar for ${user.name || user.email}`}>{initials(user.name, user.email)}</span>
            <span className="user-name">{user.name || user.email}</span>
            <Button variant="quiet" type="button" disabled={loggingOut} onClick={logout}>{loggingOut ? 'Signing out…' : 'Sign out'}</Button>
          </div>
        </header>

        <div className="analytics-toolbar">
          <label htmlFor="range-select">DATE RANGE</label>
          <select id="range-select" value={range} onChange={(event) => setRange(event.target.value)}>
            {RANGE_OPTIONS.map(([value, label]) => <option value={value} key={value}>{label}</option>)}
          </select>
          <Button variant="outline" type="button" disabled={loading} onClick={() => setRefreshKey((value) => value + 1)}>
            <span aria-hidden="true">↻</span> Refresh
          </Button>
        </div>

        {error && <ErrorNotice message={error} onRetry={() => setRefreshKey((value) => value + 1)} />}

        <section className="overview-grid" aria-label="Error overview">
          {loading && !data ? <><StatSkeleton /><StatSkeleton /><StatSkeleton /><StatSkeleton /></> : <>
            <StatCard label="Total Errors" value={overview?.totalErrors ?? '—'} detail="Recorded failed runs" />
            <StatCard label="Most Error-Prone Language" value={overview?.mostErrorProneLanguage?.name || '—'} detail={overview?.mostErrorProneLanguage ? `${overview.mostErrorProneLanguage.count} recorded errors` : 'No error leader in this period'} />
            <StatCard label="Most Frequent Error Type" value={overview?.mostFrequentErrorType?.name || '—'} detail={overview?.mostFrequentErrorType ? `${overview.mostFrequentErrorType.count} occurrences` : 'No repeated error type'} />
            <StatCard label="Number of Languages Used" value={overview?.languagesUsed ?? '—'} detail="Languages with recorded runs" />
          </>}
        </section>

        <div className="analytics-panels">
          <AnalyticsSection
            number="01"
            title="Languages Where You Make the Most Mistakes"
            description="Failed runs grouped by the language used."
            rows={data?.languages || []}
            nameKey="language"
            countKey="errorCount"
            percentageKey="percentage"
            loading={loading && !data}
            error={error}
            onRetry={() => setRefreshKey((value) => value + 1)}
          />
          <AnalyticsSection
            number="02"
            title="Your Most Repeated Mistakes"
            description="Stored error types, ranked by occurrence."
            rows={data?.errorTypes || []}
            nameKey="errorType"
            countKey="occurrences"
            percentageKey="percentage"
            descriptionKey="description"
            loading={loading && !data}
            error={error}
            onRetry={() => setRefreshKey((value) => value + 1)}
          />
        </div>

        <Card className="insights-card">
          <div className="analytics-card-heading">
            <SectionLabel number="03">DETERMINISTIC OBSERVATIONS</SectionLabel>
            <h2>Insights from your data</h2>
            <p>Rule-based patterns from recorded errors. These are not AI-generated.</p>
          </div>
          {loading && !data ? <LoadingBlock label="Loading insights" /> : error ? <ErrorNotice message={error} onRetry={() => setRefreshKey((value) => value + 1)} /> : data?.insights?.length ? (
            <ul className="insights-list">
              {data.insights.map((insight) => <li key={insight.id}><span aria-hidden="true">↗</span>{insight.text}</li>)}
            </ul>
          ) : <EmptyState title="Not enough error data for an insight yet" detail="Insights appear when a repeated pattern is supported by your recorded runs." />}
        </Card>
        <p className="analytics-method-note">{data?.definition || 'Errors are based on stored failed execution results.'} {data?.errorTypeMethod || ''}</p>
      </main>
      <Footer />
    </div>
  );
}
