import React, { useState } from 'react';
import './App.css';

function App() {
  const [language, setLanguage] = useState('python');
  const [code, setCode] = useState('print(10/0)');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [errorMessage, setErrorMessage] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();

    // Client-side validation: do not allow submitting empty code
    if (!code.trim()) {
      setErrorMessage('Please enter some code before running.');
      setResult(null);
      return;
    }

    setLoading(true);
    setErrorMessage('');
    setResult(null);

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

      const data = await response.json();

      if (!response.ok) {
        // Handle API error response (e.g., 400 Bad Request)
        setErrorMessage(data.error || 'Server returned an error.');
      } else {
        setResult(data);
      }
    } catch (err) {
      // Handle network failure or server unreachable
      setErrorMessage('Could not reach the server. Please check your backend connection.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="container">
      <h1>BUGIFY</h1>

      <form onSubmit={handleSubmit}>
        <div className="controls">
          <label htmlFor="language-select">Language:</label>
          <select
            id="language-select"
            value={language}
            onChange={(e) => setLanguage(e.target.value)}
            disabled={loading}
          >
            <option value="python">Python</option>
            <option value="javascript">JavaScript</option>
          </select>
        </div>

        <div className="editor-wrapper">
          <textarea
            id="code-editor"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="Write or paste your code here..."
            disabled={loading}
            spellCheck="false"
          />
        </div>

        <div className="action-bar">
          <button type="submit" id="run-button" disabled={loading || !code.trim()}>
            {loading ? 'Running...' : 'RUN CODE'}
          </button>
          {errorMessage && (
            <div className="client-error" id="client-error">
              {errorMessage}
            </div>
          )}
        </div>
      </form>

      {result && (
        <div className="result-panel" id="result-panel">
          <h2>Execution Result</h2>
          <div className="result-item">
            <strong>Status:</strong>
            <span
              className={result.status === 'success' ? 'status-success' : 'status-error'}
              id="result-status"
            >
              {result.status}
            </span>
          </div>

          <div className="result-item">
            <strong>Error Type:</strong>
            <span id="result-error-type">{result.errorType || 'None'}</span>
          </div>

          <div className="result-item">
            <strong>Error Message:</strong>
            <span id="result-error-message">{result.errorMessage || 'None'}</span>
          </div>

          <div className="result-item">
            <strong>Output:</strong>
            <div className="output-box" id="result-output">
              {result.output || 'No output'}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
