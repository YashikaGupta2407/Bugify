/**
 * TypeScript Compiler (tsc) Analyzer Runner.
 * Safely executes `tsc --noEmit -p <configPath>` with timeout and cancellation.
 * Adheres to Section 3 and Section 18 error handling requirements.
 */

import { spawn } from 'child_process';
import * as path from 'path';
import { BugifyIssue, AnalyzerStatus, CancellationToken } from '../types';
import { parseTscOutput } from '../parsers/tscParser';
import { resolveTscExecutable, getAugmentedEnv } from '../envUtils';
import { logger } from '../../logger';

const TIMEOUT_MS = 30000;

export interface TscAnalyzerResult {
  issues: BugifyIssue[];
  status: AnalyzerStatus;
}

export async function runTscAnalyzer(
  workspaceRoot: string,
  tsconfigPaths: string[],
  sourceFilesOrTscExecutable?: string[] | string,
  tokenOrTscExecutable?: CancellationToken | string,
  maybeToken?: CancellationToken
): Promise<TscAnalyzerResult> {
  const startTime = Date.now();

  let sourceFiles: string[] | undefined;
  let token: CancellationToken | undefined;

  if (Array.isArray(sourceFilesOrTscExecutable)) {
    sourceFiles = sourceFilesOrTscExecutable;
    token = maybeToken || (typeof tokenOrTscExecutable === 'object' ? (tokenOrTscExecutable as CancellationToken) : undefined);
  } else {
    token = typeof tokenOrTscExecutable === 'object' ? (tokenOrTscExecutable as CancellationToken) : maybeToken;
  }

  // Case A: Workspace has no tsconfig and no JS/TS source files
  if (tsconfigPaths.length === 0 && (!sourceFiles || sourceFiles.length === 0)) {
    return {
      issues: [],
      status: {
        name: 'TypeScript',
        type: 'tsc',
        status: 'not_configured',
        issueCount: 0,
        message: 'No tsconfig.json, jsconfig.json, or source files detected.',
        durationMs: 0,
      },
    };
  }

  // Pre-check if any compiler is available
  const sampleConfig = tsconfigPaths.length > 0 ? tsconfigPaths[0] : undefined;
  const sampleResolved = resolveTscExecutable(workspaceRoot, sampleConfig);
  if (!sampleResolved) {
    logger.log('[Bugify] TypeScript/JavaScript project detected, but TypeScript compiler is unavailable.');
    return {
      issues: [],
      status: {
        name: 'TypeScript',
        type: 'tsc',
        status: 'failed',
        issueCount: 0,
        message: 'TypeScript project detected, but TypeScript compiler is unavailable.',
        durationMs: Date.now() - startTime,
      },
    };
  }

  const allIssues: BugifyIssue[] = [];
  let anyTimedOut = false;
  let anyFailed = false;

  if (tsconfigPaths.length > 0) {
    logger.log(`[Bugify] Using ${sampleResolved.description} (${sampleResolved.command}) across ${tsconfigPaths.length} configuration(s)`);

    for (const configPath of tsconfigPaths) {
      if (token?.isCancellationRequested) {
        break;
      }

      try {
        const issues = await executeSingleTsc(workspaceRoot, configPath, token);
        allIssues.push(...issues);
      } catch (err: any) {
        if (err.timedOut) {
          anyTimedOut = true;
          logger.log(`[Bugify] TypeScript scan timed out on ${path.basename(configPath)}`);
        } else {
          anyFailed = true;
          logger.log(`[Bugify] TypeScript runner error: ${err.message || err}`);
        }
      }
    }
  } else if (sourceFiles && sourceFiles.length > 0) {
    // Case B: Plain JS/TS workspace without tsconfig.json (e.g. project/src/{app.js, auth.js})
    logger.log(`[Bugify] Scanning ${sourceFiles.length} source file(s) with ${sampleResolved.description}`);

    try {
      const issues = await executeTscOnFiles(workspaceRoot, sourceFiles, token);
      allIssues.push(...issues);
    } catch (err: any) {
      if (err.timedOut) {
        anyTimedOut = true;
        logger.log('[Bugify] TypeScript scan timed out on project source files');
      } else {
        anyFailed = true;
        logger.log(`[Bugify] TypeScript file scan error: ${err.message || err}`);
      }
    }
  }

  const durationMs = Date.now() - startTime;
  logger.log(`[Bugify] TypeScript results: ${allIssues.length} issue(s) in ${durationMs}ms`);

  let status: AnalyzerStatus['status'] = 'completed';
  let message = `Found ${allIssues.length} diagnostic(s)`;
  if (anyTimedOut) {
    status = 'timed_out';
    message = 'TypeScript scan timed out (exceeded 30s limit).';
  } else if (anyFailed && allIssues.length === 0) {
    status = 'failed';
    message = 'TypeScript project detected, but TypeScript compiler is unavailable.';
  }

  return {
    issues: allIssues,
    status: {
      name: 'TypeScript',
      type: 'tsc',
      status,
      issueCount: allIssues.length,
      message,
      durationMs,
    },
  };
}

function executeSingleTsc(
  workspaceRoot: string,
  configPath: string,
  token?: CancellationToken
): Promise<BugifyIssue[]> {
  return new Promise((resolve, reject) => {
    const resolved = resolveTscExecutable(workspaceRoot, configPath);
    if (!resolved) {
      return reject(new Error('TypeScript compiler is unavailable.'));
    }

    const command = resolved.command;
    const args: string[] = [
      ...resolved.argsPrefix,
      '--noEmit',
      '--pretty', 'false',
      '-p', configPath,
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
      reject({ timedOut: true });
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
          resolve([]);
        }
      }, 200);
    }

    child.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    child.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });

    child.on('close', (code) => {
      clearTimeout(timer);
      if (timedOut) return;

      // Note: tsc exits with code 2 or 1 when type errors are found. This is expected.
      const parsedIssues = parseTscOutput(stdout + '\n' + stderr, workspaceRoot);
      resolve(parsedIssues);
    });
  });
}

function executeTscOnFiles(
  workspaceRoot: string,
  files: string[],
  token?: CancellationToken
): Promise<BugifyIssue[]> {
  return new Promise((resolve, reject) => {
    const resolved = resolveTscExecutable(workspaceRoot);
    if (!resolved) {
      return reject(new Error('TypeScript compiler is unavailable.'));
    }

    const command = resolved.command;
    const args: string[] = [
      ...resolved.argsPrefix,
      '--allowJs',
      '--checkJs',
      '--noEmit',
      '--pretty', 'false',
      ...files.slice(0, 150),
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
      reject({ timedOut: true });
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
          resolve([]);
        }
      }, 200);
    }

    child.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    child.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });

    child.on('close', () => {
      clearTimeout(timer);
      if (timedOut) return;

      const parsedIssues = parseTscOutput(stdout + '\n' + stderr, workspaceRoot);
      resolve(parsedIssues);
    });
  });
}
