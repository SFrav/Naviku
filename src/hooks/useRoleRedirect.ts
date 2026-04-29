import { useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useProfile } from './useProfile';

export const useRoleRedirect = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { profile, loading } = useProfile();

  useEffect(() => {
    if (loading || !profile) return;

    // Don't redirect if user is already on the correct page or on auth/pending pages
    const currentPath = location.pathname;
    if (currentPath === '/auth' || currentPath === '/pending') return;

    // Check for dashboard routes (old and new patterns)
    const isDashboardRoute = currentPath.startsWith('/dashboard/') || 
                           currentPath.endsWith('-dashboard');
    const isRootRoute = currentPath === '/';
    
    // Only redirect if on root or accessing wrong dashboard
    if (!isDashboardRoute && !isRootRoute) {
      return;
    }

    // Redirect based on role to new dashboard routes
    switch (profile.role) {
      case 'staff':
        if (isRootRoute || (isDashboardRoute && currentPath !== '/sales-dashboard')) {
          navigate('/sales-dashboard', { replace: true });
        }
        break;
      case 'account_manager':
        if (isRootRoute || (isDashboardRoute && currentPath !== '/sales-dashboard')) {
          navigate('/sales-dashboard', { replace: true });
        }
        break;
      case 'head':
        if (isRootRoute || (isDashboardRoute && currentPath !== '/executive-dashboard')) {
          navigate('/executive-dashboard', { replace: true });
        }
        break;
      case 'manager':
        if (isRootRoute || (isDashboardRoute && currentPath !== '/team-dashboard')) {
          navigate('/team-dashboard', { replace: true });
        }
        break;
      case 'admin':
        if (isRootRoute || (isDashboardRoute && currentPath !== '/admin-dashboard')) {
          navigate('/admin-dashboard', { replace: true });
        }
        break;
      default:
        navigate('/auth', { replace: true });
    }
  }, [profile, loading, navigate, location.pathname]);

  return { profile, loading };
};