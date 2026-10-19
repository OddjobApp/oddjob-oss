import { useAuth } from "@domain-ui/auth/ui/modules/auth/hooks/use-auth";
import { usePulseEmitter } from "@domain-ui/core/ui/hooks/usePulseEmitter";

export default function PulseTracker() {
  const { user, isLoading } = useAuth();
  usePulseEmitter({ enabled: !!user && !isLoading });
  return null;
}

