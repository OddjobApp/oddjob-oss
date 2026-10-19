/**
 * useDialogState Hook
 * 
 * Standardized hook for managing dialog/modal open/close state.
 * Supports multiple named dialogs and optional data passing.
 */

import { useState, useCallback, useMemo } from "react";

/**
 * State for a single dialog
 */
export interface DialogState<TData = unknown> {
  isOpen: boolean;
  data?: TData;
}

/**
 * Return type for useDialogState hook
 */
export interface UseDialogStateReturn<TData = unknown> {
  /** Whether the dialog is open */
  isOpen: boolean;
  /** Data associated with the dialog */
  data?: TData;
  /** Open the dialog, optionally with data */
  open: (data?: TData) => void;
  /** Close the dialog and clear data */
  close: () => void;
  /** Toggle the dialog state */
  toggle: () => void;
  /** Set data without changing open state */
  setData: (data: TData) => void;
}

/**
 * Simple hook for managing a single dialog's state
 * 
 * @param initialOpen - Initial open state (default: false)
 * @param initialData - Initial data
 * 
 * @example
 * ```tsx
 * function MyComponent() {
 *   const dialog = useDialogState<User>();
 * 
 *   return (
 *     <>
 *       <Button onClick={() => dialog.open(selectedUser)}>
 *         Edit User
 *       </Button>
 * 
 *       <Dialog open={dialog.isOpen} onOpenChange={open => !open && dialog.close()}>
 *         <DialogContent>
 *           <UserForm user={dialog.data} onSave={dialog.close} />
 *         </DialogContent>
 *       </Dialog>
 *     </>
 *   );
 * }
 * ```
 */
export function useDialogState<TData = unknown>(
  initialOpen = false,
  initialData?: TData
): UseDialogStateReturn<TData> {
  const [state, setState] = useState<DialogState<TData>>({
    isOpen: initialOpen,
    data: initialData,
  });

  const open = useCallback((data?: TData) => {
    setState({ isOpen: true, data });
  }, []);

  const close = useCallback(() => {
    setState({ isOpen: false, data: undefined });
  }, []);

  const toggle = useCallback(() => {
    setState(prev => ({ ...prev, isOpen: !prev.isOpen }));
  }, []);

  const setData = useCallback((data: TData) => {
    setState(prev => ({ ...prev, data }));
  }, []);

  return {
    isOpen: state.isOpen,
    data: state.data,
    open,
    close,
    toggle,
    setData,
  };
}

/**
 * Configuration for multi-dialog state
 */
export type DialogConfig<TKeys extends string> = {
  [K in TKeys]?: {
    initialOpen?: boolean;
    initialData?: unknown;
  };
};

/**
 * Return type for multi-dialog hook
 */
export type UseMultiDialogStateReturn<TKeys extends string> = {
  [K in TKeys]: UseDialogStateReturn<unknown>;
} & {
  /** Close all dialogs */
  closeAll: () => void;
  /** Check if any dialog is open */
  anyOpen: boolean;
};

/**
 * Hook for managing multiple named dialogs
 * 
 * @param dialogs - Array of dialog names
 * @param config - Optional initial configuration for each dialog
 * 
 * @example
 * ```tsx
 * function MyComponent() {
 *   const dialogs = useMultiDialogState(['create', 'edit', 'delete'] as const);
 * 
 *   return (
 *     <>
 *       <Button onClick={() => dialogs.create.open()}>Create</Button>
 *       <Button onClick={() => dialogs.edit.open(item)}>Edit</Button>
 *       <Button onClick={() => dialogs.delete.open(item)}>Delete</Button>
 * 
 *       <CreateDialog 
 *         open={dialogs.create.isOpen} 
 *         onClose={dialogs.create.close} 
 *       />
 *       <EditDialog 
 *         open={dialogs.edit.isOpen} 
 *         item={dialogs.edit.data}
 *         onClose={dialogs.edit.close} 
 *       />
 *       <DeleteConfirm 
 *         open={dialogs.delete.isOpen} 
 *         item={dialogs.delete.data}
 *         onClose={dialogs.delete.close} 
 *       />
 *     </>
 *   );
 * }
 * ```
 */
