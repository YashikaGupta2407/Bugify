/**
 * Bugify Workspace Scanner - Types & Contracts
 */

export interface BugifyIssue {
  id: string;
  filePath: string;
  line: number;
  column: number;
  endLine?: number;
  endColumn?: number;
  severity: 'error' | 'warning' | 'info';
  message: string;
  source: string;
  code?: string;
  analyzer: 'tsc' | 'eslint' | 'pyright' | 'vscode' | string;
  uri?: string;
  rawOutput?: string;
}

export type AnalyzerType = 'tsc' | 'eslint' | 'pyright' | 'vscode';

export type AnalyzerRunStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'not_configured'
  | 'timed_out'
  | 'failed';

export interface AnalyzerStatus {
  name: string;
  type: AnalyzerType;
  status: AnalyzerRunStatus;
  issueCount: number;
  message?: string;
  durationMs?: number;
}

export interface ProjectCapabilities {
  workspaceRoot: string;
  hasTypeScript: boolean;
  tsconfigPaths: string[];
  tscExecutable?: string;
  hasESLint: boolean;
  eslintConfigPath?: string;
  eslintExecutable?: string;
  hasPython: boolean;
  pythonFilesCount: number;
  pyrightExecutable?: string;
}

export interface WorkspaceScanResult {
  issues: BugifyIssue[];
  analyzers: AnalyzerStatus[];
  scannedAt: Date;
  summary: {
    totalIssues: number;
    errorCount: number;
    warningCount: number;
    infoCount: number;
    fileCount: number;
  };
  stateMessage: string;
  durationMs: number;
}

export type ScanProgressCallback = (status: AnalyzerStatus) => void;

export interface CancellationToken {
  isCancellationRequested: boolean;
}
