/**
 * ESLint Analyzer Runner.
 * Safely executes `eslint --format json .` with timeout and cancellation.
 * Adheres to Section 8 and Section 18 error handling requirements.
 */

import { spawn } from 'child_process';
import * as path from 'path';
import { BugifyIssue, AnalyzerStatus, CancellationToken } from '../types';
import { parseEslintOutput } from '../parsers/eslintParser';
import { resolveEslintExecutable, getAugmentedEnv } from '../envUtils';
import { logger } from '../../logger';

const TIMEOUT_MS = 30000;

export interface EslintAnalyzerResult {
  issues: BugifyIssue[];
  status: AnalyzerStatus;
}

export async function runEslintAnalyzer(
  workspaceRoot: string,
  hasESLint: boolean,
  eslintConfigPath?: string,
  _unusedEslintExecutable?: string,
  token?: CancellationToken
): Promise<EslintAnalyzerResult> {
  const startTime = Date.now();

  if (!hasESLint) {
    return {
      issues: [],
      status: {
        name: 'ESLint',
        type: 'eslint',
        status: 'not_configured',
        issueCount: 0,
        message: 'No ESLint configuration detected.',
        durationMs: 0,
      },
    };
  }

  const resolved = resolveEslintExecutable(workspaceRoot);
  if (!resolved) {
    logger.log('[Bugify] ESLint configuration detected, but ESLint is unavailable.');
    return {
      issues: [],
      status: {
        name: 'ESLint',
        type: 'eslint',
        status: 'failed',
        issueCount: 0,
        message: 'ESLint configuration detected, but ESLint is unavailable.',
        durationMs: Date.now() - startTime,
      },
    };
  }

  logger.log(`[Bugify] Detected ESLint (${eslintConfigPath ? path.basename(eslintConfigPath) : 'configured'}) - using ${resolved.description}`);
  logger.log(`[Bugify] Running: eslint --format json .`);

  return new Promise((resolve) => {
    const command = resolved.command;
    const args: string[] = [
      ...resolved.argsPrefix,
      '--format', 'json',
      '--no-error-on-unmatched-pattern',
      '.',
    ];

    let stdout = '';
    let stderr = '';
    let timedOut = false;

    const child = spawn(command, args, {
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
      const durationMs = Date.now() - startTime;
      logger.log('[Bugify] ESLint scan timed out');
      resolve({
        issues: [],
        status: {
          name: 'ESLint',
          type: 'eslint',
          status: 'timed_out',
          issueCount: 0,
          message: 'ESLint scan timed out (exceeded 30s limit).',
          durationMs,
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
              name: 'ESLint',
              type: 'eslint',
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
      const durationMs = Date.now() - startTime;
      logger.log(`[Bugify] ESLint runner error: ${err.message || err}`);
      resolve({
        issues: [],
        status: {
          name: 'ESLint',
          type: 'eslint',
          status: 'failed',
          issueCount: 0,
          message: 'ESLint configuration detected, but ESLint is unavailable.',
          durationMs,
        },
      });
    });

    child.on('close', (_code) => {
      clearTimeout(timer);
      if (timedOut) return;

      const durationMs = Date.now() - startTime;
      const issues = parseEslintOutput(stdout || stderr, workspaceRoot);
      logger.log(`[Bugify] ESLint results: ${issues.length} issue(s) in ${durationMs}ms`);

      resolve({
        issues,
        status: {
          name: 'ESLint',
          type: 'eslint',
          status: 'completed',
          issueCount: issues.length,
          message: `Found ${issues.length} lint issue(s)`,
          durationMs,
        },
      });
    });
  });
}
