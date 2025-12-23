/**
 * UI Component Library
 * Reusable components styled for VS Code with modern design
 */

import React, { forwardRef, ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from 'react';

// Button variants
type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'link';
type ButtonSize = 'sm' | 'md' | 'lg' | 'icon';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  leftIcon?: ReactNode;
  rightIcon?: ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      variant = 'primary',
      size = 'md',
      loading,
      leftIcon,
      rightIcon,
      children,
      className = '',
      disabled,
      ...props
    },
    ref
  ) => {
    return (
      <button
        ref={ref}
        className={`btn btn--${variant} btn--${size} ${className}`}
        disabled={disabled || loading}
        {...props}
      >
        {loading ? (
          <span className="btn-spinner">
            <i className="codicon codicon-loading animate-spin" />
          </span>
        ) : leftIcon ? (
          <span className="btn-icon-left">{leftIcon}</span>
        ) : null}
        {children}
        {rightIcon && <span className="btn-icon-right">{rightIcon}</span>}
      </button>
    );
  }
);
Button.displayName = 'Button';

// Input component
interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  error?: string;
  leftIcon?: ReactNode;
  rightElement?: ReactNode;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ error, leftIcon, rightElement, className = '', ...props }, ref) => {
    return (
      <div className="input-wrapper">
        {leftIcon && <div className="input-icon-left">{leftIcon}</div>}
        <input
          ref={ref}
          className={`input ${leftIcon ? 'input--with-left-icon' : ''} ${rightElement ? 'input--with-right-element' : ''} ${error ? 'input--error' : ''} ${className}`}
          {...props}
        />
        {rightElement && <div className="input-right-element">{rightElement}</div>}
        {error && <p className="input-error-message">{error}</p>}
      </div>
    );
  }
);
Input.displayName = 'Input';

// Select component
interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

interface SelectProps {
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  placeholder?: string;
  disabled?: boolean;
  className?: string;
}

export const Select: React.FC<SelectProps> = ({
  value,
  onChange,
  options,
  placeholder,
  disabled,
  className = '',
}) => {
  return (
    <select
      value={value}
      onChange={e => onChange(e.target.value)}
      disabled={disabled}
      aria-label={placeholder || 'Select an option'}
      className={`select ${className}`}
    >
      {placeholder && (
        <option value="" disabled>
          {placeholder}
        </option>
      )}
      {options.map(option => (
        <option key={option.value} value={option.value} disabled={option.disabled}>
          {option.label}
        </option>
      ))}
    </select>
  );
};

// Checkbox component
interface CheckboxProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: string;
  disabled?: boolean;
  className?: string;
}

export const Checkbox: React.FC<CheckboxProps> = ({
  checked,
  onChange,
  label,
  disabled,
  className = '',
}) => {
  return (
    <label className={`checkbox ${disabled ? 'checkbox--disabled' : ''} ${className}`}>
      <input
        type="checkbox"
        checked={checked}
        onChange={e => onChange(e.target.checked)}
        disabled={disabled}
        className="checkbox-input"
      />
      <span className="checkbox-box">{checked && <i className="codicon codicon-check" />}</span>
      {label && <span className="checkbox-label">{label}</span>}
    </label>
  );
};

// Badge component
type BadgeVariant = 'default' | 'success' | 'warning' | 'error' | 'info';

interface BadgeProps {
  children: ReactNode;
  variant?: BadgeVariant;
  className?: string;
}

export const Badge: React.FC<BadgeProps> = ({ children, variant = 'default', className = '' }) => {
  return <span className={`badge badge--${variant} ${className}`}>{children}</span>;
};

// Card component
interface CardProps {
  children: ReactNode;
  className?: string;
  onClick?: () => void;
  hover?: boolean;
}

export const Card: React.FC<CardProps> = ({ children, className = '', onClick, hover }) => {
  return (
    <div onClick={onClick} className={`card ${hover ? 'card--hover' : ''} ${className}`}>
      {children}
    </div>
  );
};

