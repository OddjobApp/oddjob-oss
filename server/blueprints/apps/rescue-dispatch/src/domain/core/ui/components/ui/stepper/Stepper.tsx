
import React from 'react';
import { Check, Circle } from 'lucide-react';

interface StepProps {
  index: number;
  title: string;
  isCurrent: boolean;
  isCompleted: boolean;
}

export const Step = ({ index, title, isCurrent, isCompleted }: StepProps) => {
  return (
    <div className="flex items-start">
      <div className="flex flex-col items-center mr-4">
        <div
          className={`w-8 h-8 rounded-full flex items-center justify-center transition-all duration-300 ${
            isCurrent ? 'bg-primary text-primary-foreground' : 
            isCompleted ? 'bg-green-500 text-white' : 'bg-muted text-muted-foreground'
          }`}>
          {isCompleted ? <Check className="w-5 h-5" /> : <span className="font-bold">{index + 1}</span>}
        </div>
        <div className="w-px h-8 bg-border mt-2" />
      </div>
      <div>
        <p className={`font-semibold ${isCurrent ? 'text-primary' : 'text-foreground'}`}>{title}</p>
      </div>
    </div>
  );
};

interface StepperProps {
  children: React.ReactElement<StepProps>[];
  currentStep: number;
  orientation?: 'vertical' | 'horizontal';
}

export const Stepper = ({ children, currentStep, orientation = 'vertical' }: StepperProps) => {
  const steps = React.Children.map(children, (child, index) => {
    if (React.isValidElement<StepProps>(child)) {
      return React.cloneElement(child, {
        index,
        isCurrent: index === currentStep,
        isCompleted: index < currentStep,
      });
    }
    return child;
  });

  return (
    <div className={`flex ${orientation === 'vertical' ? 'flex-col' : 'flex-row'}`}>
      {steps}
    </div>
  );
};
