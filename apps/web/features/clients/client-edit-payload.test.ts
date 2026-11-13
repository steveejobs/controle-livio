import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { expect, it } from 'vitest';

it('sends explicit clearing, the reviewed version and preserves unexposed stored qualification', () => {
  const source = readFileSync(new URL('./client-detail.tsx', import.meta.url), 'utf8');
  const ast = ts.createSourceFile(
    'client-detail.tsx',
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  let initializer: string | undefined;
  const visit = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === 'edit')
      initializer = node.initializer!.getText(ast);
    ts.forEachChild(node, visit);
  };
  visit(ast);
  expect(initializer).toBeTruthy();
  const js = ts.transpileModule('exports.edit=' + initializer, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  let payload: Record<string, unknown> | undefined;
  const context = {
    exports: {} as { edit?: (event: unknown) => void },
    FormData: class {
      get(name: string) {
        return (
          (
            {
              displayName: 'Synthetic approved edit',
              'legalIdentity.identityDocument': '1234567',
            } as Record<string, string>
          )[name] ?? ''
        );
      }
    },
    run: (action: () => unknown) => {
      action();
      return Promise.resolve(false);
    },
    api: (_path: string, init: { body: string }) => {
      payload = JSON.parse(init.body);
    },
    data: { client: { type: 'PERSON', address: {}, updatedAt: '2026-11-10T12:00:00.000Z' } },
    customFields: { preserved: 'synthetic-extension' },
    legalIdentity: { externalRegistration: 'KEEP_SYNTHETIC_REGISTRATION' },
    legalRepresentative: {},
    clientId: 'synthetic-client',
    onboardingStep: null,
    moveToOnboardingStep: () => undefined,
  };
  new Function(...Object.keys(context), js)(...Object.values(context));
  context.exports.edit!({ preventDefault: () => undefined, currentTarget: {} });
  expect(payload).toMatchObject({
    email: '',
    phone: '',
    source: '',
    expectedUpdatedAt: '2026-11-10T12:00:00.000Z',
    customFields: {
      preserved: 'synthetic-extension',
      legalIdentity: {
        identityDocument: '1234567',
        externalRegistration: 'KEEP_SYNTHETIC_REGISTRATION',
      },
    },
  });
});
