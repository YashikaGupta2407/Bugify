/**
 * Pure functions to generate local explanations for diagnostics immediately,
 * ensuring the extension UI displays rich error context even before or without backend AI connection.
 * Dynamically analyzes actual code context, determines root causes, generates specific fixes,
 * classifies error categories (Phase 12), and performs safe static validation (Phase 7 & 8).
 * NEVER hardcodes test fixture values or fake diagnostics into production pipelines.
 */

import * as fs from 'fs';
import * as path from 'path';
import { BugifyDiagnostic, AnalysisResult, CodeChange } from '../types/bugify';
import { mapDiagnosticSeverity, classifyErrorCategory } from './diagnosticUtils';
import { validateProposedFix } from './fixValidator';

/**
 * Safely attempts to read the target line of code from disk if available.
 */
function tryReadCodeFromDisk(filePath: string, line: number): { lineText: string; fullContent?: string } | undefined {
  try {
    const candidates = [
      filePath,
      filePath.replace(/^extension\//, ''),
      path.resolve(process.cwd(), filePath),
      path.resolve(process.cwd(), filePath.replace(/^extension\//, '')),
      path.resolve(__dirname, '../../', filePath),
      path.resolve(__dirname, '../../', filePath.replace(/^extension\//, '')),
    ];

    try {
      const vscode = require('vscode');
      if (vscode.workspace?.workspaceFolders?.[0]) {
        const wsRoot = vscode.workspace.workspaceFolders[0].uri.fsPath;
        candidates.push(path.join(wsRoot, filePath));
        candidates.push(path.join(wsRoot, filePath.replace(/^extension\//, '')));
      }
    } catch {
      // not in VS Code host
    }

    for (const candidate of candidates) {
      if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
        const fullContent = fs.readFileSync(candidate, 'utf8');
        const lines = fullContent.split(/\r?\n/);
        if (line >= 1 && line <= lines.length) {
          return { lineText: lines[line - 1], fullContent };
        }
      }
    }
  } catch {
    // ignore
  }
  return undefined;
}

export function buildLocalAnalysis(
  diagnostic: BugifyDiagnostic,
  filePath: string,
  providedLineText?: string,
  providedFullContent?: string
): AnalysisResult {
  const line = diagnostic.startLine;
  const msg = diagnostic.message || '';
  const code = diagnostic.code ? String(diagnostic.code) : '';
  const normSeverity = mapDiagnosticSeverity(diagnostic.severity);
  const category = classifyErrorCategory(diagnostic);

  const location = {
    file: filePath,
    startLine: diagnostic.startLine,
    startColumn: diagnostic.startColumn,
    endLine: diagnostic.endLine,
    endColumn: diagnostic.endColumn,
    line,
  };

  // Attempt to read the actual line of code
  let lineText = providedLineText;
  let fullContent = providedFullContent;
  if (!lineText) {
    const diskRead = tryReadCodeFromDisk(filePath, line);
    if (diskRead) {
      lineText = diskRead.lineText;
      fullContent = diskRead.fullContent;
    }
  }

  const trimmedLine = (lineText || '').trim();

  // -----------------------------------------------------------------
  // 1. CommonJS to ES Module Conversion Suggestion (TS80001)
  // -----------------------------------------------------------------
  if (code === '80001' || code === 'TS80001' || msg.includes('File is a CommonJS module')) {
    return {
      analysisSource: 'rules',
      status: 'needs_context',
      errorType: 'TS Information',
      category: 'CONFIGURATION',
      title: 'Module Conversion Suggestion',
      location,
      summary: msg,
      rootCause:
        'TS80001: TypeScript suggests this CommonJS module (require/module.exports) may be converted to ECMAScript module syntax (import/export).',
      whyItHappens:
        'TypeScript language service identifies CommonJS files that could be modernized to ES module syntax. This is an informational suggestion, not a compiler error or warning.',
      why: 'Modern JavaScript tools prefer standard ES module imports and exports for tree-shaking and static analysis.',
      recommendedAction:
        'You may convert require() and module.exports to import/export statements, or keep CommonJS syntax if required by your runtime environment.',
      originalCode: trimmedLine,
      correctedCode: null,
      changes: [],
      explanation:
        'This is an informational diagnostic (TS80001), not an error or warning. The file is currently using CommonJS module syntax and can optionally be refactored to standard ES module imports and exports.',
      confidence: 0.95,
      confidenceLevel: 'HIGH',
      verificationStatus: 'NOT_VERIFIED',
      validation: {
        status: 'needs_context',
        message: 'Informational suggestion - no automated fix required.',
        checkerUsed: 'local_rules',
      },
      cause: 'Diagnostic code: 80001. CommonJS module syntax detected.',
      suggestion:
        'You may convert require() and module.exports to import/export statements, or keep CommonJS syntax if required by your runtime environment.',
      severity: 'information',
    };
  }

  // -----------------------------------------------------------------
  // 2. Unused Variable or Parameter (TS6133, etc.)
  // -----------------------------------------------------------------
  if (code === '6133' || code === 'TS6133' || msg.includes('declared but its value is never read') || msg.includes('declared but never used')) {
    const identMatch = msg.match(/'([^']+)'/);
    const identifier = identMatch ? identMatch[1] : 'identifier';

    let originalCode = trimmedLine;
    let correctedCode: string | null = null;
    let changes: CodeChange[] = [];

    if (trimmedLine && trimmedLine.includes(identifier)) {
      // If parameter or local variable, prefix with underscore to silence warning
      const prefixed = `_${identifier}`;
      correctedCode = trimmedLine.replace(new RegExp(`\\b${identifier}\\b`), prefixed);
      changes = [
        {
          line,
          before: trimmedLine,
          after: correctedCode,
          reason: `Prefix unused '${identifier}' with '_' to indicate it is intentionally unreferenced.`,
        },
      ];
    }

    const validation = validateProposedFix({
      filePath,
      fileContent: fullContent,
      originalCode,
      correctedCode,
      diagnostic,
    });

    const isInfo = normSeverity === 'information' || normSeverity === 'hint';
    return {
      analysisSource: 'rules',
      status: correctedCode ? 'fixed' : 'needs_context',
      errorType: isInfo ? 'TS Information' : 'TS Warning',
      category: 'LINT',
      title: `Unused Identifier '${identifier}'`,
      location,
      summary: msg,
      rootCause: `'${identifier}' is declared or passed in, but never read or referenced in its scope.`,
      whyItHappens:
        'Unused variables consume memory and may indicate incomplete implementation or orphaned logic.',
      why: 'The identifier was created but never utilized in any subsequent expression.',
      recommendedAction: `Remove '${identifier}' or prefix with '_' if required by interface signature.`,
      originalCode,
      correctedCode,
      changes,
      explanation: `'${identifier}' is declared but never read. Either use the variable or prefix with underscore.`,
      confidence: 0.9,
      confidenceLevel: 'HIGH',
      verificationStatus: validation.verificationStatus,
      validation,
      cause: `'${identifier}' is declared but its value is never read.`,
      suggestion: `Remove '${identifier}' or prefix it with an underscore.`,
      severity: normSeverity,
    };
  }

  // -----------------------------------------------------------------
  // 3. TypeScript Type Mismatch (e.g. 2322, 2345)
  // -----------------------------------------------------------------
  if (code === '2322' || code === 'TS2322' || code === '2345' || code === 'TS2345' || msg.includes('not assignable to type')) {
    // Dynamically extract assignedType and expectedType from message
    // Format: "Type 'string' is not assignable to type 'number'."
    const typeMatch = msg.match(/Type '([^']+)' is not assignable to type '([^']+)'/i);
    const assignedType = typeMatch ? typeMatch[1] : 'incompatible type';
    const expectedType = typeMatch ? typeMatch[2] : 'declared type';

    // Dynamically extract identifier and assigned value from actual code line
    // E.g.: "let userId: number = "user_42";"
    let varName = 'the variable';
    let assignedVal = assignedType;
    let originalCode = trimmedLine;
    let correctedCode: string | null = null;
    let changes: CodeChange[] = [];

    const declMatch = trimmedLine.match(/(?:let|const|var)\s+([a-zA-Z0-9_$]+)\s*:\s*([a-zA-Z0-9_$<>\[\]\s]+)\s*=\s*(.+);?/);
    if (declMatch) {
      varName = declMatch[1];
      const valPart = declMatch[3].replace(/;$/, '').trim();
      assignedVal = valPart;

      // Update the declared type annotation to match the assigned type
      correctedCode = trimmedLine.replace(
        new RegExp(`:\\s*${expectedType}\\b`),
        `: ${assignedType}`
      );

      if (correctedCode !== trimmedLine) {
        changes = [
          {
            line,
            before: trimmedLine,
            after: correctedCode,
            reason: `Align variable type annotation with assigned ${assignedType} literal.`,
          },
        ];
      } else {
        correctedCode = null;
      }
    } else if (trimmedLine) {
      // General assignment or function return
      const assignMatch = trimmedLine.match(/([a-zA-Z0-9_$]+)\s*=\s*(.+);?/);
      if (assignMatch) {
        varName = assignMatch[1];
        assignedVal = assignMatch[2].replace(/;$/, '').trim();
      }
    }

    const validation = validateProposedFix({
      filePath,
      fileContent: fullContent,
      originalCode,
      correctedCode,
      diagnostic,
    });

    const rootCause = `A value of type '${assignedType}' was assigned to '${varName}', which is typed as '${expectedType}'. ${varName} expects a ${expectedType} but ${assignedVal} is a ${assignedType}.`;
    const cause = `${varName} expects a ${expectedType} but ${assignedVal} is a ${assignedType}. In TypeScript, statically typed variables cannot be assigned values of incompatible types.`;
    const whyItHappens = 'TypeScript enforces compile-time type safety. When a variable declared as one type receives a value of another type, compilation halts.';
    const why = `The type declaration requires '${expectedType}', but the expression evaluates to '${assignedType}'.`;
    const explanation = `A ${assignedType} value was assigned to a variable that was declared as a ${expectedType}. Updating the type to ${assignedType} matches the assigned ${assignedType} literal while maintaining full type safety.`;
    const suggestion = `Change the type or provide a numeric value (e.g., change type to ${assignedType}, or assign a ${expectedType}).`;

    return {
      analysisSource: 'rules',
      status: correctedCode ? 'fixed' : 'needs_context',
      errorType: 'TypeScript Error',
      category: 'TYPE',
      title: 'Type Mismatch',
      location,
      summary: msg,
      rootCause,
      whyItHappens,
      why,
      recommendedAction: suggestion,
      originalCode,
      correctedCode,
      changes,
      explanation,
      confidence: 0.9,
      confidenceLevel: 'HIGH',
      verificationStatus: validation.verificationStatus,
      validation,
      cause,
      suggestion,
      severity: 'error',
    };
  }

  // -----------------------------------------------------------------
  // 4. Undefined / Null Property Access (e.g. 2532, 18048)
  // -----------------------------------------------------------------
  if (code === '2532' || code === 'TS2532' || code === '18048' || code === 'TS18048' || msg.includes('undefined') || msg.includes('null') || msg.includes('cannot read property')) {
    let originalCode = trimmedLine;
    let correctedCode: string | null = null;
    let changes: CodeChange[] = [];

    // Dynamically look for property access (e.g. obj.prop) in the line
    if (trimmedLine) {
      // Find property access to guard with optional chaining
      const propAccessMatch = trimmedLine.match(/([a-zA-Z0-9_$]+)\.([a-zA-Z0-9_$]+)/);
      if (propAccessMatch) {
        const fullExpr = propAccessMatch[0];
        const objName = propAccessMatch[1];
        const propName = propAccessMatch[2];
        const safeExpr = `${objName}?.${propName}`;

        correctedCode = trimmedLine.replace(fullExpr, safeExpr);
        changes = [
          {
            line,
            before: fullExpr,
            after: safeExpr,
            reason: 'Use optional chaining to safely guard against null/undefined.',
          },
        ];
      }
    }

    const validation = validateProposedFix({
      filePath,
      fileContent: fullContent,
      originalCode,
      correctedCode,
      diagnostic,
    });

    return {
      analysisSource: 'rules',
      status: correctedCode ? 'fixed' : 'needs_context',
      errorType: 'TypeError',
      category: 'NULL / UNDEFINED',
      title: 'Possible Undefined / Null Access',
      location,
      summary: msg,
      rootCause:
        'Attempted to access properties or methods on a value that may be null or undefined at runtime.',
      whyItHappens:
        'The variable or expression evaluates to null or undefined, causing property access to throw a TypeError.',
      why: 'Dereferencing a property on null or undefined halts execution with a runtime TypeError.',
      recommendedAction:
        'Verify that the object is defined before property access, or use optional chaining (?.).',
      originalCode,
      correctedCode,
      changes,
      explanation:
        'Attempted to access a property on an object that is or can be undefined/null. Optional chaining (?.) short-circuits evaluation when the target is null or undefined, preventing runtime crashes.',
      confidence: 0.88,
      confidenceLevel: 'HIGH',
      verificationStatus: validation.verificationStatus,
      validation,
      cause: 'Object may be null or undefined before property dereference.',
      suggestion: 'Verify that the object is defined before property access, or use optional chaining (?.).',
      severity: 'error',
    };
  }

  // -----------------------------------------------------------------
  // 5. Undeclared Identifier / ReferenceError (e.g. 2304)
  // -----------------------------------------------------------------
  if (code === '2304' || code === 'TS2304' || msg.includes('Cannot find name') || msg.includes('is not defined')) {
    const identMatch = msg.match(/['"]([^'"]+)['"]/);
    const identifier = identMatch ? identMatch[1] : 'the identifier';

    return {
      analysisSource: 'rules',
      status: 'needs_context',
      errorType: 'ReferenceError',
      category: 'REFERENCE',
      title: 'Undeclared Identifier',
      location,
      summary: msg,
      rootCause: `The identifier '${identifier}' is referenced at line ${line}, but no declaration, parameter, or imported binding exists in this scope.`,
      whyItHappens: `The compiler or runtime cannot resolve '${identifier}'. This happens when an identifier is misspelled, defined in another file without an import, or referenced outside its enclosing lexical scope.`,
      why: `The compiler cannot locate any local variable, parameter, or imported symbol matching '${identifier}'.`,
      recommendedAction: `Check whether '${identifier}' is misspelled or requires being declared or imported before referencing it in this scope.`,
      originalCode: trimmedLine,
      correctedCode: null,
      changes: [],
      explanation: `Check whether '${identifier}' is misspelled or requires being declared or imported before referencing it in this scope.`,
      confidence: 0.88,
      confidenceLevel: 'HIGH',
      verificationStatus: 'NOT_VERIFIED',
      validation: {
        status: 'needs_context',
        message: `Contextual code required — automated fix withheld to avoid invalid assumptions. Verify declaration or import of '${identifier}'.`,
        checkerUsed: 'local_rules',
      },
      cause: `The compiler cannot locate any local variable, parameter, or imported symbol matching '${identifier}'.`,
      suggestion: `Check whether '${identifier}' matches a similar declared variable nearby, or add the required import or declaration.`,
      severity: 'error',
    };
  }

  // -----------------------------------------------------------------
  // 6. Generic / Fallback Diagnostic Analysis
  // -----------------------------------------------------------------
  let severityLabel = 'Error';
  if (normSeverity === 'warning') severityLabel = 'Warning';
  else if (normSeverity === 'information') severityLabel = 'Information';
  else if (normSeverity === 'hint') severityLabel = 'Hint';

  const sourceName = diagnostic.source ? diagnostic.source.toUpperCase() : 'Compiler';
  const rootCause = `Diagnostic code: ${code || 'N/A'}. A ${normSeverity === 'error' ? 'compiler error' : normSeverity === 'warning' ? 'warning' : 'informational suggestion'} was triggered at line ${line}.`;
  const whyItHappens = `${sourceName} flagged a rule violation: ${msg}`;
  const why = `Rule check failed: ${msg}`;
  const suggestion = `Inspect line ${line} in ${filePath} and update code to comply with syntax and type requirements.`;

  return {
    analysisSource: 'rules',
    status: 'needs_context',
    errorType: `${sourceName} ${severityLabel}`,
    category,
    title: `${sourceName} ${severityLabel}`,
    location,
    summary: msg,
    rootCause,
    whyItHappens,
    why,
    recommendedAction: suggestion,
    originalCode: trimmedLine,
    correctedCode: null,
    changes: [],
    explanation: `${sourceName} reported: ${msg}. Inspect line ${line} in ${filePath}.`,
    confidence: 0.6,
    confidenceLevel: 'LOW',
    verificationStatus: 'NOT_VERIFIED',
    validation: {
      status: 'needs_context',
      message: 'More contextual code required for automated fix',
      checkerUsed: 'local_rules',
    },
    cause: `Diagnostic code: ${code || 'N/A'}.`,
    suggestion,
    severity: normSeverity,
  };
}
