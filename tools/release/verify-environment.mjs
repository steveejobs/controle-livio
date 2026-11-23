import { parseApiEnvironment } from '@livio/shared';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export function verifyProductionEnvironment(values) {
  const issues = [];
  if (values.NODE_ENV !== 'production')
    issues.push({ path: ['NODE_ENV'], code: 'production_required' });
  if (!['staging', 'production'].includes(values.SUPABASE_ENVIRONMENT))
    issues.push({ path: ['SUPABASE_ENVIRONMENT'], code: 'hosted_environment_required' });
  if (![false, 'false'].includes(values.SUPABASE_LOCAL))
    issues.push({ path: ['SUPABASE_LOCAL'], code: 'remote_environment_required' });
  try {
    parseApiEnvironment(values);
  } catch (error) {
    // Never serialize the original error/config: URLs and validation inputs can contain secrets.
    issues.push(
      ...(error.issues?.map(({ path, code }) => ({ path, code })) ?? [
        { path: [], code: 'invalid_configuration' },
      ]),
    );
  }
  return { result: issues.length ? 'FAIL' : 'PASS', issues };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const result = verifyProductionEnvironment(process.env);
  console.log(JSON.stringify(result));
  if (result.result !== 'PASS') process.exitCode = 1;
}
