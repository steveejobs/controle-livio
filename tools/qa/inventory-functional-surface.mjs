import { readdirSync, readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import ts from 'typescript';

// Inventory only: never executes application code, opens connections or reads env.
const output = process.argv.find((value) => value.startsWith('--output='))?.slice(9);
if (output && existsSync(output) && !process.argv.includes('--overwrite'))
  throw new Error('Output exists. Use --overwrite explicitly.');
function files(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((item) =>
    item.isDirectory() ? files(join(dir, item.name)) : [join(dir, item.name)],
  );
}
const clean = (value) => value.replace(/\s+/g, ' ').trim();
const rows = [];
for (const file of [
  ...files('apps/web/features'),
  ...files('apps/web/components'),
  ...files('apps/web/app'),
  ...files('apps/api/src'),
]) {
  if (!/\.tsx?$/.test(file) || /\.test\.tsx?$/.test(file)) continue;
  const source = ts.createSourceFile(
    file,
    readFileSync(file, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
  );
  const add = (node, kind, description, details = {}) =>
    rows.push({
      file: relative('.', file).replaceAll('\\', '/'),
      line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1,
      kind,
      description: clean(description),
      ...details,
      verification: 'REQUIRES_REVIEW',
    });
  function visit(node) {
    if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) {
      const opening = ts.isJsxElement(node) ? node.openingElement : node;
      const tag = opening.tagName.getText(source);
      if (
        ['button', 'input', 'select', 'textarea', 'form', 'a', 'option', 'summary'].includes(tag)
      ) {
        const attributes = Object.fromEntries(
          opening.attributes.properties
            .filter(ts.isJsxAttribute)
            .map((attr) => [
              attr.name.getText(source),
              attr.initializer?.getText(source) ?? 'true',
            ]),
        );
        const text = ts.isJsxElement(node)
          ? node.children.map((child) => child.getText(source)).join(' ')
          : '';
        add(
          node,
          `ui:${tag}`,
          attributes['aria-label'] ?? (text.slice(0, 200) || attributes.name || tag),
          {
            attributes,
          },
        );
      }
    }
    if (ts.isCallExpression(node)) {
      const name = node.expression.getText(source);
      if (['api', 'apiBlob'].includes(name))
        add(node, 'web:api', node.arguments[0]?.getText(source) ?? '', {
          options: clean(node.arguments[1]?.getText(source) ?? '{}').slice(0, 500),
        });
      if (['Get', 'Post', 'Patch', 'Put', 'Delete'].includes(name)) {
        const method = node.parent.parent;
        const owner = method.parent;
        const decorators = [method, owner].flatMap((target) =>
          ts.canHaveDecorators(target)
            ? (ts.getDecorators(target) ?? []).map((decorator) => clean(decorator.getText(source)))
            : [],
        );
        add(node, `api:${name.toUpperCase()}`, node.arguments[0]?.getText(source) ?? '/', {
          decorators,
        });
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
}
const tests = files('apps/web/e2e')
  .filter((file) => file.endsWith('.ts'))
  .map((file) => ({
    file: file.replaceAll('\\', '/'),
    titles: [...readFileSync(file, 'utf8').matchAll(/\btest\(\s*(['"`])([^\n]+?)\1/g)].map(
      (m) => m[2],
    ),
  }));
const result = {
  scope: 'Static inventory; presence in source is not execution evidence.',
  rows,
  tests,
};
if (output) {
  mkdirSync(join(output, '..'), { recursive: true });
  writeFileSync(output, `${JSON.stringify(result, null, 2)}\n`);
}
console.log(
  JSON.stringify({
    entries: rows.length,
    testFiles: tests.length,
    byKind: rows.reduce((a, r) => {
      a[r.kind] = (a[r.kind] ?? 0) + 1;
      return a;
    }, {}),
  }),
);