export function useMultiDialogState<TKeys extends string>(
  dialogs: readonly TKeys[],
  config?: DialogConfig<TKeys>
): UseMultiDialogStateReturn<TKeys> {
  // Create state for all dialogs
  const [states, setStates] = useState<Record<TKeys, DialogState>>(() => {
    const initial: Partial<Record<TKeys, DialogState>> = {};
    for (const key of dialogs) {
      initial[key] = {
        isOpen: config?.[key]?.initialOpen ?? false,
        data: config?.[key]?.initialData,
      };
    }
    return initial as Record<TKeys, DialogState>;
  });

  // Create handlers for each dialog
  const handlers = useMemo(() => {
    const result: Partial<Record<TKeys, UseDialogStateReturn>> = {};
    
    for (const key of dialogs) {
      result[key] = {
        get isOpen() { return states[key].isOpen; },
        get data() { return states[key].data; },
        open: (data?: unknown) => {
          setStates(prev => ({
            ...prev,
            [key]: { isOpen: true, data }
          }));
        },
        close: () => {
          setStates(prev => ({
            ...prev,
            [key]: { isOpen: false, data: undefined }
          }));
        },
        toggle: () => {
          setStates(prev => ({
            ...prev,
            [key]: { ...prev[key], isOpen: !prev[key].isOpen }
          }));
        },
        setData: (data: unknown) => {
          setStates(prev => ({
            ...prev,
            [key]: { ...prev[key], data }
          }));
        },
      };
    }
    
    return result as Record<TKeys, UseDialogStateReturn>;
  }, [dialogs, states]);

  const closeAll = useCallback(() => {
    setStates(prev => {
      const next = { ...prev };
      for (const key of dialogs) {
        next[key] = { isOpen: false, data: undefined };
      }
      return next;
    });
  }, [dialogs]);

  const anyOpen = useMemo(() => {
    return dialogs.some(key => states[key].isOpen);
  }, [dialogs, states]);

  return {
    ...handlers,
    closeAll,
    anyOpen,
  } as UseMultiDialogStateReturn<TKeys>;
}

/**
 * Hook for confirmation dialog pattern
 * 
 * @example
 * ```tsx
 * function MyComponent() {
 *   const confirm = useConfirmDialog<User>();
 * 
 *   const handleDelete = async () => {
 *     if (await confirm.show(user)) {
 *       await deleteUser(user.id);
 *     }
 *   };
 * 
 *   return (
 *     <>
 *       <Button onClick={handleDelete}>Delete</Button>
 * 
 *       <AlertDialog open={confirm.isOpen} onOpenChange={open => !open && confirm.cancel()}>
 *         <AlertDialogContent>
 *           <AlertDialogHeader>
 *             <AlertDialogTitle>Delete {confirm.data?.name}?</AlertDialogTitle>
 *           </AlertDialogHeader>
 *           <AlertDialogFooter>
 *             <AlertDialogCancel onClick={confirm.cancel}>Cancel</AlertDialogCancel>
 *             <AlertDialogAction onClick={confirm.confirm}>Delete</AlertDialogAction>
 *           </AlertDialogFooter>
 *         </AlertDialogContent>
 *       </AlertDialog>
 *     </>
 *   );
 * }
 * ```
 */
export function useConfirmDialog<TData = unknown>() {
  const [state, setState] = useState<{
    isOpen: boolean;
    data?: TData;
    resolve?: (confirmed: boolean) => void;
  }>({
    isOpen: false,
  });

  const show = useCallback((data?: TData): Promise<boolean> => {
    return new Promise(resolve => {
      setState({ isOpen: true, data, resolve });
    });
  }, []);

  const confirm = useCallback(() => {
    state.resolve?.(true);
    setState({ isOpen: false });
  }, [state.resolve]);

  const cancel = useCallback(() => {
    state.resolve?.(false);
    setState({ isOpen: false });
  }, [state.resolve]);

  return {
    isOpen: state.isOpen,
    data: state.data,
    show,
    confirm,
    cancel,
  };
}

export default useDialogState;
