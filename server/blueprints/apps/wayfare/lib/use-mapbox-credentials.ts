import { useEffect, useState } from "react";
import { tripsRequest } from "./platform-client";

export type MapboxCredentials = {
  credentials: Array<{ id: number; name: string }>;
  credentialId: string;
  setCredentialId: (id: string) => void;
  error: string;
  reload: () => Promise<void>;
};

/** The organization's stored Mapbox credentials; one is preselected when it is the only one. */
export function useMapboxCredentials(): MapboxCredentials {
  const [credentials, setCredentials] = useState<
      Array<{ id: number; name: string }>
    >([]),
    [credentialId, setCredentialId] = useState(""),
    [error, setError] = useState("");
  async function reload() {
    setError("");
    try {
      const data = await tripsRequest<{
        credentials: Array<{ id: number; name: string }>;
      }>(undefined, "/mapbox");
      if (!Array.isArray(data.credentials))
        throw new Error("Mapbox configuration response was invalid.");
      setCredentials(data.credentials);
      if (data.credentials.length === 1)
        setCredentialId(String(data.credentials[0].id));
      if (!data.credentials.length)
        setError(
          "No organization Mapbox credential found. Add a stored credential named Mapbox using a public pk. access token.",
        );
    } catch (e) {
      setError((e as Error).message);
    }
  }
  useEffect(() => {
    void reload();
  }, []);
  return { credentials, credentialId, setCredentialId, error, reload };
}
