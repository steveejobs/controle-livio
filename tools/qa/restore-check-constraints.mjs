// pg_dump/pg_restore can move an unbounded varchar->text cast from an array
// to its literal elements. Only reviewed constraints and these exact casts
// qualify. No collation, typmod, operator, literal or boolean logic is removed.
const reviewed = new Set([
  'document_signing_requests:document_signing_requests_status_check',
  'payment_receipts:payment_receipts_status_check',
  'service_catalog_items:service_catalog_items_area_check',
  'storage_recovery_incidents:storage_recovery_incidents_resolution_check',
  'storage_recovery_incidents:storage_recovery_incidents_state_check',
  'storage_upload_intents:storage_upload_intents_bucket_check',
  'storage_upload_intents:storage_upload_intents_check',
  'storage_upload_intents:storage_upload_intents_check1',
  'storage_upload_intents:storage_upload_intents_check2',
  'storage_upload_intents:storage_upload_intents_purpose_check',
  'storage_upload_intents:storage_upload_intents_resource_type_check',
  'storage_upload_intents:storage_upload_intents_state_check',
]);

export function canonicalCheck(schema, table, name, expression) {
  if (schema !== 'public' || !reviewed.has(table + ':' + name)) return expression;
  const literal = "'(?:[^']|'')*'";
  const source = new RegExp(
    `ARRAY\\[(${literal}::character varying(?:, ${literal}::character varying)*)\\]::text\\[\\]`,
    'g',
  );
  const restored = new RegExp(
    `ARRAY\\[(${literal}::character varying::text(?:, ${literal}::character varying::text)*)\\]`,
    'g',
  );
  const outsideQuotedText = (text, offset) => {
    let quote = null;
    for (let i = 0; i < offset; i++) {
      if (quote && text[i] === quote && text[i + 1] === quote) i++;
      else if (text[i] === quote) quote = null;
      else if (!quote && (text[i] === "'" || text[i] === '"')) quote = text[i];
    }
    return quote === null;
  };
  return expression
    .replace(source, (match, values, offset, text) =>
      outsideQuotedText(text, offset)
        ? 'ARRAY[' +
          values.replace(new RegExp(`(${literal})::character varying`, 'g'), '$1::text') +
          ']'
        : match,
    )
    .replace(restored, (match, values, offset, text) =>
      outsideQuotedText(text, offset)
        ? 'ARRAY[' +
          values.replace(new RegExp(`(${literal})::character varying::text`, 'g'), '$1::text') +
          ']'
        : match,
    );
}

export function canonicalStructureEntry(entry) {
  const match = /^CONSTRAINT:([^:]+):([^:]+):([\s\S]*)$/.exec(entry);
  return match
    ? `CONSTRAINT:${match[1]}:${match[2]}:${canonicalCheck('public', match[1], match[2], match[3])}`
    : entry;
}

// Inspected under a fixed search_path. Dependency identities use names rather
// than cluster-specific OIDs. Keep validation/inheritance/column metadata exact.
export const checkCatalogQuery = `SET search_path = pg_catalog, public;
SELECT coalesce(json_agg(q ORDER BY q.schema,q.table,q.name),'[]')::text FROM (
 SELECT n.nspname AS schema,c.relname AS table,k.conname AS name,k.contype AS type,
 pg_get_userbyid(c.relowner) AS table_owner,
 pg_get_constraintdef(k.oid,true) AS definition,
 pg_get_expr(k.conbin,k.conrelid,true) AS expression,
 k.convalidated AS validated,k.conislocal AS local,k.coninhcount AS inherited_count,
 k.connoinherit AS no_inherit,k.condeferrable AS deferrable,k.condeferred AS deferred,
 (SELECT coalesce(json_agg(a.attname ORDER BY u.ordinality),'[]') FROM unnest(k.conkey) WITH ORDINALITY u(num,ordinality)
 JOIN pg_attribute a ON a.attrelid=k.conrelid AND a.attnum=u.num) AS columns,
 (SELECT coalesce(json_agg(d ORDER BY d.kind,d.identity),'[]') FROM (
 SELECT dep.deptype AS kind,pg_describe_object(dep.refclassid,dep.refobjid,dep.refobjsubid) AS identity
 FROM pg_depend dep WHERE dep.classid='pg_constraint'::regclass AND dep.objid=k.oid) d) AS dependencies,
 current_setting('search_path') AS inspection_search_path
 FROM pg_constraint k JOIN pg_class c ON c.oid=k.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname='public' AND k.contype='c'
) q;`;

export function canonicalCheckCatalog(rows) {
  return rows.map((row) => ({
    ...row,
    definition: canonicalCheck(row.schema, row.table, row.name, row.definition),
    expression: canonicalCheck(row.schema, row.table, row.name, row.expression),
  }));
}
