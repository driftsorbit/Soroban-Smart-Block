import React from "react";

export interface InputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "size"> {
  label?: string;
  error?: string;
  helperText?: string;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
  size?: "sm" | "md" | "lg";
}

/**
 * Accessible input component with design token styling.
 * Supports labels, error states, helper text, and icons.
 */
export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  (
    {
      label,
      error,
      helperText,
      leftIcon,
      rightIcon,
      size = "md",
      disabled = false,
      className = "",
      style = {},
      id,
      ...props
    },
    ref
  ) => {
    const generatedId = React.useId();
    const inputId = id || `input-${generatedId}`;

    const baseStyles: React.CSSProperties = {
      width: "100%",
      fontFamily: "var(--font-family-base)",
      fontSize: "var(--font-size-base)",
      color: "var(--color-text-primary)",
      background: "var(--color-bg-secondary)",
      border: `1px solid ${error ? "var(--color-error)" : "var(--color-border-default)"}`,
      borderRadius: "var(--radius-md)",
      outline: "none",
      transition: "border-color var(--duration-normal) var(--ease-out), box-shadow var(--duration-normal) var(--ease-out)",
    };

    const sizeStyles: Record<string, React.CSSProperties> = {
      sm: {
        height: "var(--input-height-sm)",
        padding: "0 var(--spacing-2)",
        fontSize: "var(--font-size-sm)",
      },
      md: {
        height: "var(--input-height-md)",
        padding: "0 var(--spacing-3)",
        fontSize: "var(--font-size-base)",
      },
      lg: {
        height: "var(--input-height-lg)",
        padding: "0 var(--spacing-4)",
        fontSize: "var(--font-size-md)",
      },
    };

    const combinedStyle = {
      ...baseStyles,
      ...sizeStyles[size],
      paddingLeft: leftIcon ? "calc(var(--spacing-3) * 2)" : undefined,
      paddingRight: rightIcon ? "calc(var(--spacing-3) * 2)" : undefined,
      ...style,
    };

    return (
      <div style={{ display: "flex", flexDirection: "column", gap: "var(--spacing-1)" }}>
        {label && (
          <label
            htmlFor={inputId}
            style={{
              fontSize: "var(--font-size-sm)",
              fontWeight: "var(--font-weight-medium)",
              color: "var(--color-text-secondary)",
            }}
          >
            {label}
          </label>
        )}
        <div style={{ position: "relative" }}>
          {leftIcon && (
            <span
              style={{
                position: "absolute",
                left: "var(--spacing-3)",
                top: "50%",
                transform: "translateY(-50%)",
                color: "var(--color-text-tertiary)",
                pointerEvents: "none",
              }}
            >
              {leftIcon}
            </span>
          )}
          <input
            ref={ref}
            id={inputId}
            disabled={disabled}
            className={className}
            style={combinedStyle}
            aria-invalid={!!error}
            aria-describedby={error ? `${inputId}-error` : helperText ? `${inputId}-helper` : undefined}
            {...props}
          />
          {rightIcon && (
            <span
              style={{
                position: "absolute",
                right: "var(--spacing-3)",
                top: "50%",
                transform: "translateY(-50%)",
                color: "var(--color-text-tertiary)",
                pointerEvents: "none",
              }}
            >
              {rightIcon}
            </span>
          )}
        </div>
        {error && (
          <span
            id={`${inputId}-error`}
            style={{
              fontSize: "var(--font-size-xs)",
              color: "var(--color-error)",
            }}
            role="alert"
          >
            {error}
          </span>
        )}
        {helperText && !error && (
          <span
            id={`${inputId}-helper`}
            style={{
              fontSize: "var(--font-size-xs)",
              color: "var(--color-text-tertiary)",
            }}
          >
            {helperText}
          </span>
        )}
      </div>
    );
  }
);

Input.displayName = "Input";