// Spinner component
interface SpinnerProps {
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

export const Spinner: React.FC<SpinnerProps> = ({ size = 'md', className = '' }) => {
  return (
    <div className={`spinner spinner--${size} ${className}`}>
      <i className="codicon codicon-loading" />
    </div>
  );
};

// Empty state component
interface EmptyStateProps {
  icon?: string;
  title: string;
  description?: string;
  action?: ReactNode;
}

export const EmptyState: React.FC<EmptyStateProps> = ({ icon, title, description, action }) => {
  return (
    <div className="empty-state">
      {icon && (
        <div className="empty-state-icon">
          <i className={`codicon codicon-${icon}`} />
        </div>
      )}
      <h3 className="empty-state-title">{title}</h3>
      {description && <p className="empty-state-description">{description}</p>}
      {action && <div className="empty-state-action">{action}</div>}
    </div>
  );
};

// Tooltip component
interface TooltipProps {
  content: string;
  children: ReactNode;
  position?: 'top' | 'bottom' | 'left' | 'right';
}

export const Tooltip: React.FC<TooltipProps> = ({ content, children, position = 'top' }) => {
  return (
    <div className="tooltip-wrapper">
      {children}
      <div className={`tooltip tooltip--${position}`}>{content}</div>
    </div>
  );
};

// Progress bar component
interface ProgressBarProps {
  value: number;
  max?: number;
  showLabel?: boolean;
  className?: string;
}

export const ProgressBar: React.FC<ProgressBarProps> = ({
  value,
  max = 100,
  showLabel,
  className = '',
}) => {
  const percentage = Math.min(100, Math.max(0, (value / max) * 100));

  return (
    <div className={`progress ${className}`}>
      <div className="progress-track">
        <div className="progress-fill" style={{ width: `${percentage}%` }} />
      </div>
      {showLabel && <span className="progress-label">{Math.round(percentage)}%</span>}
    </div>
  );
};

// Accordion component
interface AccordionItemProps {
  title: string;
  children: ReactNode;
  defaultOpen?: boolean;
}

export const AccordionItem: React.FC<AccordionItemProps> = ({
  title,
  children,
  defaultOpen = false,
}) => {
  const [isOpen, setIsOpen] = React.useState(defaultOpen);

  return (
    <div className="accordion-item">
      <button onClick={() => setIsOpen(!isOpen)} className="accordion-header">
        <span className="accordion-title">{title}</span>
        <i className={`codicon codicon-chevron-${isOpen ? 'down' : 'right'} accordion-icon`} />
      </button>
      {isOpen && <div className="accordion-content">{children}</div>}
    </div>
  );
};

// Tab component
interface Tab {
  id: string;
  label: string;
  icon?: string;
  disabled?: boolean;
}

interface TabsProps {
  tabs: Tab[];
  activeTab: string;
  onChange: (tabId: string) => void;
}

export const Tabs: React.FC<TabsProps> = ({ tabs, activeTab, onChange }) => {
  const getIcon = (iconName?: string) => {
    switch (iconName) {
      case 'history':
        return (
          <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
            <path d="M13.451 5.609l-.579-.939-1.068.812-.076.094c-.335.415-.927 1.341-.927 2.619 0 2.04-1.759 3.699-3.801 3.699-2.042 0-3.801-1.659-3.801-3.699 0-1.907 1.474-3.487 3.401-3.674v1.627l3.4-2.299-3.4-2.299v1.568c-2.637.194-4.801 2.39-4.801 5.077 0 2.812 2.381 5.1 5.201 5.1s5.201-2.288 5.201-5.1c0-1.049-.342-2.063-.927-2.88l.177-.106z" />
          </svg>
        );
      case 'search':
        return (
          <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
            <path
              d="M15.25 15.25L11.5 11.5M13.5 7.5C13.5 10.8137 10.8137 13.5 7.5 13.5C4.18629 13.5 1.5 10.8137 1.5 7.5C1.5 4.18629 4.18629 1.5 7.5 1.5C10.8137 1.5 13.5 4.18629 13.5 7.5Z"
              stroke="currentColor"
              fill="none"
              strokeWidth="1.5"
            />
          </svg>
        );
      case 'gear':
        return (
          <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
            <path d="M9.1 4.4L8.6 2H7.4l-.5 2.4-.7.3-2-1.3-.9.8 1.3 2-.2.7-2.4.5v1.2l2.4.5.3.8-1.3 2 .8.8 2-1.3.8.3.4 2.3h1.2l.5-2.4.8-.3 2 1.3.8-.8-1.3-2 .3-.8 2.3-.4V7.4l-2.4-.5-.3-.8 1.3-2-.8-.8-2 1.3-.7-.2zM9.4 1l.5 2.4L12 2.1l2 2-1.4 2.1 2.4.4v2.8l-2.4.5L14 12l-2 2-2.1-1.4-.5 2.4H6.6l-.5-2.4L4 13.9l-2-2 1.4-2.1L1 9.4V6.6l2.4-.5L2.1 4l2-2 2.1 1.4.4-2.4h2.8zm.6 7a2 2 0 1 1-4 0 2 2 0 0 1 4 0z" />
          </svg>
        );
      case 'comment':
        return (
          <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
            <path d="M5 3a3 3 0 00-3 3v4a3 3 0 003 3h1v2l3-2h2a3 3 0 003-3V6a3 3 0 00-3-3H5zm0 1h6a2 2 0 012 2v4a2 2 0 01-2 2H8.5l-2 1.333V12H5a2 2 0 01-2-2V6a2 2 0 012-2z" />
          </svg>
        );
      default:
        return null;
    }
  };

  return (
    <div className="tabs">
      {tabs.map(tab => (
        <button
          key={tab.id}
          onClick={() => !tab.disabled && onChange(tab.id)}
          disabled={tab.disabled}
          className={`tab ${activeTab === tab.id ? 'tab--active' : ''} ${tab.disabled ? 'tab--disabled' : ''}`}
        >
          {tab.icon && <span className="tab-icon">{getIcon(tab.icon)}</span>}
          <span className="tab-label">{tab.label}</span>
        </button>
      ))}
      <div className="tab-indicator" />
    </div>
  );
};
