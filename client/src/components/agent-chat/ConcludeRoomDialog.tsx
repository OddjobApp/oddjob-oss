import React from 'react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

export interface ConcludeRoomDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
}

export function ConcludeRoomDialog({
  open,
  onOpenChange,
  onConfirm,
}: ConcludeRoomDialogProps) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent data-testid="conclude-room-dialog">
        <AlertDialogHeader>
          <AlertDialogTitle>Close this room?</AlertDialogTitle>
          <AlertDialogDescription>
            This closes the room and generates an Executive Closing Report linking every
            decision, work product, attachment and next step. The room can be re-opened
            afterwards, but the report is written now.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Keep it open</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm} data-testid="conclude-room-confirm">
            Close and report
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
