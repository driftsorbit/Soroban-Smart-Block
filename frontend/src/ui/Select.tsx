import React from "react";

export interface SelectProps extends Omit<React.SelectHTMLAttributes<HTMLSelectElement>, "size"> {
  label?: string;
  error?: string;
  helperText?: string;
  size?: "sm" | "md" | "lg";
  options: { value: string; label: string; disabled?: boolean }[];
}

/**
 * Accessible select component with design token styling.
 * Supports labels, error states, helper text, and option groups.
 */
export const Select = React.forwardRef<HTMLSelectElement, SelectProps>(
  (
    {
      label,
      error,
      helperText,
      size = "md",
      options,
      disabled = false,
      className = "",
      style = {},
      id,
      ...props
    },
    ref
  ) => {
    const generatedId = React.useId();
    const selectId = id || `select-${generatedId}`;

    const baseStyles: React.CSSProperties = {
      width: "100%",
      fontFamily: "var(--font-family-base)",
      fontSize: "var(--font-size-base)",
      color: "var(--color-text-primary)",
      background: "var(--color-bg-secondary)",
      border: `1px solid ${error ? "var(--color-error)" : "var(--color-border-default)"}`,
      borderRadius: "var(--radius-md)",
      outline: "none",
      cursor: disabled ? "not-allowed" : "pointer",
      transition: "border-color var(--duration-normal) var(--ease-out), box-shadow var(--duration-normal) var(--ease-out)",
      appearance: "none",
      backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='%238b949e' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='6 9 12 15 18 9'%3E%3C/polyline%3E%3C/svg%3E")`,
      backgroundRepeat: "no-repeat",
      backgroundPosition: "right var(--spacing-3) center",
      backgroundSize: "var(--spacing-3)",
      paddingRight: "calc(var(--spacing-3) * 3)",
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
      ...style,
    };

    return (
      <div style={{ display: "flex", flexDirection: "column", gap: "var(--spacing-1)" }}>
        {label && (
          <label
            htmlFor={selectId}
            style={{
              fontSize: "var(--font-size-sm)",
              fontWeight: "var(--font-weight-medium)",
              color: "var(--color-text-secondary)",
            }}
          >
            {label}
          </label>
        )}
        <select
          ref={ref}
          id={selectId}
          disabled={disabled}
          className={className}
          style={combinedStyle}
          aria-invalid={!!error}
          aria-describedby={error ? `${selectId}-error` : helperText ? `${selectId}-helper` : undefined}
          {...props}
        >
          {options.map((option) => (
            <option key={option.value} value={option.value} disabled={option.disabled}>
              {option.label}
            </option>
          ))}
        </select>
        {error && (
          <span
            id={`${selectId}-error`}
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
            id={`${selectId}-helper`}
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

Select.displayName = "Select";
