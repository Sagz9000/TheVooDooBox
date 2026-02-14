-- Migration: Add Remnux Columns
-- Description: Adds remnux_status and remnux_report to the tasks table.

ALTER TABLE tasks ADD COLUMN IF NOT EXISTS remnux_status TEXT DEFAULT 'Not Started';
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS remnux_report JSONB;
