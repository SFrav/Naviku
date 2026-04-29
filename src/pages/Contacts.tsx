import { useState, useCallback, useEffect } from 'react';
import { ContactsTable } from '@/components/ContactsTable';
import { EditContactModal, ContactFormData } from '@/components/modals/EditContactModal';
import MinimisedContactsBar, { MinimisedContact } from '@/components/MinimisedContactsBar';
import { Contact } from '@/hooks/useContacts';

const MAX_MINIMISED = 3;
const STORAGE_KEY = 'contacts_minimised_tabs';

const loadFromStorage = (): MinimisedContact[] => {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
};

const saveToStorage = (tabs: MinimisedContact[]) => {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(tabs));
  } catch {}
};

export default function Contacts() {
  const [editingContact, setEditingContact] = useState<Contact | null>(null);
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [restoredFormData, setRestoredFormData] = useState<ContactFormData | null>(null);
  const [minimised, setMinimised] = useState<MinimisedContact[]>(loadFromStorage);

  useEffect(() => {
    saveToStorage(minimised);
  }, [minimised]);

  const handleContactUpdated = useCallback(() => {
    setRefreshKey(k => k + 1);
  }, []);

  const handleEditContact = useCallback((contact: Contact) => {
    const existing = minimised.find(m => m.contact.id === contact.id);
    if (existing) {
      handleRestore(contact.id);
      return;
    }
    setRestoredFormData(null);
    setEditingContact(contact);
    setIsEditOpen(true);
  }, [minimised]);

  const handleMinimise = useCallback((contact: Contact, isDirty: boolean, formData: ContactFormData) => {
    setIsEditOpen(false);
    setMinimised(prev => {
      const without = prev.filter(m => m.contact.id !== contact.id);
      const capped = without.length >= MAX_MINIMISED ? without.slice(1) : without;
      return [...capped, { contact, isDirty, savedFormData: formData } as any];
    });
  }, []);

  const handleRestore = useCallback((id: string) => {
    const entry = minimised.find(m => m.contact.id === id) as any;
    if (!entry) return;
    setMinimised(prev => prev.filter(m => m.contact.id !== id));
    setRestoredFormData(entry.savedFormData ?? null);
    setEditingContact(entry.contact as Contact);
    setIsEditOpen(true);
  }, [minimised]);

  const handleDiscard = useCallback((id: string) => {
    setMinimised(prev => prev.filter(m => m.contact.id !== id));
  }, []);

  const handleClose = useCallback(() => {
    setIsEditOpen(false);
    setEditingContact(null);
    setRestoredFormData(null);
  }, []);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold text-foreground">Contacts</h1>
      </div>

      <ContactsTable key={refreshKey} onEditContact={handleEditContact} />

      <EditContactModal
        isOpen={isEditOpen}
        onClose={handleClose}
        onContactUpdated={handleContactUpdated}
        onMinimise={handleMinimise}
        contact={editingContact}
        restoredFormData={restoredFormData}
        maxMinimised={MAX_MINIMISED}
        currentMinimisedCount={minimised.length}
      />

      <MinimisedContactsBar minimised={minimised} onRestore={handleRestore} onDiscard={handleDiscard} />
    </div>
  );
}