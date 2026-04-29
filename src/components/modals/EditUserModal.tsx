import { useState, useEffect } from 'react';
import { Check, Trash2, X } from 'lucide-react';
import { toast } from "sonner";
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { RoleBadge } from '@/components/RoleBadge';
import { UserProfile } from '@/hooks/useProfile';
import { supabase } from '@/integrations/supabase/client';

interface UserRow {
  id: string;
  full_name: string | null;
  email: string | null;
  role: UserProfile['role'];
  title_id: string | null;
  entity_id: string | null;
  division_id: string | null;
  manager_id: string | null;
}

interface Entity { id: string; name: string; is_active: boolean; }
interface Division { id: string; name: string; }
interface Title { id: string; name: string; is_active: boolean; }

interface EditUserModalProps {
  user: UserRow | null;
  open: boolean;
  onClose: () => void;
  onSave: (
    userId: string,
    role: string,
    entityId: string | null,
    divisionId: string | null,
    managerId: string | null,
  ) => Promise<{ success: boolean; error?: string }>;
  onDelete: (userId: string) => Promise<{ success: boolean; error?: string; message?: string }>;
  entities: Entity[];
  divisions: Division[];
  titles: Title[];
  currentUserRole: UserProfile['role'] | undefined;
  currentUserId: string | undefined;
}

const EditUserModal = ({
  user, open, onClose, onSave, onDelete,
  entities, divisions, titles, currentUserRole, currentUserId,
}: EditUserModalProps) => {
  const [role, setRole] = useState<UserProfile['role']>('pending');
  const [titleId, setTitleId] = useState<string>('');
  const [entityId, setEntityId] = useState<string>('none');
  const [divisionId, setDivisionId] = useState<string>('none');
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  // Sync local state when user changes
  useEffect(() => {
    //console.log('EditUserModal user:', user);
    if (user) {
      setRole(user.role);
      setTitleId(user.title_id ?? '');
      setEntityId(user.entity_id || 'none');
      setDivisionId(user.division_id ?? 'none');
      setConfirmDelete(false);
    }
  }, [user]);

  if (!user) return null;

  const isSelf = user.id === currentUserId;
  const isAdminTarget = user.role === 'admin';
  const canManage = currentUserRole === 'admin'
    ? !isSelf
    : currentUserRole === 'manager'
      ? user.role !== 'admin' && user.role !== 'manager'
      : false;

  const isDirty =
    role !== user.role ||
    (titleId || '') !== (user.title_id ?? '') ||
    (entityId === 'none' ? null : entityId) !== user.entity_id ||
    (divisionId === 'none' ? null : divisionId) !== user.division_id;

  const handleSave = async () => {
    setSaving(true);

    if (role === 'account_manager' && divisionId !== 'none') {
      const { data } = await supabase
        .from('user_profiles')
        .select('id')
        .eq('division_id', divisionId)
        .eq('role', 'manager')
        .maybeSingle();

      if (!data) {
        setSaving(false);
        toast.error(
          "The selected division has no manager. Please assign one first."
        );
        return;
      }
    }
      
    const result = await onSave(
      user.id,
      role,
      entityId === 'none' ? null : entityId,
      divisionId === 'none' ? null : divisionId,
      user.manager_id ?? null,
    );
    setSaving(false);
    if (result.success) onClose();
  };

  const handleDelete = async () => {
    if (!confirmDelete) { setConfirmDelete(true); return; }
    setDeleting(true);
    const result = await onDelete(user.id);
    setDeleting(false);
    if (result.success) onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="sm:max-w-[525px] max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {user.full_name || user.email || 'User'}
          </DialogTitle>
          <p className="text-sm text-muted-foreground">{user.email}</p>
        </DialogHeader>

        {!canManage ? (
          <div className="py-4 space-y-2">
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">Role:</span>
              <RoleBadge role={user.role} />
            </div>
            <p className="text-xs text-muted-foreground">You don't have permission to edit this user.</p>
          </div>
        ) : (
          <div className="space-y-4 py-2">
            {/* Role */}
            <div className="space-y-1">
              <Label>Role</Label>
              <Select
                value={role}
                onValueChange={(v) => setRole(v as UserProfile['role'])}
                disabled={saving || isSelf || isAdminTarget}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="pending">Pending Assignment</SelectItem>
                  <SelectItem value="account_manager">Field Sales Staff</SelectItem>
                  <SelectItem value="staff">Staff</SelectItem>
                  <SelectItem value="manager">Level Manager</SelectItem>
                  <SelectItem value="head">Level Head</SelectItem>
                  <SelectItem value="admin">System Administrator</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Title */}
            <div className="space-y-1">
              <Label>Title</Label>
              <Select
                value={titleId || 'none'}
                onValueChange={(v) => setTitleId(v === 'none' ? '' : v)}
                disabled={saving}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Optional" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">
                    <span className="text-muted-foreground">No Title</span>
                  </SelectItem>
                  {titles
                    .filter((t) => t.is_active && t.id?.trim())
                    .map((t) => (
                      <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>

            {/* Entity */}
            <div className="space-y-1">
              <Label>Entity</Label>
              <Select value={entityId} onValueChange={setEntityId} disabled={saving}>
                <SelectTrigger>
                  <SelectValue placeholder="Select entity" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">
                    <span className="text-muted-foreground">No Entity</span>
                  </SelectItem>
                  {entities
                    .filter((e) => e.is_active && e.id?.trim())
                    .map((e) => (
                      <SelectItem key={e.id} value={e.id}>{e.name}</SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>

            {/* Team / Division */}
            <div className="space-y-1">
              <Label>Team</Label>
              <Select value={divisionId} onValueChange={setDivisionId} disabled={saving}>
                <SelectTrigger>
                  <SelectValue placeholder="Select team" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">
                    <span className="text-muted-foreground">No Team</span>
                  </SelectItem>
                  {divisions.map((d) => (
                    <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        )}

        <DialogFooter className="flex-col sm:flex-row gap-2">
          {canManage && (
            <>
              {/* Delete — two-step confirm */}
              <Button
                variant={confirmDelete ? 'destructive' : 'outline'}
                size="sm"
                onClick={handleDelete}
                disabled={deleting || saving || isSelf || isAdminTarget}
                className="mr-auto"
              >
                <Trash2 className="h-3.5 w-3.5 mr-1.5" />
                {confirmDelete ? '' : ''} {/* confirmDelete ? 'Confirm' : 'Delete' */}
              </Button>
              {confirmDelete && (
                <Button variant="ghost" size="sm" onClick={() => setConfirmDelete(false)}>
                  <X className="h-3.5 w-3.5 mr-1" />  
                </Button>
              )}

              <Button variant="outline" size="sm" onClick={onClose} disabled={saving}>
                Close
              </Button>
              <Button size="sm" onClick={handleSave} disabled={saving || !isDirty}>
                {saving
                  ? <><div className="h-3 w-3 animate-spin border border-current border-t-transparent rounded-full mr-2" />Saving…</>
                  : <><Check className="h-3.5 w-3.5 mr-1.5" />Save changes</>
                }
              </Button>
            </>
          )}
          {!canManage && (
            <Button variant="outline" size="sm" onClick={onClose}>Close</Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default EditUserModal;
