-- Add forensic_report_json column to store the full ForensicReport structure
ALTER TABLE analysis_reports ADD COLUMN IF NOT EXISTS forensic_report_json TEXT DEFAULT '{}';

-- Add unique constraint on task_id if not exists
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'analysis_reports_task_id_key'
    ) THEN
        ALTER TABLE analysis_reports ADD CONSTRAINT analysis_reports_task_id_key UNIQUE (task_id);
    END IF;
END $$;
