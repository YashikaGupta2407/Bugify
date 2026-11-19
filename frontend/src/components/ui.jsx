import React from 'react';

export function Button({ href, variant = 'primary', className = '', children, ...props }) {
  const Element = href ? 'a' : 'button';
  return (
    <Element className={`button button-${variant} ${className}`.trim()} href={href} {...props}>
      {children}
    </Element>
  );
}

export function Card({ className = '', children, ...props }) {
  return <section className={`glass-card ${className}`.trim()} {...props}>{children}</section>;
}

export function Input({ label, error, id, className = '', ...props }) {
  return (
    <div className={`field ${className}`.trim()}>
      <label htmlFor={id}>{label}</label>
      <input id={id} aria-invalid={Boolean(error)} aria-describedby={error ? `${id}-error` : undefined} {...props} />
      {error && <span className="field-error" id={`${id}-error`}>{error}</span>}
    </div>
  );
}

export function StatCard({ label, value, detail }) {
  return (
    <Card className="stat-card">
      <span className="stat-label">{label}</span>
      <strong className="stat-value">{value}</strong>
      <span className="stat-detail">{detail}</span>
    </Card>
  );
}

export function SectionLabel({ children, number }) {
  return <div className="section-label"><span>{number}</span>{children}</div>;
}

export function EmptyState({ title = 'No errors recorded in this period', detail }) {
  return (
    <div className="empty-state" role="status">
      <span className="empty-state-mark" aria-hidden="true">—</span>
      <strong>{title}</strong>
      {detail && <p>{detail}</p>}
    </div>
  );
}

export function Skeleton({ className = '' }) {
  return <div className={`skeleton ${className}`.trim()} aria-hidden="true" />;
}

export function LoadingBlock({ label = 'Loading data' }) {
  return <div className="loading-block" role="status" aria-label={label}><Skeleton /><Skeleton /><Skeleton /></div>;
}

export function RankedList({ rows, label, nameKey, countKey, percentageKey, descriptionKey }) {
  if (!rows.length) return <EmptyState />;
  return (
    <ol className="ranked-list" aria-label={label}>
      {rows.map((row) => (
        <li className="ranked-row" key={row[nameKey]}>
          <span className="rank-number">{String(row.rank).padStart(2, '0')}</span>
          <span className="rank-copy">
            <strong>{row[nameKey]}</strong>
            {descriptionKey && <small>{row[descriptionKey]}</small>}
          </span>
          <span className="rank-value">
            <strong>{row[countKey]}</strong>
            <small>{row[percentageKey]}%</small>
          </span>
        </li>
      ))}
    </ol>
  );
}

export function BarChart({ rows, label, nameKey, countKey }) {
  if (!rows.length) return <EmptyState />;
  let max = 1;
  for (const row of rows) if (row[countKey] > max) max = row[countKey];
  const textAlternative = rows.map((row) => `${row[nameKey]}: ${row[countKey]}`).join('; ');

  return (
    <div className="bar-chart" role="img" aria-label={`${label}. ${textAlternative}`}>
      {rows.map((row) => (
        <div className="chart-row" key={row[nameKey]} aria-hidden="true">
          <span className="chart-name">{row[nameKey]}</span>
          <span className="chart-track"><span className="chart-fill" style={{ width: `${Math.max(4, (row[countKey] / max) * 100)}%` }} /></span>
          <span className="chart-count">{row[countKey]}</span>
        </div>
      ))}
    </div>
  );
}

export function ErrorNotice({ message, onRetry }) {
  return (
    <div className="error-notice" role="alert">
      <strong>We couldn’t load this data.</strong>
      <p>{message}</p>
      {onRetry && <Button variant="secondary" type="button" onClick={onRetry}>Try again</Button>}
    </div>
  );
}
