import { CoreProviders } from "@domain-ui/core/ui/components/providers/CoreProviders";
import { CoreRouting } from "@domain-ui/core/ui/components/routing/CoreRouting";

/**
 * Main application assembly.
 * Combines global providers with the primary SPA routing manifest.
 */
function App() {
  return (
    <CoreProviders>
      <CoreRouting />
    </CoreProviders>
  );
}

export default App;
