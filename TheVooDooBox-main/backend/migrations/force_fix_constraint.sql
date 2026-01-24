-- Forcefully recreate the unique constraint to ensure ON CONFLICT works
ALTER TABLE analysis_reports DROP CONSTRAINT IF EXISTS analysis_reports_task_id_key;

-- Clean up duplicates again just in case (keeping most recent)
DELETE FROM analysis_reports a
USING analysis_reports b
WHERE a.id < b.id 
  AND a.task_id = b.task_id;

-- Re-add the unique constraint
ALTER TABLE analysis_reports ADD CONSTRAINT analysis_reports_task_id_key UNIQUE (task_id);
