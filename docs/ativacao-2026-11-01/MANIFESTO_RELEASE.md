# Manifesto de ativação — 2026-11-01

Candidata: 8ac9dbc35d9246083f66ba80ae72001ebac28e3c

ZIP SHA-256: 7829de5902aba046ff454329bd40cff994682a04760ff50cdc9cfca0670f7730

Comparação byte a byte com git archive da candidata: PASS

## Commits candidatos posteriores ao baseline API declarado

O deployment API tem gitDirty=1; este intervalo Git não reconstrói alterações locais daquele build. A identidade de rollback é o deployment, não um rebuild presumido do SHA.

```text
af20e335cfd26e1de94ecff87ca29b8cbc40fa5b ci: prepare validation branch for heavy checks
7f1f137f6325f339133a56ef7bad10ea4a46f248 ci: skip Vercel deployments for validation branch
326331db1a212652c5b9712ecddf8ff076d082fd fix: embed JPEG logo with contiguous bytes
94bff6509f16db6ee02c33fd984b576e2bcb239b test(web): report mobile overflow elements
384d8a8bd0df25271de4497df17c8db788f53494 test(web): isolate layout overflow diagnostics
b4ae75ad9a575a7bb318497ef1a2e1c5de2a95f1 test(web): report overflow control context
63465ae4e10abe118893a9e37ab399b6481c35c3 fix(web): constrain expense policy select on mobile
a5b7ef548eb1feecbf16f0fcf242dfcd73f24246 ci: exercise integrated Supabase and browser flows
2b379144be2ed818e9fa8fcbb36913d47eabb8cc test: fix integrated browser login selector
b1dbe0906c5f937cf7a8903aec429dc81839b861 test: fix integrated browser auth and navigation
65490502ca00a9dae3179861a4b4f5e5211157d4 fix: type integrated auth cookie parsing
2b2b21de32af5fb697479c2f55f7be46e1c90cf3 test: fix integrated finance and document flows
da4f4464aff1a5b14797fe5034e173ba372b0b64 test: verify persisted payment and portal download
a7f70d9e7905ac291db4035283afd016d2c32ab0 test: scroll to lazy payment list in journey
a404239056c0c2a91c30565112464a2b9194d0d5 test: validate form journeys and synthetic restore for RC
43b0062bf7ba05c449729e6ee620c0da99a85071 test: scope task selectors and normalize staged context
00e6211bf981d3e1855c9df8bf252724f6fbac8c test: update task mocks and preserve implicit restore schema
687ae1416469faebc8bee5cb2786a71b52b80500 test: restore managed schemas with disposable cluster admin
fc97421373220ceea5c1ba568ede8175275ce22c test: exclude scheduler data from restore rehearsal
c943da129d1972f2f6da7321650f0a9c2841677d test: omit scheduler sequence state from restore
8de04ad72ac16778a6213a9ddf1016652c7caeda docs: record RC CI results and remaining office blockers
48842cb0d336a02c1c66b80ff18813d422bee5f4 test: close first-office workflow gaps
2daa023929f6527f536928b6d3606747d3c53575 test: close mobile and CI validation gaps
29e5734d9a68974ef94fdc1a2adf10b2c8b3e87e test: fix integrated navigation and restore rehearsal
4b8b33e9be81e24fd6586563a81ca71e34c57356 fix: finalize finance and integrated QA corrections
77664061392a94fa24906a6eea363d2f4cf17dfc test: diagnose integrated workflows and harden restore
081323eeaf0b969789304893545f1208350cda08 fix(qa): include pg_restore in docker command
f516c691e396e11a764b7e09988485357818b69e test(e2e): fix integrated form harness diagnostics
29f96bc4b72beee14add33973d50bb6737ec4629 test: fix integrated form selectors and restore extensions
792eb0e2735ff0623b4f471d089d32a2818fd71e fix: stabilize client workflows and restore checks
ce2f98428cffe7e7f945ddcad7f249699f1908c2 fix: correct integrated form and restore validation
8be1be1be3865b1e6e2f8808c5a720ba9c926c21 fix: continue integrated checks and validate scanner PDF
6c84625e6281a3be376e07ca93e07c94f19430f9 fix: harden PDF scanning and isolate QA runs
e87f1db9a5e1a3d27e9f41a638959e4a62f754cd test: isolate integrated journeys and harden CI checks
6c1b5d67fd4dd6f2cf1efec9eb4c15ebd36af992 test: verify document scanning and restore ownership
ed2e586f3f31a7ae9f19c2b9d9485fd9115b9da4 feat: add secure financial receipt reading and reconciliation
8f5cd3d93b240703292da81d24a9cdd0d065398a a
fe0c62f61cfde77b4f5f84193b4401148503718c docs: format project context for Quality gate
56cab1e69b7496352f7b3ad67462f1c5b65da834 fix(api): inject PDF inspector explicitly in Nest
95864fa3aaf31f1fc6fbd36d7c63ab0dbca7a0e7 fix(api): normalize upload limit response and classify database errors
c0b24a0d7cc4fd7ca335d38b0e749e4b9d445591 fix(api): retry raw SQL serialization conflicts in receipt confirmation
014d17d60617b4d436b53403c6b71b2d841d3bb4 fix(qa): preserve non-scheduler ACLs in restore list
962ca09d829a0903b1938c5814a7180beb375c96 fix(qa): validate restored role session output and reject CORS origins cleanly
d0e0ae5ecf3d3ef628778352b6508b671e880ccc prepare client handoff with audited auth, documents and receipts
ec34e623e26f464d76d645c0a0d49ad1ee50270b fix(qa): compare restored table privileges to source
b39f7479c247400c59df0351d29b10474ca01159 fix(db): remove unsafe browser table grants
13175e14ac1c544b1c375c84a80c3b4702356991 fix(qa): cast PostgreSQL char catalog fields in restore comparison
76def7725a0c3d338e9d031a9a7b2999fc55ce7b test(qa): capture exact restore structure differences
54e54a3cda209745974d1053da287418dead7ebc fix(qa): compare reparsed CHECK constraints by equivalent casts
3d8b12b66c7e611a5575b58c7441e5b75d48b2a9 fix(qa): recognize accessible error alerts in integrated journeys
c12f9e69a318374bc30e4be84d447574eb14bf14 test(e2e): verify upload size guards at browser and API boundaries
8ac9dbc35d9246083f66ba80ae72001ebac28e3c docs(release): record green end-to-end audit and handoff status
```

