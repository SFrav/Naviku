BEGIN;

-- Allow own profile edit. Add a narrow UPDATE policy restricted to safe columns only
CREATE POLICY "update_own_safe_fields" ON user_profiles
  FOR UPDATE USING (auth.uid() = user_id)
  WITH CHECK (
    auth.uid() = user_id
    -- role, entity_id, division_id, manager_id remain RPC-only
  );


-- Helper function that keeps non‑admin rows immutable for sensitive columns
CREATE OR REPLACE FUNCTION preserve_non_admin_fields()
RETURNS TRIGGER AS $$
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

--
DROP TRIGGER IF EXISTS trigger_validate_user_profile ON public.user_profiles;

-- Create the new “preserve‑non‑admin” trigger
CREATE TRIGGER trigger_preserve_non_admin_fields
  BEFORE UPDATE ON public.user_profiles
  FOR EACH ROW
  EXECUTE FUNCTION preserve_non_admin_fields();

-- Re‑create the validation trigger (it will now run *after* the preserve trigger)
CREATE TRIGGER trigger_validate_user_profile
  BEFORE INSERT OR UPDATE ON public.user_profiles
  FOR EACH ROW
  EXECUTE FUNCTION validate_user_profile_assignment();

-- Fire update_updated_at_column on updates for users 
DROP TRIGGER IF EXISTS trigger_update_updated_at ON public.user_profiles;
CREATE TRIGGER trigger_update_updated_at
  BEFORE UPDATE ON public.user_profiles
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Manager assignment validation
CREATE UNIQUE INDEX one_manager_per_division 
  ON user_profiles (division_id) 
  WHERE role = 'manager' AND is_active = true;

COMMIT;