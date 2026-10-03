/**
 * Bugify TypeScript Data Types & Contracts
 */

export interface BugifyDiagnostic {
  severity: 'error' | 'warning' | 'information' | 'hint';
  message: string;
  source?: string;
  code?: string;
  startLine: number;
  startColumn: number;
  endLine: number;
  endColumn: number;
  filePath?: string;
  uri?: string;
}

export interface CodeChange {
  line: number;
  before: string;
  after: string;
  reason: string;
}

export interface FixValidationResult {
  status: 'validated' | 'generated' | 'needs_context' | 'validation_failed' | 'cannot_fix';
  message: string;
  checkerUsed?: string;
}

export interface AnalyzeRequest {
  mode: 'analyze_error' | 'analyze_code';
  detail: 'normal' | 'deep';
  workspace?: {
    name: string;
  };
  file: {
    path: string;
    language: string;
  };
  cursor?: {
    line: number;
    column: number;
  };
  selection?: string;
  codeContext: string;
  functionContext?: string;
  imports?: string;
  dependencies?: Record<string, string>;
  diagnostic?: BugifyDiagnostic;
  diagnostics?: BugifyDiagnostic[];
}

export interface AnalysisLocation {
  file: string;
  startLine: number;
  startColumn?: number;
  endLine?: number;
  endColumn?: number;
  line?: number;
}

export interface AnalysisResult {
  sessionId?: number;
  analysisSource: 'ai' | 'rules';
  status: 'fixed' | 'needs_context' | 'cannot_fix';
  errorType: string;
  title: string;
  location: AnalysisLocation;
  summary: string;
  rootCause: string;
  whyItHappens: string;
  originalCode: string;
  correctedCode: string | null;
  changes: CodeChange[];
  explanation: string;
  confidence: number;
  validation: FixValidationResult;
  severity?: 'error' | 'warning' | 'info' | 'hint';
  // Backward compatibility fields
  cause?: string;
  suggestion?: string;
}

export interface WorkspaceFileIssues {
  filePath: string;
  uri: string;
  errorCount: number;
  warningCount: number;
  diagnostics: BugifyDiagnostic[];
}

export interface WebviewIncomingMessage {
  command:
    | 'run-analysis'
    | 'analyze-ai'
    | 'explain-more'
    | 'reveal-line'
    | 'copy-code'
    | 'apply-fix'
    | 'select-issue'
    | 'retry'
    | 'switch-mode'
    | 'scan-workspace'
    | 'open-issue';
  mode?: 'workspace' | 'current_file';
  diagnosticIndex?: number;
  line?: number;
  column?: number;
  file?: string;
  uri?: string;
  code?: string;
  originalCode?: string;
  detail?: 'normal' | 'deep';
  diagnostic?: BugifyDiagnostic;
}
