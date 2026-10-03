/**
 * Python Analyzer Runner (Pyright / Flake8 / Mypy).
 * Safely checks Python files with timeout and cancellation.
 * If no analyzer is installed, reports "No supported Python analyzer detected."
 */

import { spawn } from 'child_process';
import * as path from 'path';
import { BugifyIssue, AnalyzerStatus, CancellationToken } from '../types';
import { parsePythonOutput } from '../parsers/pythonParser';
import { resolvePyrightExecutable, getAugmentedEnv } from '../envUtils';
import { logger } from '../../logger';

const TIMEOUT_MS = 30000;

export interface PythonAnalyzerResult {
  issues: BugifyIssue[];
  status: AnalyzerStatus;
}

export async function runPythonAnalyzer(
  workspaceRoot: string,
  hasPython: boolean,
  _pyrightExecutable?: string,
  token?: CancellationToken
): Promise<PythonAnalyzerResult> {
  const startTime = Date.now();

  if (!hasPython) {
    return {
      issues: [],
      status: {
        name: 'Python',
        type: 'pyright',
        status: 'not_configured',
        issueCount: 0,
        message: 'No Python project files detected.',
        durationMs: 0,
      },
    };
  }

  const pyright = resolvePyrightExecutable(workspaceRoot);
  if (!pyright) {
    logger.log('[Bugify] Python project detected, but no supported Python analyzer (pyright) installed.');
    return {
      issues: [],
      status: {
        name: 'Python',
        type: 'pyright',
        status: 'not_configured',
        issueCount: 0,
        message: 'No supported Python analyzer detected.',
        durationMs: Date.now() - startTime,
      },
    };
  }

  logger.log(`[Bugify] Running Python analyzer: ${pyright} --outputjson`);

  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let timedOut = false;

    const child = spawn(pyright, ['--outputjson'], {
      cwd: workspaceRoot,
      env: getAugmentedEnv(),
      shell: false,
    });

    const timer = setTimeout(() => {
      timedOut = true;
      try {
        child.kill('SIGTERM');
      } catch {
        // ignore
      }
      resolve({
        issues: [],
        status: {
          name: 'Python',
          type: 'pyright',
          status: 'timed_out',
          issueCount: 0,
          message: 'Python scan timed out (exceeded 30s limit).',
          durationMs: Date.now() - startTime,
        },
      });
    }, TIMEOUT_MS);

    if (token) {
      const checkCancel = setInterval(() => {
        if (token.isCancellationRequested) {
          clearInterval(checkCancel);
          clearTimeout(timer);
          try {
            child.kill('SIGTERM');
          } catch {
            // ignore
          }
          resolve({
            issues: [],
            status: {
              name: 'Python',
              type: 'pyright',
              status: 'completed',
              issueCount: 0,
              message: 'Scan cancelled.',
              durationMs: Date.now() - startTime,
            },
          });
        }
      }, 200);
    }

    child.stdout.on('data', (d) => {
      stdout += d.toString();
    });

    child.stderr.on('data', (d) => {
      stderr += d.toString();
    });

    child.on('error', (err) => {
      clearTimeout(timer);
      logger.log(`[Bugify] Python analyzer execution error: ${err.message}`);
      resolve({
        issues: [],
        status: {
          name: 'Python',
          type: 'pyright',
          status: 'failed',
          issueCount: 0,
          message: `Python analyzer failed: ${err.message}`,
          durationMs: Date.now() - startTime,
        },
      });
    });

    child.on('close', (_code) => {
      clearTimeout(timer);
      if (timedOut) return;

      const durationMs = Date.now() - startTime;
      const issues = parsePythonOutput(stdout || stderr, workspaceRoot);
      logger.log(`[Bugify] Python results: ${issues.length} issue(s) in ${durationMs}ms`);

      resolve({
        issues,
        status: {
          name: 'Python',
          type: 'pyright',
          status: 'completed',
          issueCount: issues.length,
          message: `Found ${issues.length} diagnostic(s)`,
          durationMs,
        },
      });
    });
  });
}
