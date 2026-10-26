"use client";

import { useState } from "react";

// 設定表單共用的小元件（3D 模型設定、Bambu 設定）

export function Section({ title, disabled, children }: { title: string; disabled?: boolean; children: React.ReactNode }) {
  return (
    <fieldset
      disabled={disabled}
      className="flex flex-col gap-4 rounded-lg border border-zinc-300 p-4 disabled:opacity-50 dark:border-zinc-700"
    >
      <legend className="px-1 font-medium">{title}</legend>
      {children}
    </fieldset>
  );
}

// info：點標籤旁的 ⓘ 才展開的詳細說明
export function Field({
  label,
  hint,
  info,
  children,
}: {
  label: string;
  hint?: string;
  info?: React.ReactNode;
  children: React.ReactNode;
}) {
  const [showInfo, setShowInfo] = useState(false);
  return (
    <div className="flex flex-col gap-2">
      <span className="flex items-center gap-1.5 text-sm">
        {label}
        {info && (
          <button
            type="button"
            onClick={() => setShowInfo((v) => !v)}
            aria-expanded={showInfo}
            aria-label={`${label}的說明`}
            className={`flex h-5 w-5 items-center justify-center rounded-full border text-xs ${
              showInfo ? "border-foreground bg-foreground text-background" : "border-zinc-400 text-zinc-500"
            }`}
          >
            i
          </button>
        )}
      </span>
      {info && showInfo && info}
      {children}
      {hint && <span className="text-sm text-zinc-500">{hint}</span>}
    </div>
  );
}

export function Select({
  value,
  options,
  onChange,
  disabled,
}: {
  value: string;
  options: readonly { value: string; label: string }[];
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  return (
    <select
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
      className="rounded-lg border border-zinc-300 bg-transparent p-2 disabled:opacity-50 dark:border-zinc-700"
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

export function Chips({
  options,
  value,
  onChange,
  disabled,
}: {
  options: readonly { value: string; label: string }[];
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  return (
    <div className={`flex flex-wrap gap-2 ${disabled ? "opacity-50" : ""}`}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          disabled={disabled}
          onClick={() => onChange(option.value)}
          className={`rounded-full border px-3.5 py-1.5 text-sm ${
            value === option.value
              ? "border-foreground bg-foreground text-background"
              : "border-zinc-300 dark:border-zinc-700"
          }`}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

export function PresetButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full border px-3 py-1 text-sm ${
        active ? "border-foreground bg-foreground text-background" : "border-zinc-300 dark:border-zinc-700"
      }`}
    >
      {children}
    </button>
  );
}

export function Check({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <label className={`flex items-center gap-2 ${disabled ? "opacity-50" : ""}`}>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="h-4 w-4"
      />
      <span>{label}</span>
    </label>
  );
}
