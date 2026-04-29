import React, { useState } from 'react';
import { X, Maximize2 } from 'lucide-react';
import { AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction } from '@/components/ui/alert-dialog';

export interface MinimisedContact {
  contact: {
    id: string;
    name: string;
    email: string | null;
    phone: string | null;
    company: string | null;
    notes: string | null;
  };
  isDirty: boolean;
}

interface MinimisedContactsBarProps {
  minimised: MinimisedContact[];
  onRestore: (id: string) => void;
  onDiscard: (id: string) => void;
}

const MinimisedContactsBar: React.FC<MinimisedContactsBarProps> = ({
  minimised, onRestore, onDiscard,
}) => {
  if (minimised.length === 0) return null;

  const [showUnsavedCloseWarning, setShowUnsavedCloseWarning] = useState(false);
  const [discardId, setDiscardId] = useState<string | null>(null);

  const handleDiscardClick = (id: string, isDirty: boolean) => {
    if (isDirty) {
      setDiscardId(id);
      setShowUnsavedCloseWarning(true);
    } else {
      onDiscard(id);
    }
  };

  const confirmDiscard = () => {
    if (discardId) onDiscard(discardId);
    setShowUnsavedCloseWarning(false);
    setDiscardId(null);
  };

  const cancelDiscard = () => {
    setShowUnsavedCloseWarning(false);
    setDiscardId(null);
  };

  return (
    <>
      <div className="fixed bottom-0 right-6 flex flex-col sm:flex-row sm:grid sm:grid-cols-2 gap-2 z-50 h-auto">
        {minimised.map(({ contact, isDirty }) => (
          <div
            key={contact.id}
            className="flex items-center gap-2 bg-card border border-border shadow-lg rounded-t-lg px-3 py-2 min-w-[180px] max-w-[220px] cursor-pointer hover:bg-muted/60 transition-colors"
            onClick={() => onRestore(contact.id)}
          >
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate">{contact.name}</p>
              {isDirty && (
                <p className="text-xs text-amber-500">Unsaved changes</p>
              )}
            </div>
            <button
              className="text-muted-foreground hover:text-foreground shrink-0"
              onClick={(e) => {
                e.stopPropagation();
                onRestore(contact.id);
              }}
              title="Restore"
            >
              <Maximize2 className="h-3.5 w-3.5" />
            </button>
            <button
              className="text-muted-foreground hover:text-destructive shrink-0"
              onClick={(e) => {
                e.stopPropagation();
                handleDiscardClick(contact.id, isDirty);
              }}
              title="Discard and close"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}
      </div>

      <AlertDialog
        open={showUnsavedCloseWarning}
        onOpenChange={setShowUnsavedCloseWarning}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            {/* <AlertDialogTitle>Unsaved changes</AlertDialogTitle> */}
            <AlertDialogDescription>
              You have unsaved changes
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={cancelDiscard}>Keep</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDiscard}>Discard</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
};

export default MinimisedContactsBar;
