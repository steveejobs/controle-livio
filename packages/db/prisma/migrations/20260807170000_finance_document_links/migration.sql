BEGIN;

ALTER TABLE "expenses" ADD COLUMN "client_id" UUID;
ALTER TABLE "documents" ADD COLUMN "contract_id" UUID;
ALTER TABLE "documents" ADD COLUMN "expense_id" UUID;

CREATE INDEX "expenses_organization_id_client_id_idx" ON "expenses"("organization_id", "client_id");
CREATE INDEX "documents_organization_id_contract_id_idx" ON "documents"("organization_id", "contract_id");
CREATE INDEX "documents_organization_id_expense_id_idx" ON "documents"("organization_id", "expense_id");

ALTER TABLE "expenses"
  ADD CONSTRAINT "expenses_client_id_fkey"
  FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "documents"
  ADD CONSTRAINT "documents_contract_id_fkey"
  FOREIGN KEY ("contract_id") REFERENCES "contracts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "documents"
  ADD CONSTRAINT "documents_expense_id_fkey"
  FOREIGN KEY ("expense_id") REFERENCES "expenses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TRIGGER "tenant_expenses_client_id"
  BEFORE INSERT OR UPDATE OF "organization_id", "client_id" ON "expenses"
  FOR EACH ROW EXECUTE FUNCTION public.enforce_same_organization('clients', 'client_id');
CREATE TRIGGER "tenant_documents_contract_id"
  BEFORE INSERT OR UPDATE OF "organization_id", "contract_id" ON "documents"
  FOR EACH ROW EXECUTE FUNCTION public.enforce_same_organization('contracts', 'contract_id');
CREATE TRIGGER "tenant_documents_expense_id"
  BEFORE INSERT OR UPDATE OF "organization_id", "expense_id" ON "documents"
  FOR EACH ROW EXECUTE FUNCTION public.enforce_same_organization('expenses', 'expense_id');

COMMIT;
