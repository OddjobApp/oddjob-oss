import { HilRequest, HilField } from "@/lib/platform-client";

interface HILGateProps {
  request: HilRequest;
  onSubmit: (decision: Record<string, unknown>) => void;
  onCancel?: () => void;
}

export function HILGate({ request, onSubmit, onCancel }: HILGateProps) {
  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    const decision: Record<string, unknown> = {};
    
    request.fields.forEach(field => {
      const value = formData.get(field.name);
      if (field.type === "select" || field.type === "radio") {
        decision[field.name] = value;
      } else if (field.type === "slider" || field.type === "multiselect") {
        try {
          decision[field.name] = JSON.parse(value as string);
        } catch {
          decision[field.name] = value;
        }
      } else {
        decision[field.name] = value;
      }
    });
    
    onSubmit(decision);
  };

  return (
    <div className="bg-slate-900/50 border border-slate-700 rounded-lg p-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold text-white">{request.formName}</h3>
        <span className="text-xs text-slate-500">
          {new Date(request.createdAt).toLocaleString()}
        </span>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        {request.fields.map(field => (
          <div key={field.name}>
            <label className="block text-sm font-medium text-slate-300 mb-2">
              {field.label}
              {field.required && <span className="text-rose-400 ml-1">*</span>}
            </label>
            
            {field.type === "select" ? (
              <select
                name={field.name}
                required={field.required}
                className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="">Select an option</option>
                {field.options?.map(option => (
                  <option key={option} value={option}>{option}</option>
                ))}
              </select>
            ) : field.type === "textarea" ? (
              <textarea
                name={field.name}
                required={field.required}
                rows={3}
                className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder={field.required ? "Required" : "Optional"}
              />
            ) : field.type === "slider" ? (
              <input
                type="range"
                name={field.name}
                required={field.required}
                className="w-full"
              />
            ) : (
              <input
                type={field.type === "text" ? "text" : field.type}
                name={field.name}
                required={field.required}
                className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder={field.required ? "Required" : "Optional"}
              />
            )}
          </div>
        ))}

        <div className="flex gap-3 pt-4">
          <button
            type="submit"
            className="flex-1 bg-blue-600 hover:bg-blue-700 text-white font-medium py-2 px-4 rounded-lg transition-colors"
          >
            Submit Decision
          </button>
          {onCancel && (
            <button
              type="button"
              onClick={onCancel}
              className="flex-1 bg-slate-700 hover:bg-slate-600 text-white font-medium py-2 px-4 rounded-lg transition-colors"
            >
              Cancel
            </button>
          )}
        </div>
      </form>
    </div>
  );
}
