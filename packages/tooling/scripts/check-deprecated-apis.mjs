import process from "node:process";

import ts from "typescript";

const configPaths = process.argv.slice(2);
if (configPaths.length === 0) {
  console.error("Pass at least one tsconfig path.");
  process.exitCode = 2;
} else {
  const diagnostics = configPaths.flatMap(checkProject);
  if (diagnostics.length > 0) {
    console.error(diagnostics.toSorted().join("\n"));
    console.error(`Found ${diagnostics.length} deprecated API use(s).`);
    process.exitCode = 1;
  }
}

/**
 * Checks resolved call signatures as well as non-call symbol references.
 * Looking only at a symbol's combined JSDoc tags is incorrect for overloads:
 * one legacy overload can be deprecated while the selected overload is current.
 */
function checkProject(configPath) {
  const config = ts.readConfigFile(configPath, ts.sys.readFile);
  if (config.error) {
    throw new Error(ts.flattenDiagnosticMessageText(config.error.messageText, "\n"));
  }
  const parsed = ts.parseJsonConfigFileContent(
    config.config,
    ts.sys,
    ts.getDirectoryPath(configPath),
  );
  const program = ts.createProgram(parsed.fileNames, parsed.options);
  const checker = program.getTypeChecker();
  const findings = [];
  const callTargets = new WeakSet();

  for (const sourceFile of program.getSourceFiles()) {
    if (sourceFile.isDeclarationFile || !parsed.fileNames.includes(sourceFile.fileName)) continue;
    visit(sourceFile);
  }
  return findings;

  function visit(node) {
    if (ts.isCallExpression(node) || ts.isNewExpression(node)) {
      markIdentifiers(node.expression, callTargets);
      const signature = checker.getResolvedSignature(node);
      if (signature?.getJsDocTags().some(({ name }) => name === "deprecated")) {
        report(node.expression);
      }
    } else if (ts.isIdentifier(node) && !callTargets.has(node) && isReference(node)) {
      let symbol = checker.getSymbolAtLocation(node);
      if (symbol && (symbol.flags & ts.SymbolFlags.Alias) !== 0) {
        symbol = checker.getAliasedSymbol(symbol);
      }
      const declarations = symbol?.declarations ?? [];
      if (
        declarations.length > 0 &&
        declarations.every((declaration) => ts.getJSDocDeprecatedTag(declaration) !== undefined)
      ) {
        report(node);
      }
    }
    ts.forEachChild(node, visit);
  }

  function report(node) {
    const position = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
    findings.push(
      `${sourceFile.fileName}:${position.line + 1}:${position.character + 1} uses a deprecated API`,
    );
  }
}

function markIdentifiers(node, targets) {
  if (ts.isIdentifier(node)) targets.add(node);
  ts.forEachChild(node, (child) => markIdentifiers(child, targets));
}

function isReference(node) {
  const { parent } = node;
  if (
    (ts.isImportSpecifier(parent) ||
      ts.isImportClause(parent) ||
      ts.isNamespaceImport(parent) ||
      ts.isBindingElement(parent) ||
      ts.isVariableDeclaration(parent) ||
      ts.isFunctionDeclaration(parent) ||
      ts.isClassDeclaration(parent) ||
      ts.isInterfaceDeclaration(parent) ||
      ts.isTypeAliasDeclaration(parent) ||
      ts.isPropertyDeclaration(parent) ||
      ts.isMethodDeclaration(parent) ||
      ts.isParameter(parent)) &&
    parent.name === node
  ) {
    return false;
  }
  return !(ts.isPropertyAccessExpression(parent) && parent.name !== node);
}
