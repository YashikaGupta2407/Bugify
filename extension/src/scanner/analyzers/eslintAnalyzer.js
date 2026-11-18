"use strict";

/**
 * @typedef {Object} EslintAnalyzerResult
 * @property {BugifyIssue[]} issues
 * @property {AnalyzerStatus} status
 */
/**
 * ESLint Analyzer Runner.
 * Safely executes `eslint --format json .` with timeout and cancellation.
 * Adheres to Section 8 and Section 18 error handling requirements.
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.runEslintAnalyzer = runEslintAnalyzer;
const child_process_1 = require("child_process");
const path = __importStar(require("path"));
const eslintParser_1 = require("../parsers/eslintParser");
const envUtils_1 = require("../envUtils");
const logger_1 = require("../../logger");
const TIMEOUT_MS = 30000;
async function runEslintAnalyzer(workspaceRoot, hasESLint, eslintConfigPath, _unusedEslintExecutable, token) {
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
    const resolved = (0, envUtils_1.resolveEslintExecutable)(workspaceRoot);
    if (!resolved) {
        logger_1.logger.log('[Bugify] ESLint configuration detected, but ESLint is unavailable.');
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
    logger_1.logger.log(`[Bugify] Detected ESLint (${eslintConfigPath ? path.basename(eslintConfigPath) : 'configured'}) - using ${resolved.description}`);
    logger_1.logger.log(`[Bugify] Running: eslint --format json .`);
    return new Promise((resolve) => {
        const command = resolved.command;
        const args = [
            ...resolved.argsPrefix,
            '--format', 'json',
            '--no-error-on-unmatched-pattern',
            '.',
        ];
        let stdout = '';
        let stderr = '';
        let timedOut = false;
        const child = (0, child_process_1.spawn)(command, args, {
            cwd: workspaceRoot,
            env: (0, envUtils_1.getAugmentedEnv)(),
            shell: false,
        });
        const timer = setTimeout(() => {
            timedOut = true;
            try {
                child.kill('SIGTERM');
            }
            catch {
                // ignore
            }
            const durationMs = Date.now() - startTime;
            logger_1.logger.log('[Bugify] ESLint scan timed out');
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
                    }
                    catch {
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
            logger_1.logger.log(`[Bugify] ESLint runner error: ${err.message || err}`);
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
            if (timedOut)
                return;
            const durationMs = Date.now() - startTime;
            const issues = (0, eslintParser_1.parseEslintOutput)(stdout || stderr, workspaceRoot);
            logger_1.logger.log(`[Bugify] ESLint results: ${issues.length} issue(s) in ${durationMs}ms`);
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
