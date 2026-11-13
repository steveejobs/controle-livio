import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
export const recoveryRestoreInventory = JSON.parse(
  readFileSync(new URL('./restore-inventory.json', import.meta.url), 'utf8'),
);
export function assertRecoveryArchive(entries) {
  const names = entries
    .filter(
      (entry) =>
        entry?.description === 'ACL' &&
        entry.namespace === 'public' &&
        /^(TABLE storage_(?:recovery_|upload_intents)|FUNCTION storage_recovery_)/.test(entry.name),
    )
    .map((entry) => entry.name)
    .sort();
  assert.deepEqual(
    names,
    recoveryRestoreInventory.aclNames,
    'Recovery ACL entries must match the reviewed object names exactly',
  );
  return names.length;
}
export function assertRecoveryOwners(records) {
  const names = records
    .map((entry) => entry.slice(0, entry.lastIndexOf(':')))
    .filter((name) =>
      /^(RELATION:public\.storage_(?:recovery_|upload_intents)|TYPE:public\._?storage_(?:recovery_|upload_intents)|ROUTINE:public\.storage_recovery_)/.test(
        name,
      ),
    )
    .sort();
  assert.deepEqual(
    names,
    recoveryRestoreInventory.owners,
    'Recovery owner inventory differs from the reviewed objects',
  );
}
