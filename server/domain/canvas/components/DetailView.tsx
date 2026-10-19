import React from 'react';

interface DetailViewProps {
  data: Record<string, any>;
}

const DetailView: React.FC<DetailViewProps> = ({ data }) => {
  if (!data) {
    return <p>No data to display.</p>;
  }

  return (
    <div className="bg-card shadow-md rounded-lg p-4">
      <h2 className="text-xl font-semibold mb-4">Details</h2>
      <div className="space-y-2">
        {Object.entries(data).map(([key, value]) => (
          <div key={key} className="flex">
            <strong className="w-1/3 text-muted-foreground">{key}:</strong>
            <span className="w-2/3 text-foreground">
              {typeof value === 'object' && value !== null ? JSON.stringify(value) : value}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
};

export default DetailView;
