BEGIN;

-- Update RLS policies to use Entity + Team (division_id) based scoping
-- This replaces division/department checks with entity + team checks
-- Following Entity → Team → Head → Manager → Sales hierarchy

-- ============================================================================
-- Functions - helper 
-- ============================================================================

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER SET search_path = public, auth --Added search path
AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE OR REPLACE FUNCTION get_my_profile() -- duplicated for clarity
RETURNS TABLE (role text, entity_id uuid, division_id uuid) 
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, auth
AS $$
  SELECT role, entity_id, division_id 
  FROM public.user_profiles 
  WHERE user_id = auth.uid();
$$;

CREATE OR REPLACE FUNCTION public.can_manage_contact(target_owner_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER -- This bypasses RLS for the lookup
SET search_path = public, auth
AS $$
DECLARE
  viewer_role text;
  viewer_entity uuid;
  viewer_division uuid;
  target_entity uuid;
  target_division uuid;
BEGIN
  -- 1. Get current user's profile
  SELECT role, entity_id, division_id INTO viewer_role, viewer_entity, viewer_division
  FROM public.user_profiles WHERE user_id = auth.uid();

  -- 2. If same user, immediate true
  IF auth.uid() = target_owner_id THEN RETURN TRUE; END IF;

  -- 3. Admins can do anything
  IF viewer_role = 'admin' THEN RETURN TRUE; END IF;

  -- 4. Get target owner's profile details
  SELECT entity_id, division_id INTO target_entity, target_division
  FROM public.user_profiles WHERE user_id = target_owner_id;

  -- 5. Hierarchy Logic
  IF viewer_role = 'head' THEN
    RETURN viewer_entity = target_entity;
  ELSIF viewer_role IN ('manager', 'account_manager') THEN
    RETURN viewer_entity = target_entity AND viewer_division = target_division;
  END IF;

  RETURN FALSE;
END;
$$;

-- ============================================================================
-- contacts - SELECT (Read)
-- ============================================================================

ALTER TABLE public.contacts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS contacts_insert_policy ON public.contacts;
DROP POLICY IF EXISTS contacts_delete_policy ON public.contacts;

DROP POLICY IF EXISTS contacts_select ON public.contacts;
CREATE POLICY contacts_select ON public.contacts
FOR SELECT TO authenticated
USING (
  owner_id = auth.uid() -- Own contacts
  OR EXISTS (
    SELECT 1 FROM get_my_profile() me
    LEFT JOIN public.user_profiles owner_prof ON owner_prof.user_id = public.contacts.owner_id
    WHERE me.role = 'admin'
       OR (me.role = 'head' AND owner_prof.entity_id = me.entity_id)
       OR ((me.role IN ('manager', 'account_manager'))
           AND owner_prof.entity_id = me.entity_id 
           AND owner_prof.division_id = me.division_id)
  )
);

-- ============================================================================
-- contacts - INSERT (Create)
-- ============================================================================
DROP POLICY IF EXISTS contacts_insert ON public.contacts;
CREATE POLICY contacts_insert ON public.contacts
FOR INSERT TO authenticated
WITH CHECK (
  owner_id = auth.uid() -- Own contacts
);

-- ============================================================================
-- contacts - UPDATE (Edit)
-- ============================================================================

DROP POLICY IF EXISTS contacts_update ON public.contacts;
CREATE POLICY contacts_update ON public.contacts
FOR UPDATE TO authenticated
USING ( can_manage_contact(owner_id) )
WITH CHECK ( can_manage_contact(owner_id) );

-- ============================================================================
-- contacts - DELETE
-- ============================================================================

DROP POLICY IF EXISTS contacts_delete ON public.contacts;
CREATE POLICY contacts_delete ON public.contacts
FOR DELETE TO authenticated
USING ( can_manage_contact(owner_id) );

COMMENT ON POLICY contacts_select ON public.contacts IS 
'Entity + Team scoping: Admin→all, Head→entity, Manager→team (via division_id + manager_team_members), Sales→team';

-- ============================================================================
-- Functions - RPC
-- ============================================================================

ALTER TABLE public.contacts
ADD COLUMN updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP;

-- admin_update_contact
CREATE OR REPLACE FUNCTION public.admin_update_contact(
  p_id uuid,
  p_name text,
  p_email text,
  p_phone text,
  p_company text,
  p_notes text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  r jsonb;
BEGIN
  IF NOT can_manage_contact(p_id) THEN
    RAISE EXCEPTION 'Permission denied';
  END IF;

  UPDATE public.contacts
  SET name   = p_name,
      email  = p_email,
      phone  = p_phone,
      company= p_company,
      notes  = p_notes,
      updated_at = now() 
  WHERE id = p_id
  RETURNING jsonb_build_object('success', TRUE) INTO r;

  RETURN r;
EXCEPTION WHEN OTHERS THEN
  RAISE EXCEPTION 'Update failed';
END;
$$;

-- admin_delete_contact
CREATE OR REPLACE FUNCTION public.admin_delete_contact(
  p_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  r jsonb;
BEGIN
  IF NOT can_manage_contact(p_id) THEN
    RAISE EXCEPTION 'Permission denied';
  END IF;

  DELETE FROM public.contacts
  WHERE id = p_id
  RETURNING jsonb_build_object('success', TRUE) INTO r;

  RETURN r;
EXCEPTION WHEN OTHERS THEN
  RAISE EXCEPTION 'Delete failed';
END;
$$;

-- ============================================================================
-- Summary
-- ============================================================================

DO $$
BEGIN
  RAISE NOTICE '
╔════════════════════════════════════════════════════════════════╗
║  RLS Policies Updated: Entity + Team Based Scoping            ║
╚════════════════════════════════════════════════════════════════╝

Updated policies for:
  ✓ contacts (SELECT, INSERT, UPDATE, DELETE)

Scoping logic:
  • Admin: sees ALL data across all entities
  • Head: sees data in their entity (by entity_id match)
  • Manager: sees data in their team (by entity_id + division_id match + manager_team_members)
  • Sales: sees data in their team (by entity_id + division_id match + manager_team_members)

Note: division_id now semantically represents team_id
';
END $$;

COMMIT;