BEGIN;

-- Replace own_profile with split policies, no UPDATE
-- Block direct updates entirely — all updates go via RPC

CREATE POLICY "read_own_profile" ON user_profiles
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "insert_own_profile" ON user_profiles
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE OR REPLACE FUNCTION "public"."get_my_role"() RETURNS "text"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT role::text FROM user_profiles WHERE user_id = auth.uid() LIMIT 1;
$$;

-- Helper function that keeps non‑admin rows immutable for sensitive columns
CREATE OR REPLACE FUNCTION preserve_non_admin_fields()
RETURNS TRIGGER 
SET search_path TO public, auth, pg_catalog
AS $$
BEGIN
  -- Only run for updates, and only when the user is not an admin
  IF TG_OP = 'UPDATE'
     AND auth.uid() IS NOT NULL
     AND get_my_role() <> 'admin' THEN

    NEW.role        := OLD.role;
    NEW.entity_id   := OLD.entity_id;
    NEW.division_id := OLD.division_id;
    NEW.manager_id  := OLD.manager_id;
    NEW.title_id    := OLD.title_id;
    NEW.status      := OLD.status;
    NEW.is_active   := OLD.is_active;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
-- -----

CREATE OR REPLACE FUNCTION get_my_profile() -- duplicated for clarity
RETURNS TABLE (role text, entity_id uuid, division_id uuid) 
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, auth
AS $$
  SELECT role, entity_id, division_id 
  FROM public.user_profiles 
  WHERE user_id = auth.uid();
$$;

DROP POLICY IF EXISTS user_profiles_select ON public.user_profiles;
CREATE POLICY user_profiles_select ON public.user_profiles
FOR SELECT TO authenticated
USING (
  user_id = auth.uid() -- Own profile
  OR EXISTS (
    SELECT 1 FROM get_my_profile() me
    WHERE (me.role = 'admin') -- Admin sees all
       OR (me.role = 'head' AND me.entity_id = public.user_profiles.entity_id)
       OR (me.role IN ('manager', 'account_manager', 'staff') AND me.entity_id = public.user_profiles.entity_id AND me.division_id = public.user_profiles.division_id)
  )
);

-- ============================================================================
-- Add search paths to existing user managerment functions
-- ============================================================================

DROP FUNCTION IF EXISTS public._get_effective_user_profile(UUID);

CREATE OR REPLACE FUNCTION public._get_effective_user_profile(p_user_id UUID DEFAULT NULL)
RETURNS TABLE (
  user_id UUID, 
  profile_id UUID, 
  role role_enum, 
  entity_id UUID,
  division_id UUID
)
LANGUAGE sql
SECURITY INVOKER
SET search_path TO public, auth
AS $$
  SELECT 
    up.user_id,
    up.id AS profile_id,
    up.role,
    up.entity_id,
    up.division_id -- This is now semantically "team_id"
  FROM public.user_profiles up
  WHERE up.user_id = COALESCE(p_user_id, auth.uid())
  LIMIT 1;
$$;

COMMENT ON FUNCTION public._get_effective_user_profile IS 
'Returns user profile info including entity_id and team (division_id). Used by entity-scoped RPCs.';

GRANT EXECUTE ON FUNCTION public._get_effective_user_profile(UUID) TO authenticated;

COMMIT;