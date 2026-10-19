import { useEffect } from "react"
import {
  Toast,
  ToastClose,
  ToastDescription,
  ToastProvider,
  ToastTitle,
  ToastViewport,
} from "@domain-ui/core/ui/components/ui/toast"
import { useToast, toast } from "@domain-ui/core/ui/hooks/use-toast"

export function Toaster() {
  const { toasts } = useToast()

  useEffect(() => {
    const handleCustomToast = (e: Event) => {
      const customEvent = e as CustomEvent<{
        title?: string;
        description?: string;
        variant?: "default" | "destructive";
      }>;
      if (customEvent.detail) {
        toast({
          title: customEvent.detail.title,
          description: customEvent.detail.description,
          variant: customEvent.detail.variant,
        });
      }
    };
    window.addEventListener("oddjob:toast", handleCustomToast);
    return () => window.removeEventListener("oddjob:toast", handleCustomToast);
  }, []);

  return (
    <ToastProvider>
      {toasts.map(function ({ id, title, description, action, ...props }) {
        return (
          <Toast key={id} {...props}>
            <div className="grid gap-1">
              {title && <ToastTitle>{title}</ToastTitle>}
              {description && (
                <ToastDescription>{description}</ToastDescription>
              )}
            </div>
            {action}
            <ToastClose />
          </Toast>
        )
      })}
      <ToastViewport />
    </ToastProvider>
  )
}


