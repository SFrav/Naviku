BEGIN;

CREATE OR REPLACE FUNCTION handle_new_auth_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER 
SET search_path = public, auth
AS $$
DECLARE
  v_full_name text;
  v_role public.role_enum;
BEGIN
  v_full_name := COALESCE(
    NEW.raw_user_meta_data->>'full_name',
    NEW.raw_user_meta_data->>'name',
    split_part(NEW.email, '@', 1)
  );

  IF LOWER(NEW.email) IN ('admin@company.com') THEN
    v_role := 'admin';
  ELSE
    v_role := 'pending';
  END IF;

  INSERT INTO public.user_profiles (
    user_id,
    full_name,
    role,
    is_active
  )
  VALUES (
    NEW.id,
    v_full_name,
    v_role,
    true
  )
  ON CONFLICT (user_id) DO NOTHING;

  RETURN NEW;
END;
$$;

ALTER TYPE role_enum ADD VALUE IF NOT EXISTS 'pending';

COMMIT;