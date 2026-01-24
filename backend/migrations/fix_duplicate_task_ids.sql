-- Clean up duplicate task_id entries (keep the most recent one)
DELETE FROM analysis_reports a
USING analysis_reports b
WHERE a.id < b.id 
  AND a.task_id = b.task_id;

-- Now add the unique constraint
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'analysis_reports_task_id_key'
    ) THEN
        ALTER TABLE analysis_reports ADD CONSTRAINT analysis_reports_task_id_key UNIQUE (task_id);
    END IF;
END $$;
