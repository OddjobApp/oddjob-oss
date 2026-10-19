/**
 * Shared API client for making HTTP requests
 */
export async function apiRequest<T>(
  url: string,
  options: RequestInit = {}
): Promise<T> {
  const response = await fetch(url, {
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
    ...options,
  });

  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`);
  }

  return response.json();
}

export const api = {
  get: <T>(url: string) => apiRequest<T>(url, { method: 'GET' }),
  post: <T>(url: string, data: any) => apiRequest<T>(url, { 
    method: 'POST', 
    body: JSON.stringify(data) 
  }),
  put: <T>(url: string, data: any) => apiRequest<T>(url, { 
    method: 'PUT', 
    body: JSON.stringify(data) 
  }),
  delete: <T>(url: string) => apiRequest<T>(url, { method: 'DELETE' }),
};
