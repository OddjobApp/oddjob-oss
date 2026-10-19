import React, { useState } from 'react';

interface FormProps {
  schema: Record<string, { type: string; label: string }>;
  onSubmit: (formData: Record<string, any>) => void;
}

const Form: React.FC<FormProps> = ({ schema, onSubmit }) => {
  const [formData, setFormData] = useState<Record<string, any>>({});

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit(formData);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4 p-4 bg-card shadow-md rounded-lg">
      {Object.entries(schema).map(([name, { type, label }]) => (
        <div key={name} className="flex flex-col">
          <label htmlFor={name} className="mb-1 text-sm font-medium text-foreground">
            {label}
          </label>
          <input
            type={type}
            id={name}
            name={name}
            onChange={handleChange}
            className="px-3 py-2 border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
      ))}
      <button
        type="submit"
        className="w-full px-4 py-2 text-foreground bg-blue-600 rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
      >
        Submit
      </button>
    </form>
  );
};

export default Form;
