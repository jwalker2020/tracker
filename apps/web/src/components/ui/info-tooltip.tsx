"use client";

import { useState, useRef, useEffect, useLayoutEffect } from "react";
import { createPortal } from "react-dom";

type InfoTooltipProps = {
  text: string;
};

function InfoIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="currentColor"
      stroke="none"
      aria-hidden
    >
      <circle cx="12" cy="5" r="2.5" />
      <path d="M12 8v11" stroke="currentColor" strokeWidth="2.25" fill="none" strokeLinecap="round" />
    </svg>
  );
}

export function InfoTooltip({ text }: InfoTooltipProps) {
  const [visible, setVisible] = useState(false);
  const wrapperRef = useRef<HTMLSpanElement>(null);
  const tooltipRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!visible) return;
    const handlePointerDownOutside = (e: PointerEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setVisible(false);
      }
    };
    document.addEventListener("pointerdown", handlePointerDownOutside);
    return () => document.removeEventListener("pointerdown", handlePointerDownOutside);
  }, [visible]);

  const [tooltipStyle, setTooltipStyle] = useState<React.CSSProperties>({});
  useLayoutEffect(() => {
    if (!visible || typeof document === "undefined") return;
    const wrapper = wrapperRef.current;
    if (!wrapper) return;
    const rect = wrapper.getBoundingClientRect();
    setTooltipStyle({
      position: "fixed",
      left: rect.left + rect.width / 2,
      top: rect.top,
      transform: "translate(-50%, -100%) translateY(-4px)",
      zIndex: 9999,
    });
  }, [visible]);

  const tooltipContent = visible ? (
    <span
      ref={tooltipRef}
      className="whitespace-normal rounded border border-slate-600 bg-slate-800 px-2 py-1.5 text-left text-xs font-normal text-slate-200 shadow-lg"
      style={{ maxWidth: "240px", width: "max-content", ...tooltipStyle }}
      role="tooltip"
    >
      {text}
    </span>
  ) : null;

  return (
    <>
      <span
        ref={wrapperRef}
        className="relative inline-flex items-center"
      >
        <span
          role="img"
          aria-label="More information"
          tabIndex={0}
          className="ml-1.5 inline-flex h-3.5 w-3.5 cursor-help items-center justify-center rounded-full border border-slate-500 text-slate-400 outline-none transition-colors hover:border-slate-400 hover:text-slate-300 focus:border-slate-400 focus:text-slate-300 focus:outline-none focus:ring-1 focus:ring-slate-400"
          onMouseEnter={() => setVisible(true)}
          onMouseLeave={() => setVisible(false)}
          onFocus={() => setVisible(true)}
          onBlur={() => setVisible(false)}
        >
          <InfoIcon className="h-2.5 w-2.5" />
        </span>
      </span>
      {typeof document !== "undefined" && tooltipContent
        ? createPortal(tooltipContent, document.body)
        : null}
    </>
  );
}
