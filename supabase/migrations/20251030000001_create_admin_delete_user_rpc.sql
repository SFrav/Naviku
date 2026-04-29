-- ========================================
-- CREATE admin_delete_user RPC FUNCTION
-- Date: 2025-10-30
-- Purpose: Allow admin to delete users safely
-- ========================================

-- Drop existing function if exists
DROP FUNCTION IF EXISTS public.admin_delete_user(uuid);

-- Create admin_delete_user function
CREATE OR REPLACE FUNCTION public.admin_delete_user(p_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid;
  v_profile_id uuid;
  v_role text;
  v_result jsonb;
BEGIN
  -- Get current user's role
  SELECT role INTO v_role
  FROM user_profiles
  WHERE user_id = auth.uid();

  -- Check if current user is admin
  IF v_role != 'admin' THEN
    RAISE EXCEPTION 'Only admins can delete users';
  END IF;

  -- Try to find user_profiles record by id (could be profile_id)
  SELECT id, user_id INTO v_profile_id, v_user_id
  FROM user_profiles
  WHERE id = p_id;

  -- If not found, try by user_id
  IF v_profile_id IS NULL THEN
    SELECT id, user_id INTO v_profile_id, v_user_id
    FROM user_profiles
    WHERE user_id = p_id;
  END IF;

  -- If still not found, return error
  IF v_profile_id IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'User not found'
    );
  END IF;

  -- Prevent deleting admin users
  SELECT role INTO v_role
  FROM user_profiles
  WHERE id = v_profile_id;

  IF v_role = 'admin' THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Cannot delete admin users'
    );
  END IF;

  -- Prevent self-deletion
  IF v_user_id = auth.uid() THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Cannot delete your own account'
    );
  END IF;

  -- Delete related records first (to avoid foreign key constraints)
  
  -- Delete manager team member mappings
  DELETE FROM manager_team_members
  WHERE manager_id = v_profile_id OR account_manager_id = v_profile_id;

  -- Delete sales targets assigned to this user
  DELETE FROM sales_targets
  WHERE assigned_to = v_profile_id;

  -- Delete sales targets assigned by this user
  DELETE FROM sales_targets
  WHERE assigned_by = v_profile_id;

  -- Update opportunities ownership (set to NULL or assign to admin)
  -- Option 1: Set owner_id to NULL
  UPDATE opportunities
  SET owner_id = NULL, created_by = NULL
  WHERE owner_id = v_user_id;

  -- Update projects created by this user
  -- We keep projects but nullify the creator reference
  -- (Projects are typically tied to opportunities, not users)
  
  -- Delete sales activities
  DELETE FROM sales_activity_v2
  WHERE created_by = v_user_id;

  -- Delete pipeline items ownership references
  -- (Pipeline items are tied to opportunities, not users directly)
  
  -- Delete deals if any
  DELETE FROM deals
  WHERE user_id = v_user_id;

  -- Now delete the user profile
  DELETE FROM user_profiles
  WHERE id = v_profile_id;

  -- Note: We do NOT delete from auth.users
  -- That should be done via Supabase Auth API or Dashboard
  -- Deleting auth.users requires special permissions

  RETURN jsonb_build_object(
    'success', true,
    'message', 'User profile deleted successfully. Auth user still exists in auth.users'
  );

EXCEPTION
  WHEN OTHERS THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', SQLERRM
    );
END;
$$;

-- Grant execute permission to authenticated users
-- (Function itself checks for admin role)
GRANT EXECUTE ON FUNCTION public.admin_delete_user(uuid) TO authenticated;

-- Add comment
COMMENT ON FUNCTION public.admin_delete_user(uuid) IS 
'Allows admin to delete a user profile and related data. Does not delete auth.users record.';

