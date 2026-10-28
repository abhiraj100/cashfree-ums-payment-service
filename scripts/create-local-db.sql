-- Run with psql as the PostgreSQL administrator:
-- psql -U postgres -f scripts/create-local-db.sql
-- Local assessment credentials only. Do not reuse this password in production.

SELECT 'CREATE ROLE ums LOGIN PASSWORD ''ums_local_password'''
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ums')\gexec

SELECT 'CREATE DATABASE ums_payments OWNER ums'
WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = 'ums_payments')\gexec

GRANT ALL PRIVILEGES ON DATABASE ums_payments TO ums;
