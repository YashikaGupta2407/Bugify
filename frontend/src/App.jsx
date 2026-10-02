import React, { useState, useEffect } from 'react';
import './App.css';

const DEFAULT_PYTHON_CODE = `def divide(a, b):
    return a / b

print(divide(10, 0))`;

function App() {
  const [language, setLanguage] = useState('python');
  const [code, setCode] = useState(DEFAULT_PYTHON_CODE);
  const [executionState, setExecutionState] = useState('initial'); // 'initial' | 'running_code' | 'analyzing_error' | 'success' | 'error' | 'api_error'
  const [result, setResult] = useState(null);
  const [explanation, setExplanation] = useState(null);
  const [errorMessage, setErrorMessage] = useState('');
  const [history, setHistory] = useState([]);
  const [showHistory, setShowHistory] = useState(false);
  const [activeHistoryId, setActiveHistoryId] = useState(null);
  const [copiedCode, setCopiedCode] = useState(false);

  // Load history list on mount
  useEffect(() => {
    fetchHistory();
  }, []);

  const fetchHistory = async () => {
    try {
      const response = await fetch('/api/submissions');
      if (response.ok) {
        const data = await response.json();
        setHistory(data);
      }
    } catch (err) {
      console.warn('Could not load debugging history:', err);
    }
  };

  const handleRunCode = async (e) => {
    e.preventDefault();

    // Client-side validation: code must not be empty
    if (!code.trim()) {
      setErrorMessage('Please enter Python code before running.');
      setExecutionState('api_error');
      setResult(null);
      setExplanation(null);
      return;
    }

    setExecutionState('running_code');
    setErrorMessage('');
    setResult(null);
    setExplanation(null);
    setActiveHistoryId(null);

    // Transition loading visual after brief delay to show analysis phase
    const analysisTimer = setTimeout(() => {
      setExecutionState((prev) => (prev === 'running_code' ? 'analyzing_error' : prev));
    }, 1200);

    try {
      const response = await fetch('/api/submissions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          language,
          code,
        }),
      });

      clearTimeout(analysisTimer);
      const data = await response.json();

      if (!response.ok || !data.success) {
        setErrorMessage(data.message || 'Unable to execute code. Please try again.');
        setExecutionState('api_error');
        return;
      }

      setResult(data.result);
      setExplanation(data.explanation || null);

      if (data.result.status === 'success') {
        setExecutionState('success');
      } else {
        setExecutionState('error');
      }

      // Refresh history list with newly saved submission
      fetchHistory();
    } catch (err) {
      clearTimeout(analysisTimer);
      console.error('Fetch error:', err);
      setErrorMessage('Could not reach the server. Please check your network or server status.');
      setExecutionState('api_error');
    }
  };

  const handleSelectHistoryItem = async (id) => {
    try {
      setExecutionState('running_code');
      const response = await fetch(`/api/submissions/${id}`);
      if (!response.ok) {
        throw new Error('Failed to fetch submission details');
      }
      const data = await response.json();

      if (data.success) {
        setCode(data.submission.code);
        setLanguage(data.submission.language);
        setResult(data.result);
        setExplanation(data.explanation || null);
        setActiveHistoryId(id);
        setShowHistory(false);

        if (data.result?.status === 'success') {
          setExecutionState('success');
        } else {
          setExecutionState('error');
        }
      }
    } catch (err) {
      console.error('Error loading history attempt:', err);
      setErrorMessage('Could not load the selected debugging record.');
      setExecutionState('api_error');
    }
  };

  const handleApplyFix = (fixedCode) => {
    if (fixedCode) {
      setCode(fixedCode);
      setActiveHistoryId(null);
    }
  };

  const handleCopyFix = (fixedCode) => {
    if (fixedCode) {
      navigator.clipboard.writeText(fixedCode);
      setCopiedCode(true);
      setTimeout(() => setCopiedCode(false), 2000);
    }
  };

  const formatTimestamp = (dateStr) => {
    try {
      const d = new Date(dateStr);
      return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) + ' • ' + d.toLocaleDateString();
    } catch {
      return dateStr;
    }
  };

  const isRunning = executionState === 'running_code' || executionState === 'analyzing_error';

  return (
    <div className="layout-root">
      {/* Navigation / Header */}
      <header className="navbar">
        <div className="nav-brand">
          <h1>BUGIFY</h1>
          <span className="nav-tagline">AI-Powered Code Debugging & Error Understanding</span>
        </div>
        <div className="nav-actions">
          <button
            type="button"
            className="history-toggle-btn"
            onClick={() => setShowHistory(!showHistory)}
            title="Toggle Debugging History"
          >
            📋 History {history.length > 0 && `(${history.length})`}
          </button>
        </div>
      </header>

      {/* Main Workspace Container */}
      <main className="workspace-container">
        {/* Left Column: Code Editor */}
        <section className="editor-panel">
          <div className="panel-header">
            <div className="control-group">
              <label htmlFor="language-select">Language:</label>
              <select
                id="language-select"
                value={language}
                onChange={(e) => setLanguage(e.target.value)}
                disabled={isRunning}
              >
                <option value="python">Python</option>
              </select>
            </div>
            {activeHistoryId && (
              <span className="history-indicator">
                Viewing Historical Attempt #{activeHistoryId}
              </span>
            )}
          </div>

          <form onSubmit={handleRunCode} className="editor-form">
            <textarea
              id="code-editor"
              value={code}
              onChange={(e) => {
                setCode(e.target.value);
                if (activeHistoryId) setActiveHistoryId(null);
              }}
              placeholder="Write your Python code here..."
              disabled={isRunning}
              spellCheck="false"
              rows={16}
            />

            <div className="editor-actions">
              <button
                type="submit"
                id="run-button"
                className="btn-run"
                disabled={isRunning || !code.trim()}
              >
                {executionState === 'running_code' && '⚡ Running code...'}
                {executionState === 'analyzing_error' && '🔍 Analyzing error...'}
                {!isRunning && '▶ RUN CODE'}
              </button>

              {activeHistoryId && (
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => {
                    setCode(DEFAULT_PYTHON_CODE);
                    setActiveHistoryId(null);
                    setExecutionState('initial');
                    setResult(null);
                    setExplanation(null);
                  }}
                >
                  Reset Editor
                </button>
              )}
            </div>
          </form>
        </section>

        {/* Right Column: Bug Analysis & Results */}
        <section className="analysis-panel">
          <div className="panel-header">
            <h2>Bug Analysis</h2>
          </div>

          <div className="analysis-content">
            {/* Initial State */}
            {executionState === 'initial' && (
              <div className="state-placeholder" id="initial-state">
                <div className="placeholder-icon">💡</div>
                <h3>Ready to Debug</h3>
                <p>Write or paste your code on the left and click <strong>RUN CODE</strong>.</p>
                <p className="hint">Bugify will run your code, classify any failures, and explain why they happened.</p>
              </div>
            )}

            {/* Running States */}
            {isRunning && (
              <div className="state-placeholder running-card" id="running-state">
                <div className="spinner"></div>
                <h3>
                  {executionState === 'running_code' ? 'Running code...' : 'Analyzing your error with AI...'}
                </h3>
                <p className="hint">
                  {executionState === 'running_code'
                    ? 'Executing inside isolated sandbox...'
                    : 'Understanding cause, location, and preparing fix recommendations...'}
                </p>
              </div>
            )}

            {/* API / Network Error */}
            {executionState === 'api_error' && (
              <div className="alert-card error-alert" id="api-error-card">
                <strong>✕ Error Notice</strong>
                <p>{errorMessage}</p>
              </div>
            )}

            {/* Successful Execution */}
            {executionState === 'success' && result && (
              <div className="result-card success-card" id="success-card">
                <div className="card-badge success-badge">✓ Execution Successful</div>
                <div className="analysis-section">
                  <span className="section-label">PROGRAM OUTPUT:</span>
                  <pre className="code-box output-box" id="result-output">
                    {result.output || '(No stdout produced)'}
                  </pre>
                </div>
                {result.executionTime !== null && (
                  <div className="meta-footer">
                    <span>⏱ Execution Time: {result.executionTime}s</span>
                  </div>
                )}
              </div>
            )}

            {/* Error & AI Bug Explanation */}
            {executionState === 'error' && result && (
              <div className="result-card error-card" id="error-card">
                {/* Error Banner */}
                <div className="error-header-banner">
                  <span className="badge-danger">🔴 {result.errorType || 'RUNTIME_ERROR'}</span>
                  {result.errorMessage && (
                    <span className="error-title-msg">{result.errorMessage}</span>
                  )}
                </div>

                {/* AI Explanation Sections */}
                {explanation ? (
                  <div className="explanation-body">
                    {/* What Happened */}
                    <div className="analysis-block">
                      <div className="block-title">WHAT HAPPENED?</div>
                      <p className="block-text highlight-summary">{explanation.summary}</p>
                    </div>

                    {/* Why Did It Happen */}
                    <div className="analysis-block">
                      <div className="block-title">WHY DID IT HAPPEN?</div>
                      <p className="block-text">{explanation.cause}</p>
                    </div>

                    {/* Where */}
                    {explanation.location && (
                      <div className="analysis-block">
                        <div className="block-title">WHERE?</div>
                        <code className="inline-location">{explanation.location}</code>
                      </div>
                    )}

                    {/* Deep Explanation */}
                    <div className="analysis-block">
                      <div className="block-title">CONCEPT EXPLANATION</div>
                      <p className="block-text explanation-detail">{explanation.explanation}</p>
                    </div>

                    {/* How to Fix It */}
                    <div className="analysis-block">
                      <div className="block-title">HOW TO FIX IT</div>
                      <p className="block-text">{explanation.suggestion}</p>
                    </div>

                    {/* Corrected Code */}
                    {explanation.correctedCode && (
                      <div className="analysis-block">
                        <div className="fix-header-row">
                          <div className="block-title">SUGGESTED FIX</div>
                          <div className="fix-action-buttons">
                            <button
                              type="button"
                              className="btn-tiny"
                              onClick={() => handleCopyFix(explanation.correctedCode)}
                            >
                              {copiedCode ? 'Copied!' : 'Copy Code'}
                            </button>
                            <button
                              type="button"
                              className="btn-tiny btn-tiny-primary"
                              onClick={() => handleApplyFix(explanation.correctedCode)}
                              title="Replace code in editor with suggested fix"
                            >
                              Apply to Editor
                            </button>
                          </div>
                        </div>
                        <pre className="code-box fix-box">{explanation.correctedCode}</pre>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="fallback-notice">
                    <p>
                      <strong>AI Explanation Unavailable:</strong> We couldn't generate an explanation right now. Your execution result has still been saved.
                    </p>
                  </div>
                )}

                {/* Execution Metadata */}
                <div className="meta-footer">
                  <span>⏱ Execution Time: {result.executionTime}s</span>
                  {result.submissionId && <span># Submission ID: {result.submissionId}</span>}
                </div>
              </div>
            )}
          </div>
        </section>
      </main>

      {/* Debugging History Sidebar */}
      {showHistory && (
        <aside className="history-sidebar">
          <div className="sidebar-header">
            <h3>DEBUGGING HISTORY</h3>
            <button
              type="button"
              className="btn-close"
              onClick={() => setShowHistory(false)}
            >
              ✕
            </button>
          </div>

          <div className="history-list">
            {history.length === 0 ? (
              <div className="empty-history">No past debugging attempts yet.</div>
            ) : (
              history.map((item) => (
                <div
                  key={item.id}
                  className={`history-item ${activeHistoryId === item.id ? 'active-item' : ''}`}
                  onClick={() => handleSelectHistoryItem(item.id)}
                >
                  <div className="item-top">
                    <span className={item.status === 'success' ? 'badge-success-mini' : 'badge-error-mini'}>
                      {item.status === 'success' ? '✓ SUCCESS' : `🔴 ${item.errorType || 'ERROR'}`}
                    </span>
                    <span className="item-id">#{item.id}</span>
                  </div>
                  <div className="item-bottom">
                    <span className="item-lang">{item.language}</span>
                    <span className="item-date">{formatTimestamp(item.createdAt)}</span>
                  </div>
                </div>
              ))
            )}
          </div>
        </aside>
      )}
    </div>
  );
}

export default App;
