-- Migration: Auto-close opportunity when project is created
-- This ensures data consistency between projects and opportunities
-- Date: 2025-10-30

-- Step 1: Fix existing opportunities that have projects but not marked as won
UPDATE opportunities o
SET 
  is_won = true,
  is_closed = true,
  stage = 'Closed Won',
  status = 'won',
  expected_close_date = COALESCE(
    o.expected_close_date, 
    (SELECT created_at::date FROM projects WHERE opportunity_id = o.id LIMIT 1),
    CURRENT_DATE
  ),
  updated_at = NOW()
WHERE EXISTS (
  SELECT 1 FROM projects p WHERE p.opportunity_id = o.id
)
AND (o.is_won = false OR o.stage != 'Closed Won');

-- Step 2: Create function to auto-update opportunity when project is created
CREATE OR REPLACE FUNCTION auto_close_opportunity_on_project()
RETURNS TRIGGER AS $$
BEGIN
  -- When a new project is created, mark the related opportunity as WON
  UPDATE opportunities
  SET 
    is_won = true,
    is_closed = true,
    stage = 'Closed Won',
    status = 'won',
    expected_close_date = COALESCE(expected_close_date, NEW.created_at::date),
    updated_at = NOW()
  WHERE id = NEW.opportunity_id
    AND (is_won = false OR stage != 'Closed Won');
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Step 3: Drop existing trigger if exists
DROP TRIGGER IF EXISTS trigger_auto_close_opportunity ON projects;

-- Step 4: Create trigger
CREATE TRIGGER trigger_auto_close_opportunity
  AFTER INSERT ON projects
  FOR EACH ROW
  EXECUTE FUNCTION auto_close_opportunity_on_project();

-- Step 5: Add comment for documentation
COMMENT ON FUNCTION auto_close_opportunity_on_project() IS 
  'Automatically marks opportunity as Closed Won when a project is created. This ensures data consistency between projects and opportunities.';

COMMENT ON TRIGGER trigger_auto_close_opportunity ON projects IS
  'Auto-updates opportunity to Closed Won status when a project is created';

