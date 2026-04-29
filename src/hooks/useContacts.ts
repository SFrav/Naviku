import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

export interface Contact {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  company: string | null;
  notes: string | null;
  created_at: string;
}

export interface UseContactsReturn {
  contacts: Contact[];
  loading: boolean;
  error?: string;
  refetch: () => Promise<void>;
  updateContact: (c: Contact) => Promise<{ success: boolean; error?: string }>;
  deleteContact: (id: string) => Promise<{ success: boolean; error?: string }>;
}

export const useContacts = (): UseContactsReturn => {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | undefined>(undefined);
  const { toast } = useToast();

  const fetch = useCallback(async () => {
    setLoading(true);
    setError(undefined);
    try {
      const { data, error: err } = await supabase
        .from('contacts')
        .select('*')
        .order('created_at', { ascending: false });

      if (err) throw err;
      setContacts(data ?? []);
    } catch (err: any) {
      console.error('Contacts fetch error', err);
      setError(err.message || 'Failed to load contacts');
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    fetch();
  }, [fetch]);

  const refetch = useCallback(async () => {
    await fetch();
  }, [fetch]);

  const updateContact = useCallback(
    async (c: Contact) => {
      const { error: rpcError } = await supabase.rpc('admin_update_contact', {
        p_id: c.id,
        p_name: c.name,
        p_email: c.email,
        p_phone: c.phone,
        p_company: c.company,
        p_notes: c.notes,
      });

      if (rpcError) {
        console.error('Update RPC error', rpcError);
        toast({ title: 'Error', description: rpcError.message, variant: 'destructive' });
        return { success: false, error: rpcError.message };
      }

      toast({ title: 'Success', description: 'Contact updated successfully' });
      return { success: true };
    },
    [toast]
  );

  const deleteContact = useCallback(
    async (id: string) => {
      const { error: rpcError } = await supabase.rpc('admin_delete_contact', {
        p_id: id,
      });

      if (rpcError) {
        console.error('Delete RPC error', rpcError);
        toast({ title: 'Error', description: rpcError.message, variant: 'destructive' });
        return { success: false, error: rpcError.message };
      }

      toast({ title: 'Success', description: 'Contact deleted successfully' });
      return { success: true };
    },
    [toast]
  );

  return {
    contacts,
    loading,
    error,
    refetch,
    updateContact,
    deleteContact,
  };
};
