import React, { useState, useEffect, useCallback } from 'react';
import { Minus, Trash2, X } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { useContacts, Contact } from '@/hooks/useContacts';

interface EditContactModalProps {
  isOpen: boolean;
  onClose: () => void;
  onContactUpdated: () => void;
  onMinimise: (contact: Contact, isDirty: boolean, formData: FormData) => void;
  contact: Contact | null;
  restoredFormData?: FormData | null;
  maxMinimised: number;
  currentMinimisedCount: number;
}

interface FormData {
  name: string;
  email: string;
  phone: string;
  company: string;
  notes: string;
}

const emptyForm: FormData = { name: '', email: '', phone: '', company: '', notes: '' };

const formFromContact = (c: Contact): FormData => ({
  name: c.name || '',
  email: c.email || '',
  phone: c.phone || '',
  company: c.company || '',
  notes: c.notes || '',
});

export const EditContactModal: React.FC<EditContactModalProps> = ({
  isOpen,
  onClose,
  onContactUpdated,
  onMinimise,
  contact,
  restoredFormData,
  maxMinimised,
  currentMinimisedCount,
}) => {
  const { toast } = useToast();
  const { deleteContact, updateContact } = useContacts();
  const [isLoading, setIsLoading] = useState(false);
  const [organisations, setOrganisations] = useState<Array<{ id: string; name: string; type: string }>>([]);
  const [formData, setFormData] = useState<FormData>(emptyForm);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [showMinimiseWarning, setShowMinimiseWarning] = useState(false);
  const [showMaxTabsWarning, setShowMaxTabsWarning] = useState(false);
  const [showUnsavedCloseWarning, setShowUnsavedCloseWarning] = useState(false);
  const [ignoreCloseWarning, setIgnoreCloseWarning] = useState(false);

  const isDirty = contact
    ? formData.name !== (contact.name || '') ||
      formData.email !== (contact.email || '') ||
      formData.phone !== (contact.phone || '') ||
      formData.company !== (contact.company || '') ||
      formData.notes !== (contact.notes || '')
    : false;

  useEffect(() => {
    if (contact && isOpen) {
      setFormData(restoredFormData ?? formFromContact(contact));
      setConfirmDelete(false);
    }
  }, [contact, isOpen, restoredFormData]);

  useEffect(() => {
    if (!isOpen) return;
    const fetchOrgs = async () => {
      try {
        const [{ data: customers }, { data: endUsers }] = await Promise.all([
          supabase
            .from('v_master_customer')
            .select('id, name')
            .eq('is_active', true)
            .order('name'),
          supabase
            .from('v_master_end_user')
            .select('id, name')
            .eq('is_active', true)
            .order('name'),
        ]);
        setOrganisations([
          ...(customers ?? []).map(i => ({ ...i, type: 'customer' })),
          ...(endUsers ?? []).map(i => ({ ...i, type: 'end_user' })),
        ]);
      } catch (e) {
        console.error('Error fetching organisations:', e);
      }
    };
    fetchOrgs();
  }, [isOpen]);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  const handleMinimiseClick = () => {
    if (currentMinimisedCount >= maxMinimised) {
      setShowMaxTabsWarning(true);
      return;
    }
    if (isDirty) {
      setShowMinimiseWarning(true);
    } else {
      doMinimise();
    }
  };

  const doMinimise = () => {
    if (!contact) return;
    onMinimise(contact, isDirty, formData);
  };

  const handleDelete = useCallback(async () => {
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    if (!contact) return;
    setDeleting(true);
    const { success, error } = await deleteContact(contact.id);
    setDeleting(false);
    if (!success) return;
    onClose();
    onContactUpdated();
  }, [confirmDelete]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!contact) return;
    if (!formData.name.trim()) {
      toast({ title: 'Error', description: 'Name is required', variant: 'destructive' });
      return;
    }
    setIsLoading(true);
    try {
      const { success, error } = await updateContact({
        id: contact.id,
        name: formData.name.trim(),
        email: formData.email.trim() || null,
        phone: formData.phone.trim() || null,
        company: formData.company.trim() || null,
        notes: formData.notes.trim() || null,
        created_at: contact.created_at,
      });
      if (!success) return;
      onContactUpdated();
      onClose();
    } catch (err) {
      console.error(err);
      toast({ title: 'Error', description: 'Failed to update contact.', variant: 'destructive' });
    } finally {
      setIsLoading(false);
    }
  };

  const handleClose = () => {
    setFormData(emptyForm);
    setIgnoreCloseWarning(false);
    setShowUnsavedCloseWarning(false);
    setConfirmDelete(false);
    setDeleting(false);
    onClose();
  };

  return (
    <>
      <Dialog
        open={isOpen}
        onOpenChange={o => {
          if (!o) {
            if (!ignoreCloseWarning && isDirty) {
              setShowUnsavedCloseWarning(true);
            } else {
              handleClose();
            }
          }
        }}
      >
        <DialogContent className="sm:max-w-[525px] max-h-[90dvh] overflow-y-auto">
          <DialogHeader>
            <div className="flex items-start justify-between">
              <div>
                <DialogTitle>Edit Contact</DialogTitle>
                <DialogDescription>Update the contact details below.</DialogDescription>
              </div>
              <button
                type="button"
                onClick={handleMinimiseClick}
                className="absolute right-10 top-4 rounded-sm opacity-70 hover:opacity-100 transition-opacity"
                title="Minimise"
              >
                <Minus className="h-4 w-4" />
              </button>
            </div>
          </DialogHeader>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="name">Name *</Label>
                <Input id="name" name="name" value={formData.name} onChange={handleInputChange} placeholder="Full name" required />
              </div>
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input id="email" name="email" type="email" value={formData.email} onChange={handleInputChange} placeholder="Email address" />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="phone">Phone</Label>
                <Input id="phone" name="phone" value={formData.phone} onChange={handleInputChange} placeholder="Phone number" />
              </div>
              <div className="space-y-2">
                <Label>Company</Label>
                <Select value={formData.company} onValueChange={v => setFormData(p => ({ ...p, company: v }))}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select company" />
                  </SelectTrigger>
                  <SelectContent>
                    {organisations
                      .filter(o => o.id?.trim() && o.name?.trim())
                      .map(o => (
                        <SelectItem key={o.id} value={o.name}>
                          {o.name} ({o.type === 'customer' ? 'Customer' : 'End User'})
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="notes">Notes</Label>
              <Textarea id="notes" name="notes" value={formData.notes} onChange={handleInputChange} placeholder="Additional notes..." rows={3} />
            </div>

            {/* Footer text - case specific warnings */}
            {(!isDirty && !confirmDelete) && <p className="text-xs invisible"> This text is invisible</p>} {/*Blank line to keep vertical space change to a minimum */}
            {(isDirty && !confirmDelete) && <p className="text-xs text-amber-500">You have unsaved changes</p>}
            {confirmDelete && <p className="text-xs text-amber-500 mb-1">Confirm delete? This cannot be reversed</p>}  

            <div className="flex justify-between gap-2 mt-2">
              <div className="flex items-center gap-2">
                <Button
                  variant={confirmDelete ? 'destructive' : 'outline'}
                  size="sm"
                  onClick={handleDelete}
                  disabled={deleting || isLoading || !contact}
                  className="mr-auto w-10 h-10"
                  type="button"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  {confirmDelete ? '' : ''} {/* confirmDelete ? 'Confirm' : 'Delete' */}
                </Button>

                {confirmDelete && (
                  <Button variant="ghost" size="sm" onClick={() => setConfirmDelete(false)} className="w-10 h-10" type="button">
                    <X className="h-3.5 w-3.5" />
                  </Button>
                )}
              </div>

              <div className="flex gap-2">
                <Button type="button" variant="outline" onClick={() => { setIgnoreCloseWarning(true); handleClose(); }} disabled={isLoading}>
                  Cancel
                </Button>
                <Button type="submit" disabled={isLoading || !isDirty}>
                  {isLoading ? 'Saving…' : 'Save changes'}
                </Button>
              </div>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={showMinimiseWarning} onOpenChange={setShowMinimiseWarning}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Unsaved changes</AlertDialogTitle>
            <AlertDialogDescription>
              You have unsaved changes for <strong>{contact?.name}</strong>. They'll be preserved in the minimised tab
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Stay here</AlertDialogCancel>
            <AlertDialogAction onClick={doMinimise}>Minimise</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={showMaxTabsWarning} onOpenChange={setShowMaxTabsWarning}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Maximum tabs reached</AlertDialogTitle>
            <AlertDialogDescription>
              The maximum number of minimised tabs is <strong>{maxMinimised}</strong>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>OK</AlertDialogCancel>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={showUnsavedCloseWarning} onOpenChange={setShowUnsavedCloseWarning}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogDescription>
              You have unsaved changes for <strong>{contact?.name}</strong>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setShowUnsavedCloseWarning(false)}>Stay</AlertDialogCancel>
            <AlertDialogAction onClick={() => { setShowUnsavedCloseWarning(false); handleClose(); }}>
              Discard
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
};

export type { FormData as ContactFormData };