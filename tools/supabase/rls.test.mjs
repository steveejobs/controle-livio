import { createClient } from '@supabase/supabase-js';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? process.env.SUPABASE_ANON_KEY;
if (!url || !anonKey || !['localhost', '127.0.0.1'].includes(new URL(url).hostname)) {
  throw new Error('Testes RLS exigem URL e anon key da stack Supabase local');
}

const password = 'LocalOnly-ChangeMe-2026!';
const orgA = '10000000-0000-4000-8000-000000000001';
const orgB = '20000000-0000-4000-8000-000000000001';
const clientA = '11000000-0000-4000-8000-000000000001';
const clientB = '21000000-0000-4000-8000-000000000001';

async function signedIn(email) {
  const client = createClient(url, anonKey, { auth: { persistSession: false } });
  const { error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`Login local falhou para ${email}: ${error.message}`);
  return client;
}

function expect(condition, message) {
  if (!condition) throw new Error(`RLS TEST FAILED: ${message}`);
}

async function invisible(client, table, id) {
  const { data, error } = await client.from(table).select('id').eq('id', id);
  expect(!error, `${table}: consulta negativa não deve revelar erro interno`);
  expect(data.length === 0, `${table}: registro de outro tenant ficou visível`);
}

const [adminA, lawyerA, secretaryA, financeA, portalA, adminB] = await Promise.all([
  signedIn('admin.aurora@example.test'),
  signedIn('advogado.aurora@example.test'),
  signedIn('secretaria.aurora@example.test'),
  signedIn('financeiro.aurora@example.test'),
  signedIn('cliente.aurora@example.test'),
  signedIn('admin.horizonte@example.test'),
]);

await invisible(adminA, 'clients', clientB);
await invisible(adminA, 'matters', '24000000-0000-4000-8000-000000000001');
await invisible(adminA, 'receivables', '26000000-0000-4000-8000-000000000001');

const crossInsert = await adminA.from('clients').insert({
  organization_id: orgB,
  type: 'PERSON',
  display_name: 'Tentativa entre tenants',
});
expect(Boolean(crossInsert.error), 'admin A conseguiu inserir usando organization_id B');

const crossUpdate = await adminA
  .from('clients')
  .update({ display_name: 'Alterado indevidamente' })
  .eq('id', clientB)
  .select('id');
expect(!crossUpdate.error && crossUpdate.data.length === 0, 'admin A conseguiu editar cliente B');

const crossDelete = await adminA.from('clients').delete().eq('id', clientB).select('id');
expect(!crossDelete.error && crossDelete.data.length === 0, 'admin A conseguiu excluir cliente B');

const adminMemberships = await adminA.from('organization_members').select('id');
expect(
  !adminMemberships.error && adminMemberships.data.length >= 5,
  'admin não acessou memberships',
);

const lawyerAdmin = await lawyerA.from('organization_members').select('id');
expect(!lawyerAdmin.error && lawyerAdmin.data.length === 1, 'advogado acessou memberships alheias');

const secretaryPayments = await secretaryA.from('payments').select('id');
expect(
  !secretaryPayments.error && secretaryPayments.data.length === 0,
  'secretaria recebeu acesso financeiro proibido',
);

const financeReceivables = await financeA.from('receivables').select('id');
expect(
  !financeReceivables.error && financeReceivables.data.length >= 1,
  'financeiro sem leitura financeira',
);

const financeMemberships = await financeA.from('organization_members').select('id');
expect(
  !financeMemberships.error && financeMemberships.data.length === 1,
  'financeiro acessou administração de usuários',
);

const portalMatters = await portalA.from('matters').select('client_id');
expect(
  !portalMatters.error && portalMatters.data.every((row) => row.client_id === clientA),
  'cliente portal visualizou processo de outro cliente',
);
const portalNotes = await portalA.from('internal_notes').select('id');
expect(
  !portalNotes.error && portalNotes.data.length === 0,
  'cliente portal visualizou nota interna',
);

const objectPath = `organizations/${orgA}/documents/rls-test/proof.txt`;
const uploadA = await lawyerA.storage
  .from('legal-documents')
  .upload(objectPath, new Blob(['conteudo ficticio']), {
    contentType: 'text/plain',
    upsert: false,
  });
expect(!uploadA.error, `upload autorizado falhou: ${uploadA.error?.message ?? ''}`);

const uploadCross = await adminB.storage
  .from('legal-documents')
  .upload(`organizations/${orgA}/documents/rls-test/cross.txt`, new Blob(['negado']), {
    contentType: 'text/plain',
    upsert: false,
  });
expect(Boolean(uploadCross.error), 'organização B fez upload no path da organização A');

const documentId = crypto.randomUUID();
const versionId = crypto.randomUUID();
const documentInsert = await lawyerA.from('documents').insert({
  id: documentId,
  organization_id: orgA,
  client_id: clientA,
  title: 'Documento ficticio de teste RLS',
  status: 'ACTIVE',
  visibility: 'CLIENT',
  current_version: 1,
  created_by_id: 'a1000000-0000-4000-8000-000000000002',
});
expect(
  !documentInsert.error,
  `metadata de documento falhou: ${documentInsert.error?.message ?? ''}`,
);
const versionInsert = await lawyerA.from('document_versions').insert({
  id: versionId,
  organization_id: orgA,
  document_id: documentId,
  version: 1,
  storage_key: objectPath,
  file_name: 'proof.txt',
  mime_type: 'text/plain',
  size_bytes: 18,
  sha256: '0'.repeat(64),
  uploaded_by_id: 'a1000000-0000-4000-8000-000000000002',
});
expect(!versionInsert.error, `metadata de versão falhou: ${versionInsert.error?.message ?? ''}`);

const ownSignedUrl = await lawyerA.storage.from('legal-documents').createSignedUrl(objectPath, 60);
expect(
  !ownSignedUrl.error && Boolean(ownSignedUrl.data.signedUrl),
  'usuário A não gerou URL autorizada',
);
const crossSignedUrl = await adminB.storage.from('legal-documents').createSignedUrl(objectPath, 60);
expect(Boolean(crossSignedUrl.error), 'usuário B gerou download do documento A');

console.log('RLS, roles, internal notes and Storage isolation tests passed.');