## Migrations da candidata e SHA-256

- supabase/migrations/20260807134500_initial_foundation.sql: 6e9e97a6999bd478df33e6ac99f8c060dcfee0461c4f2ce151dc21ffc321284c
- supabase/migrations/20260807170000_finance_document_links.sql: ab98411c755fde63e875a87d053a2b21ca136275a28b339de8ed9ef10c063419
- supabase/migrations/20260807180000_supabase_auth_rls.sql: 7a54fab461e0e6028482365242fd14e4c79e930a49419360666e246e2ff4c5e1
- supabase/migrations/20260809120000_auth_memberships_hardening.sql: b32ed631bd88bc538bbe88a2547aaeea139e61b236ff5f741ce6a7805f7825fd
- supabase/migrations/20260812150000_authenticated_table_grants.sql: e46c286ce1b51259bf1287a3e0a66746673748c57cc3a7cc308ab01e18d17b08
- supabase/migrations/20261021150000_access_alerts_and_payment_change_requests.sql: 43c1252cb69a99e956bfbb286b2d1903007d7203913f781676a6ee6bb522b135
- supabase/migrations/20261021160000_web_push_subscriptions.sql: bf7e3dc0ecc5ebbd4c267c35c2c5b9250e1613d5f1b91f571361cdc485090161
- supabase/migrations/20261021170000_service_catalog.sql: be1388357ae7f57919afe6ecc90dcfeb1351e1c4322c030a2e3d92a05a871c24
- supabase/migrations/20261021180000_calendar_reminder_preferences.sql: b2d282aa5e23bb6f25940ac250643b35cb22dc713c5ef769c2aef809df798f16
- supabase/migrations/20261021190000_shared_api_rate_limits.sql: ece038702193e99d90807273ef8f95cbb1f4ade51db7bb7be20d3ddc1694a3dd
- supabase/migrations/20261021200000_notification_scheduler.sql: dc3ce5b152915d07d2232091fe0193085769337d61c9b7863766209b113b21d1
- supabase/migrations/20261021210000_scheduler_request_claims.sql: 7817e0e16a0a5db1a7d987884e6317e33aff5db4da867eba9130a7ba324b80a8
- supabase/migrations/20261021220000_portal_rls_scope.sql: 8c8221fb0e9831e8c498e6e07feb7c521e46dc1d207bd85634998137294248e4
- supabase/migrations/20261021230000_portal_write_scope.sql: ffbbf190c904da617348716275cf25de3e2ceabf5c5d89e7f9a999fe4187eeb9
- supabase/migrations/20261022200000_client_photos.sql: 376d84d7b05a804c552e46d39db42ed743e49bfae50c8635205d1bb1b157f064
- supabase/migrations/20261022213000_document_signing.sql: f99732cd628aaf33ad0af5e1a9e7f1598f835f68e127bc66413136505be21da9
- supabase/migrations/20261027150000_expense_workflow.sql: 3f94e03d5137ee79a9a45088ab458abcbcb441a2751ad89c4bf60f378d71ea4e
- supabase/migrations/20261031120000_payment_receipts.sql: 0b9b00f435b6e5b56cedaee95894313710b319c58c3e9e048bc4e95ec3f0a19f
- supabase/migrations/20261101100000_restrict_public_table_privileges.sql: 95b1eb42e9d47a3b599e52dc5fcc038ad7858a0a00aed4c2714db1e7ef964f9e

