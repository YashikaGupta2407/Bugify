"use strict";

/**
 * @typedef {Object} TscAnalyzerResult
 * @property {BugifyIssue[]} issues
 * @property {AnalyzerStatus} status
 */
/**
 * TypeScript Compiler (tsc) Analyzer Runner.
 * Safely executes `tsc --noEmit -p <configPath>` with timeout and cancellation.
 * Adheres to Section 3 and Section 18 error handling requirements.
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
exports.filterPlainJsFalsePositives = filterPlainJsFalsePositives;
exports.runTscAnalyzer = runTscAnalyzer;
const child_process_1 = require("child_process");
const path = __importStar(require("path"));
const fs = __importStar(require("fs"));
const tscParser_1 = require("../parsers/tscParser");
const envUtils_1 = require("../envUtils");
const logger_1 = require("../../logger");
const TIMEOUT_MS = 30000;
const NODE_BUILTIN_MODULES = new Set([
    'assert', 'async_hooks', 'buffer', 'child_process', 'cluster', 'console',
    'constants', 'crypto', 'dgram', 'diagnostics_channel', 'dns', 'domain',
    'events', 'fs', 'fs/promises', 'http', 'http2', 'https', 'inspector',
    'module', 'net', 'os', 'path', 'path/posix', 'path/win32', 'perf_hooks',
    'process', 'punycode', 'querystring', 'readline', 'repl', 'stream',
    'stream/promises', 'stream/consumers', 'stream/web', 'string_decoder',
    'test', 'timers', 'timers/promises', 'tls', 'trace_events', 'tty',
    'url', 'util', 'util/types', 'v8', 'vm', 'wasi', 'worker_threads', 'zlib',
]);
/**
 * Filters out false-positive TypeScript errors when checking untyped JavaScript files
 * (e.g. built-in Node modules and npm dependencies missing TS type declarations).
 */
