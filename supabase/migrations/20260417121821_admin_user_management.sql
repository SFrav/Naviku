BEGIN;

-- get_users_with_profiles RPC
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'get_users_with_profiles'
      AND pg_get_function_arguments(p.oid) = 'p_division_id uuid DEFAULT NULL::uuid, p_department_id uuid DEFAULT NULL::uuid'
  ) THEN
    DROP FUNCTION public.get_users_with_profiles(uuid, uuid);
  END IF;
END $$;

-- Recreate with expected signature
DROP FUNCTION IF EXISTS public.get_users_with_profiles(text, text);
CREATE OR REPLACE FUNCTION public.get_users_with_profiles(
  p_query text DEFAULT NULL,
  p_role text DEFAULT NULL
)
RETURNS TABLE (
  id uuid,
  email text,
  full_name text,
  role text,
  entity_id uuid,
  division_id uuid,
  title_id uuid,
  status text
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, auth
AS $$
  SELECT 
    up.user_id AS id,
    au.email,
    up.full_name,
    up.role::text AS role,
    up.entity_id,
    up.division_id,
    up.title_id,
    CASE WHEN up.is_active THEN 'active' ELSE 'inactive' END AS status
  FROM public.user_profiles up
  LEFT JOIN auth.users au ON au.id = up.user_id
  WHERE (p_query IS NULL OR up.full_name ILIKE '%' || p_query || '%' OR au.email ILIKE '%' || p_query || '%')
    AND (p_role IS NULL OR up.role::text = p_role)
  ORDER BY up.full_name;
$$;

GRANT EXECUTE ON FUNCTION public.get_users_with_profiles(text, text) TO authenticated;

--------------------------------
DROP FUNCTION IF EXISTS public.get_current_profile();
CREATE OR REPLACE FUNCTION public.get_current_profile()
RETURNS TABLE (
  id uuid,
  user_id uuid,
  role role_enum,
  division_id uuid
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT up.id,
         up.user_id,
         up.role,
         up.division_id
  FROM public.user_profiles up
  WHERE up.user_id = auth.uid()
  LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION public.get_current_profile() TO authenticated;

-- ============================================================================
-- Add search paths to existing user managerment functions
-- ============================================================================

CREATE OR REPLACE FUNCTION validate_user_profile_assignment()
RETURNS TRIGGER SET search_path TO public
AS $$
BEGIN
  -- Admin should have no entity/team
  IF NEW.role = 'admin' AND (NEW.entity_id IS NOT NULL OR NEW.division_id IS NOT NULL) THEN
    RAISE WARNING 'Admin role should not have entity_id or team (division_id) assigned. Auto-clearing.';
    NEW.entity_id := NULL;
    NEW.division_id := NULL;
    NEW.manager_id := NULL;
  END IF;
  
  -- Head should have entity but ideally no division_id (assigned via divisions.head_id)
  IF NEW.role = 'head' AND NEW.entity_id IS NULL THEN
    RAISE EXCEPTION 'Head role must have entity_id assigned';
  END IF;
  
  -- Manager should have entity and team
  IF NEW.role = 'manager' THEN
    IF NEW.entity_id IS NULL THEN
      RAISE EXCEPTION 'Manager role must have entity_id assigned';
    END IF;
    IF NEW.division_id IS NULL THEN
      RAISE EXCEPTION 'Manager role must have team (division_id) assigned';
    END IF;
  END IF;
  
  -- Sales/Account Manager should have entity, team, and manager
  IF NEW.role IN ('sales', 'account_manager') THEN
    IF NEW.entity_id IS NULL THEN
      RAISE EXCEPTION 'Sales role must have entity_id assigned';
    END IF;
    IF NEW.division_id IS NULL THEN
      RAISE EXCEPTION 'Sales role must have team (division_id) assigned';
    END IF;
    IF NEW.manager_id IS NULL THEN
      RAISE WARNING 'Sales role should have manager_id assigned';
    END IF;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

--
CREATE OR REPLACE FUNCTION public.get_manager_archived(
  p_manager_id UUID,
  p_period TEXT DEFAULT NULL,
  p_start_date DATE DEFAULT NULL,
  p_end_date DATE DEFAULT NULL
)
RETURNS TABLE (
  revenue NUMERIC,
  margin NUMERIC,
  project_count BIGINT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $$
DECLARE
  v_entity_id UUID;
  v_division_id UUID;
  v_start_date DATE;
  v_end_date DATE;
  v_quarter INT;
  v_year INT;
BEGIN
  -- Get manager's entity and division
  SELECT entity_id, division_id
  INTO v_entity_id, v_division_id
  FROM public.user_profiles
  WHERE id = p_manager_id
    AND role = 'manager';

  IF v_entity_id IS NULL OR v_division_id IS NULL THEN
    RAISE EXCEPTION 'Manager not found or missing entity/division assignment';
  END IF;

  -- Parse period jika diberikan
  IF p_period IS NOT NULL AND p_period ~ '^Q[1-4] \d{4}$' THEN
    v_quarter := SUBSTRING(p_period FROM 2 FOR 1)::INT;
    v_year := SUBSTRING(p_period FROM 4)::INT;
    v_start_date := MAKE_DATE(v_year, (v_quarter - 1) * 3 + 1, 1);
    v_end_date := (v_start_date + INTERVAL '3 MONTHS')::DATE - 1;
  ELSIF p_start_date IS NOT NULL AND p_end_date IS NOT NULL THEN
    v_start_date := p_start_date;
    v_end_date := p_end_date;
  ELSE
    -- Default: current quarter
    v_start_date := DATE_TRUNC('quarter', CURRENT_DATE)::DATE;
    v_end_date := (v_start_date + INTERVAL '3 MONTHS' - INTERVAL '1 day')::DATE;
  END IF;

  -- Return hasil perhitungan archived dari data yang ada
  RETURN QUERY
  WITH 
  -- Get all active AM/Staff/Sales under this manager (same entity + division)
  team_members AS (
    SELECT up.user_id
    FROM public.user_profiles up
    WHERE up.role IN ('account_manager', 'staff', 'sales')
      AND up.is_active = true
      AND up.entity_id = v_entity_id
      AND up.division_id = v_division_id
      AND up.manager_id = p_manager_id
  ),
  -- Get won opportunities for team in period
  team_opportunities AS (
    SELECT o.id, o.expected_close_date
    FROM public.opportunities o
    JOIN team_members tm ON o.owner_id = tm.user_id
    WHERE (o.is_won = true OR o.stage = 'Closed Won')
      AND o.status != 'archived'
      AND (
        o.expected_close_date >= v_start_date
        AND o.expected_close_date <= v_end_date
      )
  ),
  -- Get projects untuk opportunities yang won (dari form add project)
  team_projects AS (
    SELECT 
      p.opportunity_id,
      p.po_amount,
      p.created_at
    FROM public.projects p
    JOIN team_opportunities to_opp ON p.opportunity_id = to_opp.id
  ),
  -- Get costs dari pipeline_items (COGS = cost_of_goods + service_costs + other_expenses)
  project_costs AS (
    SELECT 
      pi.opportunity_id,
      COALESCE(pi.cost_of_goods, 0) + 
      COALESCE(pi.service_costs, 0) + 
      COALESCE(pi.other_expenses, 0) AS total_cost
    FROM public.pipeline_items pi
    JOIN team_projects tp ON pi.opportunity_id = tp.opportunity_id
    WHERE pi.status = 'won'
      AND (
        pi.cost_of_goods > 0 
        OR pi.service_costs > 0 
        OR pi.other_expenses > 0
      )
  )
  SELECT 
    COALESCE(SUM(tp.po_amount), 0)::NUMERIC AS revenue,
    COALESCE(SUM(tp.po_amount - COALESCE(pc.total_cost, 0)), 0)::NUMERIC AS margin,
    COUNT(DISTINCT tp.opportunity_id)::BIGINT AS project_count
  FROM team_projects tp
  LEFT JOIN project_costs pc ON tp.opportunity_id = pc.opportunity_id;
END;
$$;

-- Grant execute to authenticated users
GRANT EXECUTE ON FUNCTION public.get_manager_archived(UUID, TEXT, DATE, DATE) TO authenticated;

--
CREATE OR REPLACE FUNCTION public.get_head_manager_archived(
  p_period TEXT DEFAULT NULL,
  p_start_date DATE DEFAULT NULL,
  p_end_date DATE DEFAULT NULL
)
RETURNS TABLE (
  manager_id UUID,
  manager_name TEXT,
  entity_id UUID,
  division_id UUID,
  revenue NUMERIC,
  margin NUMERIC,
  project_count BIGINT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $$
DECLARE
  v_user_id UUID;
  v_head_profile RECORD;
  v_start_date DATE;
  v_end_date DATE;
  v_quarter INT;
  v_year INT;
BEGIN
  -- Get current user
  v_user_id := auth.uid();
  
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'User not authenticated';
  END IF;

  -- Get head profile
  SELECT * INTO v_head_profile
  FROM public.user_profiles
  WHERE user_id = v_user_id
    AND role = 'head';

  IF v_head_profile IS NULL THEN
    RAISE EXCEPTION 'User is not a head';
  END IF;

  -- Parse period jika diberikan
  IF p_period IS NOT NULL AND p_period ~ '^Q[1-4] \d{4}$' THEN
    v_quarter := SUBSTRING(p_period FROM 2 FOR 1)::INT;
    v_year := SUBSTRING(p_period FROM 4)::INT;
    v_start_date := MAKE_DATE(v_year, (v_quarter - 1) * 3 + 1, 1);
    v_end_date := (v_start_date + INTERVAL '3 MONTHS')::DATE - 1;
  ELSIF p_start_date IS NOT NULL AND p_end_date IS NOT NULL THEN
    v_start_date := p_start_date;
    v_end_date := p_end_date;
  ELSE
    -- Default: current quarter
    v_start_date := DATE_TRUNC('quarter', CURRENT_DATE)::DATE;
    v_end_date := (v_start_date + INTERVAL '3 MONTHS' - INTERVAL '1 day')::DATE;
  END IF;

  -- Return archived untuk semua manager di tim/entity head
  RETURN QUERY
  SELECT 
    m.id AS manager_id,
    m.full_name AS manager_name,
    m.entity_id,
    m.division_id,
    COALESCE(archived.revenue, 0)::NUMERIC AS revenue,
    COALESCE(archived.margin, 0)::NUMERIC AS margin,
    COALESCE(archived.project_count, 0)::BIGINT AS project_count
  FROM public.user_profiles m
  CROSS JOIN LATERAL (
    SELECT * FROM public.get_manager_archived(
      m.id,
      NULL,
      v_start_date,
      v_end_date
    )
  ) archived
  WHERE m.role = 'manager'
    AND m.is_active = true
    AND (
      -- Head melihat manager di tim mereka (division_id)
      (v_head_profile.division_id IS NOT NULL 
       AND m.division_id = v_head_profile.division_id)
      OR
      -- Fallback: Head melihat manager di entity mereka
      (v_head_profile.division_id IS NULL 
       AND v_head_profile.entity_id IS NOT NULL
       AND m.entity_id = v_head_profile.entity_id)
    )
  ORDER BY m.full_name;
END;
$$;

-- Grant execute to authenticated users
GRANT EXECUTE ON FUNCTION public.get_head_manager_archived(TEXT, DATE, DATE) TO authenticated;

CREATE OR REPLACE FUNCTION public.log_audit_event(
  p_action text,
  p_table_name text,
  p_record_id uuid,
  p_changes jsonb DEFAULT '{}'::jsonb
)
RETURNS uuid
LANGUAGE plpgsql SECURITY INVOKER
SET search_path TO public, auth
AS $$
DECLARE
  v_id uuid := gen_random_uuid();
BEGIN
  INSERT INTO public.audit_logs(id, user_id, action, table_name, record_id, changes)
  VALUES (v_id, auth.uid(), p_action, p_table_name, p_record_id, COALESCE(p_changes, '{}'::jsonb));
  RETURN v_id;
END;
$$;

COMMIT;