## Diferença de arquivos contra web publicada ba1a9b8

```text
apps/web/app/assinar/[token]/page.tsx              |   12 +
 apps/web/app/auth/confirm/route.ts                 |    8 +-
 apps/web/app/globals.css                           |  395 +++
 apps/web/e2e/administration-reports.e2e.ts         |   32 +-
 apps/web/e2e/all-modules.e2e.ts                    |  286 +-
 apps/web/e2e/client-pagination.e2e.ts              |   13 +-
 apps/web/e2e/client-portal.e2e.ts                  |   10 +-
 apps/web/e2e/client-workspace.e2e.ts               |  262 +-
 apps/web/e2e/deadlines-workflow.e2e.ts             |   11 +-
 apps/web/e2e/finance-payment.e2e.ts                |   14 +-
 .../e2e/integrated/real-browser.integrated.e2e.ts  | 3668 ++++++++++++++++++++
 apps/web/e2e/paginated-lists.e2e.ts                |    4 +-
 apps/web/e2e/password-fields.e2e.ts                |    4 +-
 apps/web/e2e/performance-flows.e2e.ts              |    6 +-
 apps/web/e2e/pwa-install-push.e2e.ts               |    4 +-
 apps/web/e2e/signature-link.e2e.ts                 |   74 +
 apps/web/features/admin/team-management.tsx        |  150 +-
 apps/web/features/app/legal-crm.tsx                |   60 +-
 apps/web/features/audit/audit-log.tsx              |  340 +-
 apps/web/features/clients/client-detail.tsx        |  492 ++-
 apps/web/features/clients/client-management.tsx    |  183 +-
 apps/web/features/clients/client-photo.tsx         |  129 +
 apps/web/features/clients/client.types.ts          |    5 +
 .../features/clients/identification-capture.tsx    |  237 ++
 .../features/clients/identification-reader.test.ts |   38 +
 apps/web/features/clients/identification-reader.ts |  103 +
 .../features/clients/whatsapp-collection.test.ts   |   17 +
 apps/web/features/clients/whatsapp-collection.tsx  |  121 +
 apps/web/features/dashboard/system-health.tsx      |    2 +-
 .../documents/document-template-editor.tsx         |  315 ++
 apps/web/features/documents/documents.tsx          |  503 ++-
 apps/web/features/documents/signing-experience.tsx |  279 ++
 apps/web/features/finance/contract-hearings.tsx    |  150 +
 apps/web/features/finance/contracts.tsx            |   53 +-
 apps/web/features/finance/expense-workflow.test.ts |   33 +
 apps/web/features/finance/expense-workflow.ts      |   19 +
 apps/web/features/finance/finance-operations.tsx   | 1518 ++++++--
 apps/web/features/finance/receipt-capture.tsx      |  464 +++
 apps/web/features/matters/matter-board.tsx         |  176 +-
 .../notifications/notifications-center.tsx         |    8 +-
 .../notifications/push-notification-settings.tsx   |   28 +-
 apps/web/features/portal/client-portal.tsx         |   87 +
 apps/web/features/reports/reports-center.tsx       |   26 +-
 apps/web/features/shared/client-select-field.tsx   |   99 +
 .../features/shared/document-upload-limit.test.ts  |   20 +
 apps/web/features/shared/document-upload-limit.ts  |   11 +
 apps/web/features/shared/use-api-data.ts           |   26 +-
 apps/web/features/shared/use-near-viewport.ts      |   29 +
 apps/web/features/work/calendar.tsx                |   35 +-
 .../web/features/work/hearing-reminder-options.tsx |  102 +
 apps/web/features/work/tasks.tsx                   |   28 +
 apps/web/lib/api.test.ts                           |   25 +
 apps/web/lib/api.ts                                |    9 +-
 apps/web/lib/auth-redirect.test.ts                 |   14 +
 apps/web/lib/auth-redirect.ts                      |   11 +
 apps/web/next.config.ts                            |    3 +-
 apps/web/package.json                              |   11 +-
 apps/web/scripts/copy-ocr-assets.mjs               |   22 +
 apps/web/theme/operations.css                      |  632 +++-
 apps/web/vercel.json                               |    5 +
 apps/web/vitest.config.mts                         |    5 +
 packages/shared/package.json                       |    4 +-
 packages/shared/src/environment.test.ts            |   23 +
 packages/shared/src/environment.ts                 |   24 +-
 packages/shared/src/permissions.ts                 |    5 +
 65 files changed, 10932 insertions(+), 550 deletions(-)
```
