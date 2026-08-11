-- Atomic initial deployment: PostgreSQL rolls the complete migration back on any failure.
BEGIN;

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "OrganizationStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('INVITED', 'ACTIVE', 'SUSPENDED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "ClientType" AS ENUM ('PERSON', 'COMPANY');

-- CreateEnum
CREATE TYPE "MatterStatus" AS ENUM ('LEAD', 'ACTIVE', 'SUSPENDED', 'CLOSED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "MatterPriority" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'URGENT');

-- CreateEnum
CREATE TYPE "PipelineKind" AS ENUM ('COMMERCIAL', 'LEGAL', 'COLLECTION');

-- CreateEnum
CREATE TYPE "ContractStatus" AS ENUM ('DRAFT', 'PENDING_APPROVAL', 'ACTIVE', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ReceivableStatus" AS ENUM ('DRAFT', 'OPEN', 'PARTIALLY_PAID', 'PAID', 'OVERDUE', 'CANCELLED', 'WRITTEN_OFF');

-- CreateEnum
CREATE TYPE "InstallmentStatus" AS ENUM ('OPEN', 'PARTIALLY_PAID', 'PAID', 'OVERDUE', 'CANCELLED', 'RENEGOTIATED');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('PENDING', 'CONFIRMED', 'REVERSED', 'FAILED');

-- CreateEnum
CREATE TYPE "AdjustmentKind" AS ENUM ('DISCOUNT', 'INTEREST', 'PENALTY', 'CORRECTION', 'REVERSAL', 'OTHER');

-- CreateEnum
CREATE TYPE "ExpenseStatus" AS ENUM ('DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'PAID', 'CANCELLED');

-- CreateEnum
CREATE TYPE "DocumentStatus" AS ENUM ('DRAFT', 'ACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "DocumentVisibility" AS ENUM ('INTERNAL', 'CLIENT');

-- CreateEnum
CREATE TYPE "TaskStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'BLOCKED', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "TaskPriority" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'URGENT');

-- CreateEnum
CREATE TYPE "EventStatus" AS ENUM ('SCHEDULED', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "EventType" AS ENUM ('HEARING', 'MEETING', 'LEGAL_DEADLINE', 'APPOINTMENT', 'OTHER');

-- CreateEnum
CREATE TYPE "ReminderStatus" AS ENUM ('PENDING', 'SENT', 'CANCELLED', 'FAILED');

-- CreateEnum
CREATE TYPE "RenegotiationStatus" AS ENUM ('DRAFT', 'APPROVED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "NotificationChannel" AS ENUM ('IN_APP', 'EMAIL');

-- CreateEnum
CREATE TYPE "NotificationStatus" AS ENUM ('PENDING', 'SENT', 'READ', 'FAILED');

-- CreateEnum
CREATE TYPE "AuditAction" AS ENUM ('CREATE', 'VIEW', 'UPDATE', 'DELETE', 'EXPORT', 'APPROVE', 'LOGIN', 'LOGOUT', 'LOGIN_FAILED', 'PASSWORD_RESET_REQUESTED', 'PASSWORD_RESET_COMPLETED', 'SESSION_REVOKED', 'REVERSE', 'CANCEL', 'MOVE');

-- CreateTable
CREATE TABLE "organizations" (
    "id" UUID NOT NULL,
    "legal_name" TEXT NOT NULL,
    "slug" VARCHAR(80) NOT NULL,
    "trade_name" TEXT,
    "tax_id" TEXT,
    "status" "OrganizationStatus" NOT NULL DEFAULT 'ACTIVE',
    "timezone" TEXT NOT NULL DEFAULT 'America/Sao_Paulo',
    "settings" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "organizations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "client_id" UUID,
    "email" VARCHAR(320) NOT NULL,
    "password_hash" TEXT NOT NULL,
    "full_name" TEXT NOT NULL,
    "status" "UserStatus" NOT NULL DEFAULT 'INVITED',
    "last_login_at" TIMESTAMPTZ(3),
    "password_changed_at" TIMESTAMPTZ(3),
    "failed_login_attempts" INTEGER NOT NULL DEFAULT 0,
    "locked_until" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "roles" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "key" VARCHAR(80) NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "is_system" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "permissions" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "resource" VARCHAR(80) NOT NULL,
    "action" VARCHAR(40) NOT NULL,
    "description" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "permissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_roles" (
    "organization_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "role_id" UUID NOT NULL,
    "assigned_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "assigned_by_id" UUID,

    CONSTRAINT "user_roles_pkey" PRIMARY KEY ("organization_id","user_id","role_id")
);

-- CreateTable
CREATE TABLE "role_permissions" (
    "organization_id" UUID NOT NULL,
    "role_id" UUID NOT NULL,
    "permission_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "role_permissions_pkey" PRIMARY KEY ("organization_id","role_id","permission_id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "token_hash" CHAR(64) NOT NULL,
    "csrf_token_hash" CHAR(64) NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "revoked_at" TIMESTAMPTZ(3),
    "last_seen_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ip_hash" TEXT,
    "user_agent" VARCHAR(500),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "password_reset_tokens" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "token_hash" CHAR(64) NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "used_at" TIMESTAMPTZ(3),
    "requested_ip_hash" CHAR(64),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "password_reset_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "clients" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "type" "ClientType" NOT NULL,
    "display_name" TEXT NOT NULL,
    "legal_name" TEXT,
    "tax_id_normalized" VARCHAR(14),
    "email" VARCHAR(320),
    "phone" VARCHAR(40),
    "address" JSONB,
    "source" VARCHAR(120),
    "custom_fields" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "clients_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "client_contacts" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "client_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "role" VARCHAR(120),
    "email" VARCHAR(320),
    "phone" VARCHAR(40),
    "is_primary" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "client_contacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pipelines" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "PipelineKind" NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "pipelines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pipeline_stages" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "pipeline_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "color" VARCHAR(20),
    "is_terminal" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "pipeline_stages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "matters" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "client_id" UUID NOT NULL,
    "pipeline_id" UUID,
    "current_stage_id" UUID,
    "responsible_lawyer_id" UUID,
    "responsible_secretary_id" UUID,
    "reference" VARCHAR(80) NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "court_number_normalized" VARCHAR(40),
    "area" VARCHAR(120),
    "status" "MatterStatus" NOT NULL DEFAULT 'LEAD',
    "priority" "MatterPriority" NOT NULL DEFAULT 'MEDIUM',
    "next_action" TEXT,
    "next_action_at" TIMESTAMPTZ(3),
    "labels" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "lost_reason" TEXT,
    "confidential" BOOLEAN NOT NULL DEFAULT false,
    "opened_at" DATE,
    "closed_at" DATE,
    "custom_fields" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "matters_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "matter_parties" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "matter_id" UUID NOT NULL,
    "client_id" UUID,
    "name" TEXT NOT NULL,
    "tax_id_normalized" VARCHAR(14),
    "party_role" VARCHAR(120) NOT NULL,
    "side" VARCHAR(80),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "matter_parties_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "matter_stage_history" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "matter_id" UUID NOT NULL,
    "from_stage_id" UUID,
    "to_stage_id" UUID NOT NULL,
    "moved_by_id" UUID NOT NULL,
    "reason" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "moved_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "matter_stage_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contracts" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "client_id" UUID NOT NULL,
    "matter_id" UUID,
    "number" VARCHAR(80) NOT NULL,
    "title" TEXT NOT NULL,
    "status" "ContractStatus" NOT NULL DEFAULT 'DRAFT',
    "fee_model" VARCHAR(80) NOT NULL,
    "service_code" VARCHAR(80),
    "service_name" VARCHAR(160),
    "fixed_amount" DECIMAL(19,4),
    "success_rate" DECIMAL(9,6),
    "currency" CHAR(3) NOT NULL DEFAULT 'BRL',
    "starts_at" DATE,
    "ends_at" DATE,
    "approved_by_id" UUID,
    "approved_at" TIMESTAMPTZ(3),
    "terms" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "contracts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "receivables" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "client_id" UUID NOT NULL,
    "matter_id" UUID,
    "contract_id" UUID,
    "reference" VARCHAR(80) NOT NULL,
    "description" TEXT NOT NULL,
    "status" "ReceivableStatus" NOT NULL DEFAULT 'DRAFT',
    "original_amount" DECIMAL(19,4) NOT NULL,
    "currency" CHAR(3) NOT NULL DEFAULT 'BRL',
    "issue_date" DATE NOT NULL,
    "competence_date" DATE,
    "due_date" DATE NOT NULL,
    "cancelled_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "receivables_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "receivable_installments" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "receivable_id" UUID NOT NULL,
    "sequence" INTEGER NOT NULL,
    "status" "InstallmentStatus" NOT NULL DEFAULT 'OPEN',
    "amount" DECIMAL(19,4) NOT NULL,
    "currency" CHAR(3) NOT NULL DEFAULT 'BRL',
    "due_date" DATE NOT NULL,
    "competence_date" DATE,
    "version" INTEGER NOT NULL DEFAULT 1,
    "cancelled_at" TIMESTAMPTZ(3),
    "cancellation_reason" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "receivable_installments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payments" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "client_id" UUID NOT NULL,
    "reference" VARCHAR(100) NOT NULL,
    "status" "PaymentStatus" NOT NULL DEFAULT 'PENDING',
    "amount" DECIMAL(19,4) NOT NULL,
    "currency" CHAR(3) NOT NULL DEFAULT 'BRL',
    "paid_at" TIMESTAMPTZ(3) NOT NULL,
    "method" VARCHAR(80) NOT NULL,
    "external_id" VARCHAR(160),
    "idempotency_key" VARCHAR(160) NOT NULL,
    "idempotency_hash" CHAR(64) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "confirmed_by_id" UUID,
    "confirmed_at" TIMESTAMPTZ(3),
    "reversed_at" TIMESTAMPTZ(3),
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_reversals" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "original_payment_id" UUID NOT NULL,
    "amount" DECIMAL(19,4) NOT NULL,
    "reason" TEXT NOT NULL,
    "reversed_by_id" UUID NOT NULL,
    "reversed_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_reversals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_allocations" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "payment_id" UUID NOT NULL,
    "installment_id" UUID NOT NULL,
    "amount" DECIMAL(19,4) NOT NULL,
    "allocated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by_id" UUID NOT NULL,
    "reversed_at" TIMESTAMPTZ(3),
    "reversed_by_id" UUID,

    CONSTRAINT "payment_allocations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "financial_adjustments" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "installment_id" UUID,
    "payment_id" UUID,
    "kind" "AdjustmentKind" NOT NULL,
    "amount" DECIMAL(19,4) NOT NULL,
    "reason" TEXT NOT NULL,
    "effective_at" DATE NOT NULL,
    "approved_by_id" UUID,
    "approved_at" TIMESTAMPTZ(3),
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "financial_adjustments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "renegotiations" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "original_receivable_id" UUID NOT NULL,
    "resulting_receivable_id" UUID,
    "status" "RenegotiationStatus" NOT NULL DEFAULT 'DRAFT',
    "reason" TEXT NOT NULL,
    "created_by_id" UUID NOT NULL,
    "approved_by_id" UUID,
    "approved_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "renegotiations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "expenses" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "matter_id" UUID,
    "description" TEXT NOT NULL,
    "category" VARCHAR(100) NOT NULL,
    "status" "ExpenseStatus" NOT NULL DEFAULT 'DRAFT',
    "amount" DECIMAL(19,4) NOT NULL,
    "currency" CHAR(3) NOT NULL DEFAULT 'BRL',
    "incurred_at" DATE NOT NULL,
    "due_date" DATE,
    "paid_at" DATE,
    "reimbursable" BOOLEAN NOT NULL DEFAULT false,
    "approved_by_id" UUID,
    "approved_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "expenses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "documents" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "client_id" UUID,
    "matter_id" UUID,
    "installment_id" UUID,
    "payment_id" UUID,
    "title" TEXT NOT NULL,
    "category" VARCHAR(120),
    "status" "DocumentStatus" NOT NULL DEFAULT 'DRAFT',
    "visibility" "DocumentVisibility" NOT NULL DEFAULT 'INTERNAL',
    "confidential" BOOLEAN NOT NULL DEFAULT true,
    "current_version" INTEGER NOT NULL DEFAULT 1,
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document_versions" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "document_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "storage_key" TEXT NOT NULL,
    "file_name" TEXT NOT NULL,
    "mime_type" VARCHAR(160) NOT NULL,
    "size_bytes" BIGINT NOT NULL,
    "sha256" CHAR(64) NOT NULL,
    "uploaded_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "document_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "internal_notes" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "client_id" UUID,
    "matter_id" UUID,
    "body" TEXT NOT NULL,
    "confidential" BOOLEAN NOT NULL DEFAULT true,
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "internal_notes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "client_messages" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "client_id" UUID NOT NULL,
    "matter_id" UUID,
    "body" TEXT NOT NULL,
    "published_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by_id" UUID NOT NULL,
    "edited_at" TIMESTAMPTZ(3),
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "client_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tasks" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "client_id" UUID,
    "matter_id" UUID,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "status" "TaskStatus" NOT NULL DEFAULT 'OPEN',
    "priority" "TaskPriority" NOT NULL DEFAULT 'MEDIUM',
    "assignee_id" UUID,
    "created_by_id" UUID NOT NULL,
    "due_at" TIMESTAMPTZ(3),
    "completed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "task_comments" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "task_id" UUID NOT NULL,
    "body" TEXT NOT NULL,
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "edited_at" TIMESTAMPTZ(3),

    CONSTRAINT "task_comments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "task_reminders" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "task_id" UUID NOT NULL,
    "remind_at" TIMESTAMPTZ(3) NOT NULL,
    "status" "ReminderStatus" NOT NULL DEFAULT 'PENDING',
    "sent_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "task_reminders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "task_history" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "task_id" UUID NOT NULL,
    "actor_user_id" UUID NOT NULL,
    "action" VARCHAR(80) NOT NULL,
    "before" JSONB,
    "after" JSONB,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "task_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "calendar_events" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "client_id" UUID,
    "matter_id" UUID,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "location" TEXT,
    "status" "EventStatus" NOT NULL DEFAULT 'SCHEDULED',
    "type" "EventType" NOT NULL DEFAULT 'OTHER',
    "starts_at" TIMESTAMPTZ(3) NOT NULL,
    "ends_at" TIMESTAMPTZ(3) NOT NULL,
    "timezone" TEXT NOT NULL DEFAULT 'America/Sao_Paulo',
    "all_day" BOOLEAN NOT NULL DEFAULT false,
    "attendees" JSONB NOT NULL DEFAULT '[]',
    "recurrence_rule" VARCHAR(500),
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "calendar_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "channel" "NotificationChannel" NOT NULL,
    "status" "NotificationStatus" NOT NULL DEFAULT 'PENDING',
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "link" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "scheduled_at" TIMESTAMPTZ(3),
    "sent_at" TIMESTAMPTZ(3),
    "read_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "actor_user_id" UUID,
    "actor_session_id" UUID,
    "action" "AuditAction" NOT NULL,
    "resource" VARCHAR(100) NOT NULL,
    "resource_id" UUID,
    "request_id" VARCHAR(100),
    "ip_hash" TEXT,
    "user_agent" VARCHAR(500),
    "before" JSONB,
    "after" JSONB,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "activity_events" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "actor_user_id" UUID,
    "type" VARCHAR(100) NOT NULL,
    "subject_type" VARCHAR(100) NOT NULL,
    "subject_id" UUID NOT NULL,
    "summary" TEXT NOT NULL,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "occurred_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "activity_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "organizations_slug_key" ON "organizations"("slug");

-- CreateIndex
CREATE INDEX "users_organization_id_status_idx" ON "users"("organization_id", "status");

-- CreateIndex
CREATE INDEX "users_organization_id_client_id_idx" ON "users"("organization_id", "client_id");

-- CreateIndex
CREATE UNIQUE INDEX "users_organization_id_email_key" ON "users"("organization_id", "email");

-- CreateIndex
CREATE INDEX "roles_organization_id_idx" ON "roles"("organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "roles_organization_id_key_key" ON "roles"("organization_id", "key");

-- CreateIndex
CREATE INDEX "permissions_organization_id_idx" ON "permissions"("organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "permissions_organization_id_resource_action_key" ON "permissions"("organization_id", "resource", "action");

-- CreateIndex
CREATE INDEX "user_roles_organization_id_role_id_idx" ON "user_roles"("organization_id", "role_id");

-- CreateIndex
CREATE INDEX "role_permissions_organization_id_permission_id_idx" ON "role_permissions"("organization_id", "permission_id");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_token_hash_key" ON "sessions"("token_hash");

-- CreateIndex
CREATE INDEX "sessions_organization_id_user_id_expires_at_idx" ON "sessions"("organization_id", "user_id", "expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "password_reset_tokens_token_hash_key" ON "password_reset_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "password_reset_tokens_organization_id_user_id_expires_at_idx" ON "password_reset_tokens"("organization_id", "user_id", "expires_at");

-- CreateIndex
CREATE INDEX "clients_organization_id_display_name_idx" ON "clients"("organization_id", "display_name");

-- CreateIndex
CREATE INDEX "clients_organization_id_deleted_at_idx" ON "clients"("organization_id", "deleted_at");

-- CreateIndex
CREATE UNIQUE INDEX "clients_organization_id_tax_id_normalized_key" ON "clients"("organization_id", "tax_id_normalized");

-- CreateIndex
CREATE INDEX "client_contacts_organization_id_client_id_idx" ON "client_contacts"("organization_id", "client_id");

-- CreateIndex
CREATE INDEX "pipelines_organization_id_is_active_idx" ON "pipelines"("organization_id", "is_active");

-- CreateIndex
CREATE UNIQUE INDEX "pipelines_organization_id_kind_name_key" ON "pipelines"("organization_id", "kind", "name");

-- CreateIndex
CREATE INDEX "pipeline_stages_organization_id_pipeline_id_is_active_idx" ON "pipeline_stages"("organization_id", "pipeline_id", "is_active");

-- CreateIndex
CREATE UNIQUE INDEX "pipeline_stages_organization_id_pipeline_id_position_key" ON "pipeline_stages"("organization_id", "pipeline_id", "position");

-- CreateIndex
CREATE INDEX "matters_organization_id_client_id_idx" ON "matters"("organization_id", "client_id");

-- CreateIndex
CREATE INDEX "matters_organization_id_current_stage_id_idx" ON "matters"("organization_id", "current_stage_id");

-- CreateIndex
CREATE INDEX "matters_organization_id_responsible_lawyer_id_status_idx" ON "matters"("organization_id", "responsible_lawyer_id", "status");

-- CreateIndex
CREATE INDEX "matters_organization_id_responsible_secretary_id_status_idx" ON "matters"("organization_id", "responsible_secretary_id", "status");

-- CreateIndex
CREATE INDEX "matters_organization_id_court_number_normalized_idx" ON "matters"("organization_id", "court_number_normalized");

-- CreateIndex
CREATE INDEX "matters_organization_id_next_action_at_idx" ON "matters"("organization_id", "next_action_at");

-- CreateIndex
CREATE INDEX "matters_organization_id_status_deleted_at_idx" ON "matters"("organization_id", "status", "deleted_at");

-- CreateIndex
CREATE UNIQUE INDEX "matters_organization_id_reference_key" ON "matters"("organization_id", "reference");

-- CreateIndex
CREATE INDEX "matter_parties_organization_id_matter_id_idx" ON "matter_parties"("organization_id", "matter_id");

-- CreateIndex
CREATE INDEX "matter_stage_history_organization_id_matter_id_moved_at_idx" ON "matter_stage_history"("organization_id", "matter_id", "moved_at");

-- CreateIndex
CREATE INDEX "contracts_organization_id_client_id_status_idx" ON "contracts"("organization_id", "client_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "contracts_organization_id_number_key" ON "contracts"("organization_id", "number");

-- CreateIndex
CREATE INDEX "receivables_organization_id_client_id_status_idx" ON "receivables"("organization_id", "client_id", "status");

-- CreateIndex
CREATE INDEX "receivables_organization_id_due_date_status_idx" ON "receivables"("organization_id", "due_date", "status");

-- CreateIndex
CREATE UNIQUE INDEX "receivables_organization_id_reference_key" ON "receivables"("organization_id", "reference");

-- CreateIndex
CREATE INDEX "receivable_installments_organization_id_due_date_status_idx" ON "receivable_installments"("organization_id", "due_date", "status");

-- CreateIndex
CREATE UNIQUE INDEX "receivable_installments_organization_id_receivable_id_seque_key" ON "receivable_installments"("organization_id", "receivable_id", "sequence");

-- CreateIndex
CREATE INDEX "payments_organization_id_client_id_status_idx" ON "payments"("organization_id", "client_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "payments_organization_id_reference_key" ON "payments"("organization_id", "reference");

-- CreateIndex
CREATE UNIQUE INDEX "payments_organization_id_external_id_key" ON "payments"("organization_id", "external_id");

-- CreateIndex
CREATE UNIQUE INDEX "payments_organization_id_idempotency_key_key" ON "payments"("organization_id", "idempotency_key");

-- CreateIndex
CREATE UNIQUE INDEX "payment_reversals_original_payment_id_key" ON "payment_reversals"("original_payment_id");

-- CreateIndex
CREATE INDEX "payment_reversals_organization_id_reversed_at_idx" ON "payment_reversals"("organization_id", "reversed_at");

-- CreateIndex
CREATE INDEX "payment_allocations_organization_id_installment_id_idx" ON "payment_allocations"("organization_id", "installment_id");

-- CreateIndex
CREATE UNIQUE INDEX "payment_allocations_organization_id_payment_id_installment__key" ON "payment_allocations"("organization_id", "payment_id", "installment_id");

-- CreateIndex
CREATE INDEX "financial_adjustments_organization_id_installment_id_idx" ON "financial_adjustments"("organization_id", "installment_id");

-- CreateIndex
CREATE INDEX "financial_adjustments_organization_id_payment_id_idx" ON "financial_adjustments"("organization_id", "payment_id");

-- CreateIndex
CREATE INDEX "renegotiations_organization_id_original_receivable_id_statu_idx" ON "renegotiations"("organization_id", "original_receivable_id", "status");

-- CreateIndex
CREATE INDEX "expenses_organization_id_status_due_date_idx" ON "expenses"("organization_id", "status", "due_date");

-- CreateIndex
CREATE INDEX "expenses_organization_id_matter_id_idx" ON "expenses"("organization_id", "matter_id");

-- CreateIndex
CREATE INDEX "documents_organization_id_matter_id_status_idx" ON "documents"("organization_id", "matter_id", "status");

-- CreateIndex
CREATE INDEX "documents_organization_id_client_id_idx" ON "documents"("organization_id", "client_id");

-- CreateIndex
CREATE INDEX "documents_organization_id_installment_id_idx" ON "documents"("organization_id", "installment_id");

-- CreateIndex
CREATE INDEX "documents_organization_id_payment_id_idx" ON "documents"("organization_id", "payment_id");

-- CreateIndex
CREATE INDEX "documents_organization_id_deleted_at_idx" ON "documents"("organization_id", "deleted_at");

-- CreateIndex
CREATE INDEX "document_versions_organization_id_document_id_idx" ON "document_versions"("organization_id", "document_id");

-- CreateIndex
CREATE UNIQUE INDEX "document_versions_organization_id_document_id_version_key" ON "document_versions"("organization_id", "document_id", "version");

-- CreateIndex
CREATE UNIQUE INDEX "document_versions_organization_id_storage_key_key" ON "document_versions"("organization_id", "storage_key");

-- CreateIndex
CREATE INDEX "internal_notes_organization_id_matter_id_created_at_idx" ON "internal_notes"("organization_id", "matter_id", "created_at");

-- CreateIndex
CREATE INDEX "internal_notes_organization_id_client_id_created_at_idx" ON "internal_notes"("organization_id", "client_id", "created_at");

-- CreateIndex
CREATE INDEX "client_messages_organization_id_client_id_published_at_idx" ON "client_messages"("organization_id", "client_id", "published_at");

-- CreateIndex
CREATE INDEX "client_messages_organization_id_matter_id_published_at_idx" ON "client_messages"("organization_id", "matter_id", "published_at");

-- CreateIndex
CREATE INDEX "tasks_organization_id_assignee_id_status_due_at_idx" ON "tasks"("organization_id", "assignee_id", "status", "due_at");

-- CreateIndex
CREATE INDEX "tasks_organization_id_matter_id_idx" ON "tasks"("organization_id", "matter_id");

-- CreateIndex
CREATE INDEX "task_comments_organization_id_task_id_created_at_idx" ON "task_comments"("organization_id", "task_id", "created_at");

-- CreateIndex
CREATE INDEX "task_reminders_organization_id_remind_at_status_idx" ON "task_reminders"("organization_id", "remind_at", "status");

-- CreateIndex
CREATE INDEX "task_history_organization_id_task_id_created_at_idx" ON "task_history"("organization_id", "task_id", "created_at");

-- CreateIndex
CREATE INDEX "calendar_events_organization_id_starts_at_status_idx" ON "calendar_events"("organization_id", "starts_at", "status");

-- CreateIndex
CREATE INDEX "calendar_events_organization_id_matter_id_idx" ON "calendar_events"("organization_id", "matter_id");

-- CreateIndex
CREATE INDEX "notifications_organization_id_user_id_status_created_at_idx" ON "notifications"("organization_id", "user_id", "status", "created_at");

-- CreateIndex
CREATE INDEX "audit_logs_organization_id_resource_resource_id_created_at_idx" ON "audit_logs"("organization_id", "resource", "resource_id", "created_at");

-- CreateIndex
CREATE INDEX "audit_logs_organization_id_actor_user_id_created_at_idx" ON "audit_logs"("organization_id", "actor_user_id", "created_at");

-- CreateIndex
CREATE INDEX "activity_events_organization_id_subject_type_subject_id_occ_idx" ON "activity_events"("organization_id", "subject_type", "subject_id", "occurred_at");

-- CreateIndex
CREATE INDEX "activity_events_organization_id_occurred_at_idx" ON "activity_events"("organization_id", "occurred_at");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "roles" ADD CONSTRAINT "roles_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "permissions" ADD CONSTRAINT "permissions_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_permission_id_fkey" FOREIGN KEY ("permission_id") REFERENCES "permissions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "password_reset_tokens" ADD CONSTRAINT "password_reset_tokens_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "password_reset_tokens" ADD CONSTRAINT "password_reset_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clients" ADD CONSTRAINT "clients_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_contacts" ADD CONSTRAINT "client_contacts_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_contacts" ADD CONSTRAINT "client_contacts_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pipelines" ADD CONSTRAINT "pipelines_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pipeline_stages" ADD CONSTRAINT "pipeline_stages_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pipeline_stages" ADD CONSTRAINT "pipeline_stages_pipeline_id_fkey" FOREIGN KEY ("pipeline_id") REFERENCES "pipelines"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "matters" ADD CONSTRAINT "matters_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "matters" ADD CONSTRAINT "matters_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "matters" ADD CONSTRAINT "matters_pipeline_id_fkey" FOREIGN KEY ("pipeline_id") REFERENCES "pipelines"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "matters" ADD CONSTRAINT "matters_current_stage_id_fkey" FOREIGN KEY ("current_stage_id") REFERENCES "pipeline_stages"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "matter_parties" ADD CONSTRAINT "matter_parties_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "matter_parties" ADD CONSTRAINT "matter_parties_matter_id_fkey" FOREIGN KEY ("matter_id") REFERENCES "matters"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "matter_parties" ADD CONSTRAINT "matter_parties_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "matter_stage_history" ADD CONSTRAINT "matter_stage_history_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "matter_stage_history" ADD CONSTRAINT "matter_stage_history_matter_id_fkey" FOREIGN KEY ("matter_id") REFERENCES "matters"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "matter_stage_history" ADD CONSTRAINT "matter_stage_history_from_stage_id_fkey" FOREIGN KEY ("from_stage_id") REFERENCES "pipeline_stages"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "matter_stage_history" ADD CONSTRAINT "matter_stage_history_to_stage_id_fkey" FOREIGN KEY ("to_stage_id") REFERENCES "pipeline_stages"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_matter_id_fkey" FOREIGN KEY ("matter_id") REFERENCES "matters"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receivables" ADD CONSTRAINT "receivables_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receivables" ADD CONSTRAINT "receivables_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receivables" ADD CONSTRAINT "receivables_matter_id_fkey" FOREIGN KEY ("matter_id") REFERENCES "matters"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receivables" ADD CONSTRAINT "receivables_contract_id_fkey" FOREIGN KEY ("contract_id") REFERENCES "contracts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receivable_installments" ADD CONSTRAINT "receivable_installments_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receivable_installments" ADD CONSTRAINT "receivable_installments_receivable_id_fkey" FOREIGN KEY ("receivable_id") REFERENCES "receivables"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_reversals" ADD CONSTRAINT "payment_reversals_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_reversals" ADD CONSTRAINT "payment_reversals_original_payment_id_fkey" FOREIGN KEY ("original_payment_id") REFERENCES "payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_installment_id_fkey" FOREIGN KEY ("installment_id") REFERENCES "receivable_installments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "financial_adjustments" ADD CONSTRAINT "financial_adjustments_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "financial_adjustments" ADD CONSTRAINT "financial_adjustments_installment_id_fkey" FOREIGN KEY ("installment_id") REFERENCES "receivable_installments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "financial_adjustments" ADD CONSTRAINT "financial_adjustments_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "renegotiations" ADD CONSTRAINT "renegotiations_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "renegotiations" ADD CONSTRAINT "renegotiations_original_receivable_id_fkey" FOREIGN KEY ("original_receivable_id") REFERENCES "receivables"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "renegotiations" ADD CONSTRAINT "renegotiations_resulting_receivable_id_fkey" FOREIGN KEY ("resulting_receivable_id") REFERENCES "receivables"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_matter_id_fkey" FOREIGN KEY ("matter_id") REFERENCES "matters"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_matter_id_fkey" FOREIGN KEY ("matter_id") REFERENCES "matters"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_installment_id_fkey" FOREIGN KEY ("installment_id") REFERENCES "receivable_installments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_versions" ADD CONSTRAINT "document_versions_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_versions" ADD CONSTRAINT "document_versions_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "documents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "internal_notes" ADD CONSTRAINT "internal_notes_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "internal_notes" ADD CONSTRAINT "internal_notes_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "internal_notes" ADD CONSTRAINT "internal_notes_matter_id_fkey" FOREIGN KEY ("matter_id") REFERENCES "matters"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_messages" ADD CONSTRAINT "client_messages_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_messages" ADD CONSTRAINT "client_messages_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_messages" ADD CONSTRAINT "client_messages_matter_id_fkey" FOREIGN KEY ("matter_id") REFERENCES "matters"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_matter_id_fkey" FOREIGN KEY ("matter_id") REFERENCES "matters"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_comments" ADD CONSTRAINT "task_comments_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_comments" ADD CONSTRAINT "task_comments_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_reminders" ADD CONSTRAINT "task_reminders_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_reminders" ADD CONSTRAINT "task_reminders_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_history" ADD CONSTRAINT "task_history_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_history" ADD CONSTRAINT "task_history_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "calendar_events" ADD CONSTRAINT "calendar_events_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "calendar_events" ADD CONSTRAINT "calendar_events_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "calendar_events" ADD CONSTRAINT "calendar_events_matter_id_fkey" FOREIGN KEY ("matter_id") REFERENCES "matters"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activity_events" ADD CONSTRAINT "activity_events_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Domain constraints: money, identifiers, chronology and mutually exclusive targets.
ALTER TABLE "clients" ADD CONSTRAINT "clients_tax_id_normalized_check" CHECK ("tax_id_normalized" IS NULL OR "tax_id_normalized" ~ '^([0-9]{11}|[0-9]{14})$');
ALTER TABLE "matter_parties" ADD CONSTRAINT "matter_parties_tax_id_normalized_check" CHECK ("tax_id_normalized" IS NULL OR "tax_id_normalized" ~ '^([0-9]{11}|[0-9]{14})$');
ALTER TABLE "pipeline_stages" ADD CONSTRAINT "pipeline_stages_position_check" CHECK ("position" >= 0);
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_amount_check" CHECK ("fixed_amount" IS NULL OR "fixed_amount" >= 0);
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_rate_check" CHECK ("success_rate" IS NULL OR ("success_rate" >= 0 AND "success_rate" <= 1));
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_dates_check" CHECK ("ends_at" IS NULL OR "starts_at" IS NULL OR "ends_at" >= "starts_at");
ALTER TABLE "receivables" ADD CONSTRAINT "receivables_amount_check" CHECK ("original_amount" > 0);
ALTER TABLE "receivables" ADD CONSTRAINT "receivables_dates_check" CHECK ("due_date" >= "issue_date");
ALTER TABLE "receivable_installments" ADD CONSTRAINT "installments_amount_check" CHECK ("amount" > 0);
ALTER TABLE "receivable_installments" ADD CONSTRAINT "installments_sequence_check" CHECK ("sequence" > 0);
ALTER TABLE "receivable_installments" ADD CONSTRAINT "installments_version_check" CHECK ("version" > 0);
ALTER TABLE "payments" ADD CONSTRAINT "payments_amount_check" CHECK ("amount" > 0);
ALTER TABLE "payments" ADD CONSTRAINT "payments_version_check" CHECK ("version" > 0);
ALTER TABLE "payments" ADD CONSTRAINT "payments_idempotency_hash_check" CHECK ("idempotency_hash" ~ '^[a-f0-9]{64}$');
ALTER TABLE "payment_reversals" ADD CONSTRAINT "payment_reversals_amount_check" CHECK ("amount" > 0);
ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_amount_check" CHECK ("amount" > 0);
ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_reversal_check" CHECK (("reversed_at" IS NULL) = ("reversed_by_id" IS NULL));
ALTER TABLE "financial_adjustments" ADD CONSTRAINT "financial_adjustments_amount_check" CHECK ("amount" > 0);
ALTER TABLE "financial_adjustments" ADD CONSTRAINT "financial_adjustments_target_check" CHECK (num_nonnulls("installment_id", "payment_id") = 1);
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_amount_check" CHECK ("amount" > 0);
ALTER TABLE "documents" ADD CONSTRAINT "documents_current_version_check" CHECK ("current_version" > 0);
ALTER TABLE "document_versions" ADD CONSTRAINT "document_versions_version_check" CHECK ("version" > 0);
ALTER TABLE "document_versions" ADD CONSTRAINT "document_versions_size_check" CHECK ("size_bytes" > 0);
ALTER TABLE "document_versions" ADD CONSTRAINT "document_versions_sha256_check" CHECK ("sha256" ~ '^[a-f0-9]{64}$');
ALTER TABLE "calendar_events" ADD CONSTRAINT "calendar_events_dates_check" CHECK ("ends_at" > "starts_at");
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_expiry_check" CHECK ("expires_at" > "created_at");
ALTER TABLE "password_reset_tokens" ADD CONSTRAINT "password_reset_tokens_expiry_check" CHECK ("expires_at" > "created_at");

-- Database-level tenant boundary. It also provides referential protection for actor fields
-- that are intentionally kept out of the Prisma relation graph.
CREATE FUNCTION public.enforce_same_organization() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  foreign_value text;
  parent_organization uuid;
BEGIN
  foreign_value := to_jsonb(NEW) ->> TG_ARGV[1];
  IF foreign_value IS NULL THEN
    RETURN NEW;
  END IF;

  EXECUTE format('SELECT organization_id FROM public.%I WHERE id = $1', TG_ARGV[0])
    INTO parent_organization USING foreign_value::uuid;
  IF parent_organization IS NULL THEN
    RAISE EXCEPTION 'Referenced tenant resource does not exist' USING ERRCODE = 'foreign_key_violation';
  END IF;
  IF parent_organization <> NEW.organization_id THEN
    RAISE EXCEPTION 'Cross-organization reference rejected' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END;
$$;

DO $$
DECLARE
  relation record;
BEGIN
  FOR relation IN
    SELECT * FROM (VALUES
      ('users','clients','client_id'),
      ('user_roles','users','user_id'), ('user_roles','roles','role_id'), ('user_roles','users','assigned_by_id'),
      ('role_permissions','roles','role_id'), ('role_permissions','permissions','permission_id'),
      ('sessions','users','user_id'), ('password_reset_tokens','users','user_id'),
      ('client_contacts','clients','client_id'), ('pipeline_stages','pipelines','pipeline_id'),
      ('matters','clients','client_id'), ('matters','pipelines','pipeline_id'), ('matters','pipeline_stages','current_stage_id'),
      ('matters','users','responsible_lawyer_id'), ('matters','users','responsible_secretary_id'),
      ('matter_parties','matters','matter_id'), ('matter_parties','clients','client_id'),
      ('matter_stage_history','matters','matter_id'), ('matter_stage_history','pipeline_stages','from_stage_id'),
      ('matter_stage_history','pipeline_stages','to_stage_id'), ('matter_stage_history','users','moved_by_id'),
      ('contracts','clients','client_id'), ('contracts','matters','matter_id'), ('contracts','users','approved_by_id'),
      ('receivables','clients','client_id'), ('receivables','matters','matter_id'), ('receivables','contracts','contract_id'),
      ('receivable_installments','receivables','receivable_id'),
      ('payments','clients','client_id'), ('payments','users','confirmed_by_id'),
      ('payment_reversals','payments','original_payment_id'), ('payment_reversals','users','reversed_by_id'),
      ('payment_allocations','payments','payment_id'), ('payment_allocations','receivable_installments','installment_id'),
      ('payment_allocations','users','created_by_id'), ('payment_allocations','users','reversed_by_id'),
      ('financial_adjustments','receivable_installments','installment_id'), ('financial_adjustments','payments','payment_id'),
      ('financial_adjustments','users','created_by_id'), ('financial_adjustments','users','approved_by_id'),
      ('renegotiations','receivables','original_receivable_id'), ('renegotiations','receivables','resulting_receivable_id'),
      ('renegotiations','users','created_by_id'), ('renegotiations','users','approved_by_id'),
      ('expenses','matters','matter_id'), ('expenses','users','approved_by_id'),
      ('documents','clients','client_id'), ('documents','matters','matter_id'),
      ('documents','receivable_installments','installment_id'), ('documents','payments','payment_id'), ('documents','users','created_by_id'),
      ('document_versions','documents','document_id'), ('document_versions','users','uploaded_by_id'),
      ('internal_notes','clients','client_id'), ('internal_notes','matters','matter_id'), ('internal_notes','users','created_by_id'),
      ('client_messages','clients','client_id'), ('client_messages','matters','matter_id'), ('client_messages','users','created_by_id'),
      ('tasks','clients','client_id'), ('tasks','matters','matter_id'), ('tasks','users','assignee_id'), ('tasks','users','created_by_id'),
      ('task_comments','tasks','task_id'), ('task_comments','users','created_by_id'), ('task_reminders','tasks','task_id'),
      ('task_history','tasks','task_id'), ('task_history','users','actor_user_id'),
      ('calendar_events','clients','client_id'), ('calendar_events','matters','matter_id'), ('calendar_events','users','created_by_id'),
      ('notifications','users','user_id'), ('audit_logs','users','actor_user_id'), ('audit_logs','sessions','actor_session_id'),
      ('activity_events','users','actor_user_id')
    ) AS tenant_relation(child_table, parent_table, foreign_column)
  LOOP
    EXECUTE format(
      'CREATE TRIGGER %I BEFORE INSERT OR UPDATE OF organization_id, %I ON public.%I FOR EACH ROW EXECUTE FUNCTION public.enforce_same_organization(%L, %L)',
      'tenant_' || relation.child_table || '_' || relation.foreign_column,
      relation.foreign_column,
      relation.child_table,
      relation.parent_table,
      relation.foreign_column
    );
  END LOOP;
END;
$$;

-- Ledger and history rows are append-only. Reversal is represented by explicit fields/rows.
CREATE FUNCTION public.reject_immutable_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Immutable history cannot be changed' USING ERRCODE = 'integrity_constraint_violation';
END;
$$;

CREATE TRIGGER "immutable_audit_logs" BEFORE UPDATE OR DELETE ON "audit_logs" FOR EACH ROW EXECUTE FUNCTION public.reject_immutable_mutation();
CREATE TRIGGER "immutable_matter_stage_history" BEFORE UPDATE OR DELETE ON "matter_stage_history" FOR EACH ROW EXECUTE FUNCTION public.reject_immutable_mutation();
CREATE TRIGGER "immutable_task_history" BEFORE UPDATE OR DELETE ON "task_history" FOR EACH ROW EXECUTE FUNCTION public.reject_immutable_mutation();
CREATE TRIGGER "immutable_payment_reversals" BEFORE UPDATE OR DELETE ON "payment_reversals" FOR EACH ROW EXECUTE FUNCTION public.reject_immutable_mutation();
CREATE TRIGGER "immutable_document_versions" BEFORE UPDATE OR DELETE ON "document_versions" FOR EACH ROW EXECUTE FUNCTION public.reject_immutable_mutation();

CREATE FUNCTION public.protect_confirmed_payment() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' AND OLD.status IN ('CONFIRMED', 'REVERSED') THEN
    RAISE EXCEPTION 'Confirmed payments cannot be deleted' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.status IN ('CONFIRMED', 'REVERSED') AND
     (NEW.amount, NEW.currency, NEW.client_id, NEW.paid_at, NEW.idempotency_key, NEW.idempotency_hash)
       IS DISTINCT FROM
     (OLD.amount, OLD.currency, OLD.client_id, OLD.paid_at, OLD.idempotency_key, OLD.idempotency_hash) THEN
    RAISE EXCEPTION 'Confirmed payment financial identity is immutable' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE TRIGGER "protect_confirmed_payments" BEFORE UPDATE OR DELETE ON "payments" FOR EACH ROW EXECUTE FUNCTION public.protect_confirmed_payment();

-- Defense-in-depth for allocations written outside the API. Locks serialize competing
-- writers and validate client, currency, payment capacity and installment balance.
CREATE FUNCTION public.validate_payment_allocation() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  payment_row record;
  installment_row record;
  payment_allocated numeric(19,4);
  installment_allocated numeric(19,4);
  installment_adjusted numeric(19,4);
BEGIN
  IF NEW.reversed_at IS NOT NULL THEN
    RETURN NEW;
  END IF;

  SELECT p.amount, p.client_id, p.currency, p.status INTO payment_row
    FROM payments p WHERE p.id = NEW.payment_id AND p.organization_id = NEW.organization_id FOR UPDATE;
  SELECT i.amount, i.currency, r.client_id INTO installment_row
    FROM receivable_installments i JOIN receivables r ON r.id = i.receivable_id
    WHERE i.id = NEW.installment_id AND i.organization_id = NEW.organization_id FOR UPDATE OF i;

  IF payment_row IS NULL OR installment_row IS NULL OR payment_row.status <> 'CONFIRMED' THEN
    RAISE EXCEPTION 'Allocation requires confirmed payment and existing installment' USING ERRCODE = 'check_violation';
  END IF;
  IF payment_row.client_id <> installment_row.client_id OR payment_row.currency <> installment_row.currency THEN
    RAISE EXCEPTION 'Allocation client or currency mismatch' USING ERRCODE = 'check_violation';
  END IF;

  SELECT COALESCE(SUM(amount), 0) INTO payment_allocated FROM payment_allocations
    WHERE payment_id = NEW.payment_id AND reversed_at IS NULL AND id <> NEW.id;
  IF payment_allocated + NEW.amount > payment_row.amount THEN
    RAISE EXCEPTION 'Allocation exceeds payment amount' USING ERRCODE = 'check_violation';
  END IF;

  SELECT installment_row.amount + COALESCE(SUM(CASE WHEN kind IN ('DISCOUNT','REVERSAL') THEN -amount ELSE amount END), 0)
    INTO installment_adjusted FROM financial_adjustments
    WHERE installment_id = NEW.installment_id AND approved_at IS NOT NULL;
  SELECT COALESCE(SUM(amount), 0) INTO installment_allocated FROM payment_allocations
    WHERE installment_id = NEW.installment_id AND reversed_at IS NULL AND id <> NEW.id;
  IF installment_allocated + NEW.amount > installment_adjusted THEN
    RAISE EXCEPTION 'Allocation exceeds installment balance' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "validate_payment_allocations" BEFORE INSERT OR UPDATE OF payment_id, installment_id, amount, reversed_at ON "payment_allocations" FOR EACH ROW EXECUTE FUNCTION public.validate_payment_allocation();

COMMIT;
