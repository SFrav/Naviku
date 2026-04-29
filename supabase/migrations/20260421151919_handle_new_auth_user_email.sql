BEGIN;

CREATE OR REPLACE FUNCTION handle_new_auth_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER 
SET search_path = public, auth
AS $$
DECLARE
  v_full_name text;
  v_email text;
  v_role role_enum;
BEGIN
  v_email := NEW.email;
  v_full_name := COALESCE(
    NEW.raw_user_meta_data->>'full_name',
    NEW.raw_user_meta_data->>'name',
    split_part(NEW.email, '@', 1)
  );

  v_role := 'pending';

  INSERT INTO public.user_profiles (
    user_id,
    email,
    full_name,
    role,
    is_active
  )
  VALUES (
    NEW.id,
    v_email,
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