function filterPlainJsFalsePositives(issues, workspaceRoot) {
    let pkgDeps = null;
    return issues.filter((issue) => {
        const isJs = issue.filePath.endsWith('.js') || issue.filePath.endsWith('.jsx');
        if (!isJs)
            return true;
        // Filter missing type declaration warnings on valid JS imports
        if (issue.code === 'TS2307') {
            const match = issue.message.match(/Cannot find module '([^']+)'/);
            if (match) {
                const mod = match[1];
                // 1. Built-in Node modules are always valid at runtime in Node.js
                if (NODE_BUILTIN_MODULES.has(mod) || mod.startsWith('node:')) {
                    return false;
                }
                // 2. Installed packages in package.json or node_modules
                if (!mod.startsWith('.') && !mod.startsWith('/')) {
                    if (pkgDeps === null) {
                        pkgDeps = new Set();
                        try {
                            const pkgJsonPath = path.join(workspaceRoot, 'package.json');
                            if (fs.existsSync(pkgJsonPath)) {
                                const pkg = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf8'));
                                const combined = { ...pkg.dependencies, ...pkg.devDependencies, ...pkg.peerDependencies };
                                for (const k of Object.keys(combined)) {
                                    pkgDeps.add(k);
                                }
                            }
                        }
                        catch {
                            // ignore
                        }
                    }
                    const basePkg = mod.startsWith('@') ? mod.split('/').slice(0, 2).join('/') : mod.split('/')[0];
                    if (pkgDeps.has(basePkg) || fs.existsSync(path.join(workspaceRoot, 'node_modules', basePkg))) {
                        return false; // Installed package; only missing TS declarations in plain JS
                    }
                }
            }
        }
        // TS80001: CommonJS module hint - informational suggestion only
        if (issue.code === 'TS80001' || issue.code === '80001') {
            issue.severity = 'info';
        }
        // TS7006: Parameter implicitly has an 'any' type in untyped JS
        if (issue.code === 'TS7006' || issue.code === 'TS7031') {
            issue.severity = 'info';
        }
        return true;
    });
}
async function runTscAnalyzer(workspaceRoot, tsconfigPaths, sourceFilesOrTscExecutable, tokenOrTscExecutable, maybeToken) {
    const startTime = Date.now();
    let sourceFiles;
    let token;
    if (Array.isArray(sourceFilesOrTscExecutable)) {
        sourceFiles = sourceFilesOrTscExecutable;
        token = maybeToken || (typeof tokenOrTscExecutable === 'object' ? tokenOrTscExecutable : undefined);
    }
    else {
        token = typeof tokenOrTscExecutable === 'object' ? tokenOrTscExecutable : maybeToken;
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
    const sampleResolved = (0, envUtils_1.resolveTscExecutable)(workspaceRoot, sampleConfig);
    if (!sampleResolved) {
        logger_1.logger.log('[Bugify] TypeScript/JavaScript project detected, but TypeScript compiler is unavailable.');
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
    const allIssues = [];
    let anyTimedOut = false;
    let anyFailed = false;
    if (tsconfigPaths.length > 0) {
        logger_1.logger.log(`[Bugify] Using ${sampleResolved.description} (${sampleResolved.command}) across ${tsconfigPaths.length} configuration(s)`);
        for (const configPath of tsconfigPaths) {
            if (token?.isCancellationRequested) {
                break;
            }
            try {
                const issues = await executeSingleTsc(workspaceRoot, configPath, token);
                allIssues.push(...issues);
            }
            catch (err) {
                if (err.timedOut) {
                    anyTimedOut = true;
                    logger_1.logger.log(`[Bugify] TypeScript scan timed out on ${path.basename(configPath)}`);
                }
                else {
                    anyFailed = true;
                    logger_1.logger.log(`[Bugify] TypeScript runner error: ${err.message || err}`);
                }
            }
        }
    }
    else if (sourceFiles && sourceFiles.length > 0) {
        // Case B: Plain JS/TS workspace without tsconfig.json (e.g. project/src/{app.js, auth.js})
        logger_1.logger.log(`[Bugify] Scanning ${sourceFiles.length} source file(s) with ${sampleResolved.description}`);
        try {
            const issues = await executeTscOnFiles(workspaceRoot, sourceFiles, token);
            allIssues.push(...issues);
        }
        catch (err) {
            if (err.timedOut) {
                anyTimedOut = true;
                logger_1.logger.log('[Bugify] TypeScript scan timed out on project source files');
            }
            else {
                anyFailed = true;
                logger_1.logger.log(`[Bugify] TypeScript file scan error: ${err.message || err}`);
            }
        }
    }
    const durationMs = Date.now() - startTime;
    logger_1.logger.log(`[Bugify] TypeScript results: ${allIssues.length} issue(s) in ${durationMs}ms`);
    let status = 'completed';
    let message = `Found ${allIssues.length} diagnostic(s)`;
    if (anyTimedOut) {
        status = 'timed_out';
        message = 'TypeScript scan timed out (exceeded 30s limit).';
    }
    else if (anyFailed && allIssues.length === 0) {
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
function executeSingleTsc(workspaceRoot, configPath, token) {
    return new Promise((resolve, reject) => {
        const resolved = (0, envUtils_1.resolveTscExecutable)(workspaceRoot, configPath);
        if (!resolved) {
            return reject(new Error('TypeScript compiler is unavailable.'));
        }
        const command = resolved.command;
        const args = [
            ...resolved.argsPrefix,
            '--noEmit',
            '--pretty', 'false',
            '-p', configPath,
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
            reject({ timedOut: true });
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
            if (timedOut)
                return;
            // Note: tsc exits with code 2 or 1 when type errors are found. This is expected.
            const parsedIssues = (0, tscParser_1.parseTscOutput)(stdout + '\n' + stderr, workspaceRoot);
            const filteredIssues = filterPlainJsFalsePositives(parsedIssues, workspaceRoot);
            resolve(filteredIssues);
        });
    });
}
function executeTscOnFiles(workspaceRoot, files, token) {
    return new Promise((resolve, reject) => {
        const resolved = (0, envUtils_1.resolveTscExecutable)(workspaceRoot);
        if (!resolved) {
            return reject(new Error('TypeScript compiler is unavailable.'));
        }
        const command = resolved.command;
        const args = [
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
            reject({ timedOut: true });
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
            if (timedOut)
                return;
            const parsedIssues = (0, tscParser_1.parseTscOutput)(stdout + '\n' + stderr, workspaceRoot);
            const filteredIssues = filterPlainJsFalsePositives(parsedIssues, workspaceRoot);
            resolve(filteredIssues);
        });
    });
}
