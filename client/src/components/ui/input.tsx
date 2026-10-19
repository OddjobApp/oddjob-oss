
import * as React from "react"
import { cn } from "@/lib/utils"

export interface InputProps
  extends React.InputHTMLAttributes<HTMLInputElement> {}

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, ...props }, ref) => {
    // Auto-detect input type for mobile optimization
    const inputType = type || (props.name?.toLowerCase().includes('email') ? 'email' : 
                               props.name?.toLowerCase().includes('phone') || props.name?.toLowerCase().includes('tel') ? 'tel' :
                               props.name?.toLowerCase().includes('url') ? 'url' : 'text');
    
    // Auto-detect inputMode for better mobile keyboards
    const inputMode = props.inputMode || (
      inputType === 'email' ? 'email' :
      inputType === 'tel' ? 'tel' :
      inputType === 'number' ? 'numeric' :
      inputType === 'url' ? 'url' :
      undefined
    );

    return (
      <input
        type={inputType}
        inputMode={inputMode}
        className={cn(
          "flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 min-h-[44px] touch-manipulation",
          className
        )}
        ref={ref}
        {...props}
      />
    )
  }
)
Input.displayName = "Input"

export { Input }
