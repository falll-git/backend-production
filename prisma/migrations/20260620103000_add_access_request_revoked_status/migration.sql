ALTER TYPE "digital_document_access_request_statuses" ADD VALUE IF NOT EXISTS 'REVOKED';
ALTER TYPE "storage_activity_actions" ADD VALUE IF NOT EXISTS 'ACCESS_REVOKED';
