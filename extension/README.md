# Bugify VS Code Extension

**Workspace intelligence and developer debugging instrument.**

Bugify is an advanced debugging instrument for VS Code that brings contextual error analysis directly into your editor. When your code encounters compiler diagnostics or project errors, Bugify collects bounded context, redacts sensitive tokens, performs static and rule-based diagnostic analysis, and renders actionable explanations alongside suggested fixes in a restrained, high-density panel.

---

## Key Capabilities

- **Workspace Static Analysis**: Runs integrated workspace analyzers (TypeScript, ESLint, Python, Biome) to discover compiler errors across project files, including unopened files.
- **Bounded Context Collection**: Gathers 20 lines before and after the issue (or a tightly focused selection window), never transmitting entire repositories.
- **Client and Server Secret Redaction**: Automatically redacts API keys (OpenAI, Google Gemini, AWS, GitHub), Bearer tokens, passwords, and private RSA keys prior to transmission.
- **Privacy Enforcement**: Skips sensitive files (`.env*`, `id_rsa*`, `*.pem`, `*.key`, `credentials.json`, `secrets.*`).
- **Resilient Fallback Mode**: Deterministic rule-based analysis labeled `LOCAL DIAGNOSTIC` when offline or when external models are unavailable.
- **Copy-Only Safety**: Suggests verified diffs with one-click copying. Does not modify source files without explicit confirmation.
- **Quick Fix Action**: Provides `Debug with Bugify` in VS Code's `Ctrl+.` / `Cmd+.` quick fix menu.

---

## Commands

| Command | Title | Description |
| :--- | :--- | :--- |
| `bugify.openPanel` | **Bugify: Open Panel** | Opens the Bugify instrument panel beside your editor. |
| `bugify.scanWorkspace` | **Bugify: Scan Workspace** | Runs workspace static analyzers across project files. |
| `bugify.analyzeCurrentError` | **Bugify: Analyze Current Error** | Analyzes the diagnostic at the cursor or the nearest error in the active file. |
| `bugify.analyzeCurrentCode` | **Bugify: Analyze Current Code** | Analyzes selected code or a bounded window around the cursor. |
| `bugify.open` | **Bugify: Open Instrument** | Alias for bugify.openPanel. |
| `bugify.refreshDiagnostics` | **Bugify: Refresh Diagnostics** | Updates the status bar issue counter and reloads active diagnostics. |

---

## Configuration Settings

Configure these in VS Code Settings (`Cmd+,` / `Ctrl+,` search for `Bugify`):

| Setting | Default | Description |
| :--- | :--- | :--- |
| `bugify.backendUrl` | `http://localhost:5000` | URL of the running Bugify backend server. |
| `bugify.contextLines` | `20` | Number of surrounding lines before and after the target line to send for context. |
| `bugify.requestTimeoutMs` | `15000` | Timeout in milliseconds before timing out backend requests. |

---

## Test Fixtures

The extension includes a dedicated test workspace located in `test-fixtures/`:

1. **`js-undefined.js`**:
   - `const user = undefined; console.log(user.name);`
   - *Behavior*: Flags undefined property access (TypeScript code 2532).
   - *Tested via*: `Bugify: Analyze Current Error`.

2. **`js-reference.js`**:
   - `console.log(username);`
   - *Behavior*: Flags `Cannot find name 'username'` (code 2304), classified as `ReferenceError`.
   - *Tested via*: `Bugify: Analyze Current Error`.

3. **`ts-mismatch.ts`**:
   - `let userId: number = "user_42";`
   - *Behavior*: TypeScript compiler flags static type mismatch (code 2322).
   - *Tested via*: `Bugify: Analyze Current Error` or Quick Fix (`Cmd+.`).

4. **`py-index.py`**:
   - `numbers = [1, 2, 3]; print(numbers[10])`
   - *Tested via*: Highlight the lines and run `Bugify: Analyze Current Code`.

---

## Security Architecture

1. **Local Redaction**: Secrets matching API keys (`sk-*`, `AIza*`, `ghp_*`, `AKIA*`), `Bearer` tokens, assignments like `password = "..."`, and `BEGIN RSA PRIVATE KEY` blocks are replaced with `[REDACTED]` before transmission.
2. **Path Sanitization**: All file paths are strictly workspace-relative (`src/auth.js`). Absolute filesystem paths are never sent.
3. **Sensitive File Denylist**: Running Bugify on sensitive files (`.env`, `.env.local`, `credentials.json`, `*.pem`, `*.key`) is aborted locally with an explanatory message.
4. **Strict Webview CSP**: The webview uses a cryptographic random nonce per render, allows no external scripts or remote stylesheets, and communicates solely via typed VS Code `postMessage` APIs.

---

## Development & Testing

### Building the Extension
```bash
cd extension
npm install
npm run compile
```

### Running Automated Tests
```bash
npm test
```

### Launching in VS Code
1. Open the project in VS Code.
2. Press `F5` (or go to Run & Debug -> **Run Bugify Extension**).
3. A new Extension Development Host window will open with `test-fixtures/` loaded.

