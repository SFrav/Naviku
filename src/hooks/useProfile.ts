import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from './useAuth';

export interface UserProfile {
  id: string;
  user_id: string;
  full_name: string | null;
  email: string | null;
  phone: string | null;
  role: 'pending' | 'account_manager' | 'staff' | 'manager' | 'head' | 'admin';
  department?: string | null; // UI only, not persisted
  created_at: string;
  updated_at: string | null;
  preferences: any | null;
  division_id: string | null;
  team_id: string | null;
  entity_id: string | null;
  manager_id?: string | null;
  is_active: boolean;
  title_id: string | null;
  region_id: string | null;
  region_code: string | null;
  external_id: string | null;
  tenant_id: string | null;
  user_status: 'active' | 'inactive' | 'resigned' | 'terminated' | 'leave';
  is_deleted: boolean;
  deleted_at: string | null;
  deleted_by: string | null;
}

// Admin detection — single source of truth.
// Only used when no DB row exists (bootstrap) or to determine initial mock fallback.
const isAdminEmail = (email: string): boolean => {
  const envList = (import.meta as any).env?.VITE_ADMIN_EMAILS as string | undefined;
  const list = (envList || '')
    .split(',')
    .map((e: string) => e.trim().toLowerCase())
    .filter(Boolean);
  return list.includes(email.toLowerCase());
};

const ADMIN_UUID = ''; //@add admin uuid here

export const useProfile = () => {
  const { user, loading: authLoading } = useAuth();
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchProfile = useCallback(async () => {
    if (!user) {
      setProfile(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const { data: profileData, error: fetchError } = await supabase
        .from('user_profiles')
        .select('*')
        .eq('user_id', user.id)
        .maybeSingle();

      if (fetchError) throw fetchError;

      if (profileData && profileData.division_id) {
        const { data: div, error: divErr } = await supabase
          .from('divisions')
          .select('name')
          .eq('id', profileData.division_id)
          .single();

        if (!divErr && div) {
          // Attach the division name as the “department” field
          profileData.department = div.name;
        }
      }

      if (profileData) {
          // Row exists — always trust the DB role exactly as stored.
          // Never auto-promote here; admin assignment is done via admin_update_user_profile RPC.  
        setProfile(profileData as UserProfile); // cast after adding department
        return;
      }

      // No row found. The handle_new_auth_user trigger should have created one.
      // This path means signup trigger failed or this is a legacy admin user.
      const userEmail = user.email ?? '';
      const isAdmin = user.id === ADMIN_UUID || isAdminEmail(userEmail);

      if (isAdmin) {
        // Attempt to bootstrap via RPC (security definer, bypasses RLS)
        try {
          await supabase.rpc('ensure_admin_profile');
          const { data: bootstrapped } = await supabase
            .from('user_profiles')
            .select('*')
            .eq('user_id', user.id)
            .maybeSingle();
          if (bootstrapped) {
            setProfile(bootstrapped as UserProfile);
            return;
          }
        } catch {
          // RPC unavailable — fall through to mock
        }

        // Last resort mock — only for admin, never for regular users
        setProfile({
          id: user.id,
          user_id: user.id,
          full_name: userEmail.split('@')[0] || 'Administrator',
          email: userEmail,
          phone: null,
          role: 'admin',
          created_at: new Date().toISOString(),
          updated_at: null,
          preferences: null,
          division_id: null,
          team_id: null,
          entity_id: null,
          is_active: true,
          title_id: null,
          region_id: null,
          region_code: null,
          external_id: null,
          tenant_id: null,
          user_status: 'active',
          is_deleted: false,
          deleted_at: null,
          deleted_by: null,
        });
      } else {
        // Regular user with no profile row — trigger likely failed
        setError('Profile not found. Please contact your administrator.');
      }
    } catch (err: any) {
      console.error('useProfile fetch error:', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    if (!authLoading) fetchProfile();
  }, [authLoading, fetchProfile]);

  const updateProfile = async (updates: Partial<UserProfile>) => {
    if (!user || !profile) return { error: 'No user or profile found' };
    try {
      const { department, ...safeUpdates } = updates as any;
      const { data, error } = await supabase
        .from('user_profiles')
        .update(safeUpdates)
        .eq('user_id', user.id)
        .select()
        .single();
      if (error) throw error;
      setProfile(data as UserProfile);
      return { data, error: null };
    } catch (err: any) {
      return { data: null, error: err.message };
    }
  };

  // Role helpers
  const isAdmin = () => profile?.role === 'admin';
  const isHead = () => profile?.role === 'head';
  const isManager = () => profile?.role === 'manager';
  const isAccountManager = () => profile?.role === 'account_manager';
  const isPending = () => profile?.role === 'pending';
  const hasRole = (r: UserProfile['role']) => profile?.role === r;

  const canAccessDivisionData = () =>
    ['head', 'manager', 'admin'].includes(profile?.role ?? '');
  const canManageRoles = () =>
    ['manager', 'admin'].includes(profile?.role ?? '');

  const getRoleDisplayName = () => {
    const names: Record<string, string> = {
      admin: 'System Administrator',
      head: 'Level Head',
      manager: 'Level Manager',
      account_manager: 'Account Manager',
      staff: 'Staff',
      pending: 'Pending Approval',
    };
    return names[profile?.role ?? ''] ?? profile?.role ?? '';
  };

  return {
    profile,
    loading: loading || authLoading,
    error,
    updateProfile,
    refetch: fetchProfile,
    hasRole,
    canAccessDivisionData,
    canManageRoles,
    isAdmin,
    isHead,
    isManager,
    isAccountManager,
    isPending,
    getRoleDisplayName,
    getDisplayName: () => profile?.full_name ?? '',
    // Keep for legacy compatibility
    canAccessDepartmentData: () => ['manager', 'admin'].includes(profile?.role ?? ''),
  };
};
