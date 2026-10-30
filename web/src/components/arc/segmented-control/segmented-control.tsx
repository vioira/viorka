"use client";

import { useCallback, useEffect, useId, useLayoutEffect, useRef, type KeyboardEvent, type ReactNode } from "react";
import { LayoutGroup, motion, useReducedMotion } from "motion/react";
import { motionTokens } from "../lib/motion-tokens";
import styles from "./segmented-control.module.css";

export interface Segment { value: string; label: string; /** Optional content after the label, such as a badge. */ accessory?: ReactNode; }
export interface SegmentedControlProps {
  options: Segment[];
  value: string;
  onValueChange: (value: string) => void;
  label?: string;
  /** Called when the pointer or focus reaches an option, before it is chosen. Use it to start loading what that option shows. */
  onOptionIntent?: (value: string) => void;
  className?: string;
}

export default function SegmentedControl({ options, value, onValueChange, label, onOptionIntent, className }: SegmentedControlProps) {
  const id = useId();
  const reduced = useReducedMotion();
  const track = useRef<HTMLDivElement>(null);
  const selection = useRef<HTMLSpanElement>(null);
  const frame = useRef<number | null>(null);

  // Clip the dark copy to the actual projected pill, including partial glyph coverage.
  // Measuring the painted rectangle follows Motion's spring even during interrupted moves.
  const updateCoverage = useCallback(() => {
    const pill = selection.current?.getBoundingClientRect();
    track.current?.querySelectorAll<HTMLElement>(`[data-segment-ink]`).forEach((ink) => {
      if (!pill || pill.width === 0) {
        ink.style.clipPath = 'inset(50%)';
        return;
      }
      const box = ink.getBoundingClientRect();
      ink.style.clipPath = `inset(${pill.top - box.top}px ${box.right - pill.right}px ${box.bottom - pill.bottom}px ${pill.left - box.left}px round ${pill.height / 2}px)`;
    });
  }, []);

  const stopTracking = useCallback(() => {
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = null;
    updateCoverage();
  }, [updateCoverage]);

  const startTracking = useCallback(() => {
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    const tick = () => {
      updateCoverage();
      frame.current = requestAnimationFrame(tick);
    };
    tick();
  }, [updateCoverage]);

  useLayoutEffect(() => {
    updateCoverage();
    const node = track.current;
    const observer = new ResizeObserver(updateCoverage);
    if (node) {
      observer.observe(node);
      node.querySelectorAll('button').forEach((button) => observer.observe(button));
      node.addEventListener('scroll', updateCoverage, { passive: true });
    }
    return () => {
      observer.disconnect();
      node?.removeEventListener('scroll', updateCoverage);
    };
  }, [options, updateCoverage]);

  useLayoutEffect(() => () => stopTracking(), [stopTracking]);

  useLayoutEffect(() => {
    // Also synchronize immediate/reduced-motion changes, which may not animate.
    if (reduced) stopTracking();
    else updateCoverage();
  }, [value, reduced, updateCoverage, stopTracking]);

  // When the options are wider than the container, the track scrolls inside itself. Edges fade only on the side with more to see.
  useLayoutEffect(() => {
    const node = track.current;
    if (!node) return;
    const edges = () => {
      const rest = node.scrollWidth - node.clientWidth - node.scrollLeft;
      node.toggleAttribute("data-fade-start", node.scrollLeft > 1);
      node.toggleAttribute("data-fade-end", rest > 1);
    };
    edges();
    node.addEventListener("scroll", edges, { passive: true });
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(edges);
    observer?.observe(node);
    return () => { node.removeEventListener("scroll", edges); observer?.disconnect(); };
  }, [options.length]);

  // The selected option is always scrolled fully into view, with a little room so it clears the fade.
  const first = useRef(true);
  useEffect(() => {
    const node = track.current;
    const button = node?.querySelector<HTMLElement>('[aria-pressed="true"]');
    if (!node || !button || node.scrollWidth <= node.clientWidth) { first.current = false; return; }
    const room = 20, start = button.offsetLeft - room, end = button.offsetLeft + button.offsetWidth + room - node.clientWidth;
    const left = node.scrollLeft > start ? start : node.scrollLeft < end ? end : node.scrollLeft;
    if (left !== node.scrollLeft) node.scrollTo({ left: Math.max(0, left), behavior: first.current || reduced ? "auto" : "smooth" });
    first.current = false;
  }, [value, reduced]);

  // Arrow keys, Home and End move the selection like a tab list; only the selected option is a tab stop.
  const selectedIndex = Math.max(0, options.findIndex(option => option.value === value));
  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    const last = options.length - 1;
    const target = event.key === "ArrowRight" || event.key === "ArrowDown" ? (selectedIndex === last ? 0 : selectedIndex + 1)
      : event.key === "ArrowLeft" || event.key === "ArrowUp" ? (selectedIndex === 0 ? last : selectedIndex - 1)
        : event.key === "Home" ? 0 : event.key === "End" ? last : -1;
    if (target < 0 || !options[target]) return;
    event.preventDefault();
    onValueChange(options[target].value);
    track.current?.querySelector<HTMLElement>(`[data-value="${CSS.escape(options[target].value)}"]`)?.focus({ preventScroll: true });
  };

  return <div className={`${styles.root} ${className ?? ""}`} role="group" aria-label={label}>
    <LayoutGroup id={id}><motion.div ref={track} layoutScroll className={styles.track}>
      {options.map((option, index) => <button key={option.value} id={`${id}-${option.value}`} className={styles.button} type="button" data-value={option.value} aria-pressed={value === option.value} tabIndex={index === selectedIndex ? 0 : -1} onClick={() => onValueChange(option.value)} onKeyDown={onKeyDown} onPointerEnter={onOptionIntent ? () => onOptionIntent(option.value) : undefined} onFocus={onOptionIntent ? () => onOptionIntent(option.value) : undefined}>
        {value === option.value && <motion.span ref={selection} onLayoutAnimationStart={startTracking} onLayoutAnimationComplete={stopTracking} className={styles.selection} layoutId="selection" layoutDependency={value} transition={reduced ? { duration: 0 } : motionTokens.spring.morph} aria-hidden="true" />}
        <span className={styles.label}>
          <span className={styles.labelContent}>{option.label}{option.accessory}</span>
          <span className={`${styles.labelContent} ${styles.coveredLabel}`} data-segment-ink aria-hidden="true" inert>{option.label}{option.accessory}</span>
        </span>
      </button>)}
    </motion.div></LayoutGroup>
  </div>;
}
