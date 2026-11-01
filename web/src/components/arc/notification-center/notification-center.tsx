"use client";

import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { AnimatePresence, animate, motion, useIsPresent, useMotionValue, useReducedMotion, type AnimationPlaybackControls, type HTMLMotionProps, type TargetAndTransition, type Transition, type Variants } from "motion/react";
import { Bell, Check, CheckCheck, CircleCheck, CircleDot, MessageCircle, TriangleAlert, X } from "lucide-react";
import * as PopoverPrimitive from "@radix-ui/react-popover";
import { Avatar } from "../avatar/avatar";
import { motionTokens } from "../lib/motion-tokens";
import styles from "./notification-center.module.css";

export interface NotificationItem {
  id: string;
  title: string;
  description?: string;
  time: string;
  read?: boolean;
  tone?: "info" | "success" | "warning";
  /** A local portrait asset for person-generated updates. */
  actor?: { name: string; photo: string };
}

export interface NotificationCenterProps {
  notifications: NotificationItem[];
  label?: string;
  onReadChange?: (notification: NotificationItem, read: boolean) => void | Promise<boolean>;
  onMarkAllRead?: (notifications: NotificationItem[]) => void | Promise<boolean>;
  onDismiss?: (notification: NotificationItem) => void;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  avoidCollisions?: boolean;
  /** Controlled server data and async actions, added for Viorka. */
  controlled?: boolean;
  busy?: boolean;
  status?: string;
  onRefresh?: () => void;

}

type View = "all" | "unread";

const enter: Transition = { duration: motionTokens.duration.standard, ease: [...motionTokens.ease.enter] };
const exitFast: Transition = { duration: motionTokens.duration.fast, ease: [...motionTokens.ease.standard] };
const instant: Transition = { duration: 0 };
const textIn: TargetAndTransition = { opacity: 0, y: "0.3em", filter: `blur(${motionTokens.blur.soft}px)` };
const textOut: TargetAndTransition = { opacity: 0, y: "-0.3em", filter: `blur(${motionTokens.blur.subtle}px)`, transition: exitFast };
const iconIn: TargetAndTransition = { opacity: 0, scale: .6, filter: `blur(${motionTokens.blur.subtle}px)` };
const shown: TargetAndTransition = { opacity: 1, y: "0em", scale: 1, filter: "blur(0px)" };
const fadeOut: TargetAndTransition = { opacity: 0, transition: { duration: motionTokens.duration.instant } };
/** Bulk actions cascade down the list, capped so the whole sweep stays under a quarter second. */
const cascade = (index: number) => Math.min(index * motionTokens.stagger.item, .2);

/** Outgoing copies are hidden from assistive tech while they fade, so live text reads only the current value. */
function Swap(props: HTMLMotionProps<"span">) {
  const present = useIsPresent();
  return <motion.span {...props} aria-hidden={present ? props["aria-hidden"] : true} />;
}

function SwapText({ children, reduce }: { children: string; reduce: boolean | null }) {
  return <span className={styles.swap}><AnimatePresence mode="popLayout" initial={false}><Swap key={children} className={styles.swapLine} initial={reduce ? { opacity: 0 } : textIn} animate={shown} exit={reduce ? fadeOut : textOut} transition={reduce ? instant : enter}>{children}</Swap></AnimatePresence></span>;
}

const rollVariants: Variants = {
  enter: (direction: number) => ({ opacity: 0, y: direction >= 0 ? "0.7em" : "-0.7em", filter: `blur(${motionTokens.blur.subtle}px)` }),
  center: { opacity: 1, y: "0em", filter: "blur(0px)" },
  exit: (direction: number) => ({ opacity: 0, y: direction >= 0 ? "-0.7em" : "0.7em", filter: `blur(${motionTokens.blur.subtle}px)`, transition: exitFast }),
};

/** Counts roll like an odometer: a higher number rises from below, a lower one drops from above. */
function RollingCount({ value, display = String(value), reduce }: { value: number; display?: string; reduce: boolean | null }) {
  const [previous, setPrevious] = useState(value);
  const [direction, setDirection] = useState(0);
  if (value !== previous) { setDirection(value > previous ? 1 : -1); setPrevious(value); }
  return <span className={styles.roll}><AnimatePresence mode="popLayout" initial={false} custom={direction}>
    <Swap key={display} className={styles.rollValue} custom={direction} variants={reduce ? undefined : rollVariants} initial={reduce ? { opacity: 0 } : "enter"} animate={reduce ? { opacity: 1 } : "center"} exit={reduce ? fadeOut : "exit"} transition={reduce ? instant : { y: motionTokens.spring.snappy, opacity: exitFast, filter: exitFast }}>{display}</Swap>
  </AnimatePresence></span>;
}

/** Follows the width of its content. After `morphKey` changes the width springs from the old size to the new one, then returns to auto, so a longer label grows the control instead of snapping it. */
function MorphWidth({ reduce, morphKey, children }: { reduce: boolean | null; morphKey: string; children: ReactNode }) {
  const frame = useRef<HTMLSpanElement>(null);
  const content = useRef<HTMLSpanElement>(null);
  const width = useMotionValue<number | "auto">("auto");
  const changedAt = useRef(0);
  useLayoutEffect(() => { changedAt.current = performance.now(); }, [morphKey]);
  useEffect(() => {
    const node = content.current;
    if (!node || typeof ResizeObserver === "undefined") return;
    let last: number | undefined;
    let controls: AnimationPlaybackControls | undefined;
    const settle = () => { width.jump("auto"); if (frame.current) frame.current.style.width = "auto"; };
    const observer = new ResizeObserver(([entry]) => {
      if (!entry) return;
      const next = entry.borderBoxSize?.[0]?.inlineSize ?? node.offsetWidth;
      const current = width.get();
      const from = typeof current === "number" ? current : last;
      last = next;
      controls?.stop();
      if (reduce || from === undefined || from === next || performance.now() - changedAt.current > 120) return settle();
      // Pin the old width before this frame paints, then spring to the new one.
      if (frame.current) frame.current.style.width = `${from}px`;
      controls = animate(width, [from, next], { ...motionTokens.spring.morph, onComplete: settle });
    });
    observer.observe(node);
    return () => { observer.disconnect(); controls?.stop(); };
  }, [width, reduce]);
  return <motion.span ref={frame} className={styles.morph} style={{ width }}><span ref={content} className={styles.morphContent}>{children}</span></motion.span>;
}

function NotificationVisual({ item }: { item: NotificationItem }) {
  if (item.actor) return <Avatar name={item.actor.name} src={item.actor.photo} size="md" />;
  return <span className={[styles.eventIcon, styles[item.tone ?? "info"]].join(" ")} aria-hidden="true">
    {item.tone === "warning" ? <TriangleAlert size={18} strokeWidth={1.7} /> : item.tone === "success" ? <CircleCheck size={18} strokeWidth={1.7} /> : <MessageCircle size={18} strokeWidth={1.7} />}
  </span>;
}

export function NotificationCenter({ notifications: initial, label = "Notifications", onReadChange, onMarkAllRead, onDismiss, open, onOpenChange, avoidCollisions = true, controlled = false, busy = false, status, onRefresh }: NotificationCenterProps) {
  const reduce = useReducedMotion();
  const layoutId = useId();
  const [internalOpen, setInternalOpen] = useState(false);
  const [localItems, setItems] = useState(initial);
  const items = controlled ? initial : localItems;
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const disabled = busy || saving;
  const [view, setView] = useState<View>("all");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [bulk, setBulk] = useState(false);
  const itemRefs = useRef(new Map<string, HTMLButtonElement>());
  const allTabRef = useRef<HTMLButtonElement>(null);
  const unreadTabRef = useRef<HTMLButtonElement>(null);
  const isOpen = open ?? internalOpen;
  const unreadCount = useMemo(() => items.filter((item) => !item.read).length, [items]);
  const readCount = items.length - unreadCount;
  const visible = view === "unread" ? items.filter((item) => !item.read) : items;
  const summary = status ?? (unreadCount ? `${unreadCount} 条未读通知` : "所有通知均已读");

  function setOpen(next: boolean) {
    if (open === undefined) setInternalOpen(next);
    onOpenChange?.(next);
  }

  async function toggleRead(item: NotificationItem) {
    if (busy || savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    try {
    if (await onReadChange?.(item, !item.read) === false) return;
    const next = !item.read;
    if (next && view === "unread") {
      const index = visible.findIndex((entry) => entry.id === item.id);
      const nextId = visible[index + 1]?.id ?? visible[index - 1]?.id;
      requestAnimationFrame(() => nextId ? itemRefs.current.get(nextId)?.focus() : unreadTabRef.current?.focus());
    }
    setBulk(false);
    setItems((current) => current.map((entry) => entry.id === item.id ? { ...entry, read: next } : entry));
    if (next && view === "unread") setExpandedId(null);
    } finally { savingRef.current = false; setSaving(false); }
  }

  async function markAllRead() {
    if (busy || savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    try {
      const unread = items.filter((entry) => !entry.read);
      if (await onMarkAllRead?.(unread) === false) return;
      if (!controlled) {
        const ids = new Set(unread.map((item) => item.id));
        setItems((current) => current.map((entry) => ids.has(entry.id) ? {...entry, read: true} : entry));
      }
      setBulk(true);
      setExpandedId(null);
      requestAnimationFrame(() => (view === "unread" ? unreadTabRef : allTabRef).current?.focus());
    } finally { savingRef.current = false; setSaving(false); }
  }

  function dismiss(item: NotificationItem) {
    const index = visible.findIndex((entry) => entry.id === item.id);
    const nextId = visible[index + 1]?.id ?? visible[index - 1]?.id;
    requestAnimationFrame(() => nextId ? itemRefs.current.get(nextId)?.focus() : unreadTabRef.current?.focus());
    setBulk(false);
    setItems((current) => current.filter((entry) => entry.id !== item.id));
    if (expandedId === item.id) setExpandedId(null);
    onDismiss?.(item);
  }

  function clearRead() {
    items.filter((item) => item.read).forEach((item) => onDismiss?.(item));
    setBulk(true);
    setItems((current) => current.filter((item) => !item.read));
    requestAnimationFrame(() => allTabRef.current?.focus());
  }

  const height: Transition = reduce ? instant : { height: motionTokens.spring.smooth, opacity: enter };

  return <PopoverPrimitive.Root open={isOpen} onOpenChange={setOpen}>
    <PopoverPrimitive.Trigger asChild><button className={styles.trigger} type="button" aria-label={`${label}${unreadCount ? `，${unreadCount} 条未读` : ""}`}><motion.span animate={{ rotate: isOpen && !reduce ? -12 : 0 }} transition={reduce ? instant : motionTokens.spring.snappy}><Bell size={19} strokeWidth={1.75} aria-hidden="true" /></motion.span><AnimatePresence initial={false}>{unreadCount > 0 && <motion.span key="badge" className={styles.badge} aria-hidden="true" initial={reduce ? { opacity: 0 } : { opacity: 0, scale: .6 }} animate={{ opacity: 1, scale: 1 }} exit={reduce ? fadeOut : { opacity: 0, scale: .6, transition: exitFast }} transition={reduce ? instant : motionTokens.spring.snappy}><RollingCount value={unreadCount} display={unreadCount > 9 ? "9+" : String(unreadCount)} reduce={reduce} /></motion.span>}</AnimatePresence></button></PopoverPrimitive.Trigger>
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content className={styles.panel} align="center" side="bottom" sideOffset={12} collisionPadding={12} avoidCollisions={avoidCollisions} aria-label={label} aria-busy={disabled}>
        <div className={styles.header}>
          <div><div className={styles.heading}><h2>{label}</h2><span className={styles.count}><RollingCount value={unreadCount} reduce={reduce} /></span></div><p aria-live="polite"><SwapText reduce={reduce}>{summary}</SwapText></p></div>
          <PopoverPrimitive.Close className={styles.close} aria-label="关闭通知"><X size={17} strokeWidth={1.75} aria-hidden="true" /></PopoverPrimitive.Close>
        </div>

        <div className={styles.toolbar}>
          <div className={styles.viewSwitch} role="group" aria-label="筛选通知">
            {(["all", "unread"] as const).map((next) => <button key={next} ref={next === "unread" ? unreadTabRef : allTabRef} type="button" className={view === next ? styles.viewActive : undefined} aria-pressed={view === next} onClick={() => { setBulk(false); setView(next); setExpandedId(null); }}>{view === next && <motion.span className={styles.viewHighlight} layoutId={`${layoutId}-view`} transition={reduce ? instant : motionTokens.spring.morph} />}<span>{next === "all" ? "全部" : "未读"}</span></button>)}
          </div>
          <AnimatePresence initial={false}>{unreadCount > 0 && <motion.button key="mark-all" type="button" className={styles.markAll} aria-label="全部标记已读" disabled={disabled || (controlled && !onMarkAllRead)} onClick={() => void markAllRead()} initial={reduce ? { opacity: 0 } : { opacity: 0, filter: `blur(${motionTokens.blur.subtle}px)` }} animate={{ opacity: 1, filter: "blur(0px)" }} exit={reduce ? fadeOut : { opacity: 0, filter: `blur(${motionTokens.blur.subtle}px)`, transition: exitFast }} transition={reduce ? instant : enter}><CheckCheck size={15} strokeWidth={1.75} aria-hidden="true" /><span>全部标记已读</span></motion.button>}</AnimatePresence>
        </div>

        {/* Rows collapse their own height on the way out, so the list and the panel close the gap together. */}
        <div className={styles.list} role="list" aria-label={view === "all" ? "全部通知" : "未读通知"}>
          <AnimatePresence initial={false} custom={bulk}>
            {visible.map((item, index) => <motion.div key={item.id} role="listitem" className={styles.row} custom={bulk}
              variants={{ exit: (isBulk: boolean) => reduce ? fadeOut : { height: 0, opacity: 0, transition: { height: { ...motionTokens.spring.smooth, delay: isBulk ? cascade(index) : 0 }, opacity: { ...exitFast, delay: isBulk ? cascade(index) : 0 } } } }}
              initial={reduce ? { opacity: 0 } : { height: 0 }} animate={{ height: "auto", opacity: 1 }} exit="exit" transition={height}>
              <article className={[styles.item, item.read ? styles.itemRead : "", expandedId === item.id ? styles.itemExpanded : ""].filter(Boolean).join(" ")} style={{ "--index": Math.min(index, 7) } as CSSProperties}>
                <div className={styles.itemMain}>
                  <NotificationVisual item={item} />
                  <button ref={(node) => { if (node) itemRefs.current.set(item.id, node); else itemRefs.current.delete(item.id); }} type="button" className={styles.itemToggle} aria-expanded={expandedId === item.id} aria-label={`${item.title}${item.read ? "，已读" : "，未读"}. ${expandedId === item.id ? "收起详情" : "展开详情"}`} onClick={() => setExpandedId((current) => current === item.id ? null : item.id)}>
                    <span className={styles.itemTitle}><strong>{item.title}</strong>
                      <AnimatePresence initial={false} custom={bulk}>{!item.read && <motion.span key="dot" className={styles.unreadDot} aria-hidden="true" custom={bulk}
                        variants={{ exit: (isBulk: boolean) => reduce ? fadeOut : { opacity: 0, scale: .3, transition: { ...exitFast, delay: isBulk ? cascade(index) : 0 } } }}
                        initial={reduce ? { opacity: 0 } : { opacity: 0, scale: .3 }} animate={{ opacity: 1, scale: 1 }} exit="exit" transition={reduce ? instant : motionTokens.spring.snappy} />}</AnimatePresence>
                    </span>
                    <span className={styles.itemPreview}>{item.description ?? (item.actor ? `From ${item.actor.name}` : "查看通知详情")}</span>
                  </button>
                  <time className={styles.time}>{item.time}</time>
                </div>
                <AnimatePresence initial={false}>
                  {expandedId === item.id && <motion.div className={styles.details} initial={reduce ? { opacity: 0 } : { height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={reduce ? fadeOut : { height: 0, opacity: 0, transition: { height: motionTokens.spring.smooth, opacity: exitFast } }} transition={height}>
                    <p>{item.description ?? (item.actor ? `${item.actor.name} shared an update with you.` : "This update is ready to review.")}</p>
                    <div className={styles.itemActions}>
                      <button type="button" disabled={disabled} onClick={() => void toggleRead(item)}><MorphWidth reduce={reduce} morphKey={item.read ? "read" : "unread"}>
                        <span className={styles.actionIcon}><AnimatePresence mode="popLayout" initial={false}><Swap key={item.read ? "unread" : "read"} className={styles.actionGlyph} initial={reduce ? { opacity: 0 } : iconIn} animate={shown} exit={reduce ? fadeOut : { ...iconIn, transition: exitFast }} transition={reduce ? instant : motionTokens.spring.snappy}>{item.read ? <CircleDot size={14} strokeWidth={1.75} aria-hidden="true" /> : <Check size={14} strokeWidth={1.75} aria-hidden="true" />}</Swap></AnimatePresence></span>
                        <SwapText reduce={reduce}>{item.read ? "标记未读" : "标记已读"}</SwapText>
                      </MorphWidth></button>
                      {onDismiss && <button type="button" onClick={() => dismiss(item)}><X size={14} strokeWidth={1.75} aria-hidden="true" />移除通知</button>}
                    </div>
                  </motion.div>}
                </AnimatePresence>
              </article>
            </motion.div>)}
            {/* The empty state opens its height on the same spring the rows close on, so the panel morphs between them instead of stacking both. After a bulk action it waits for the cascade to get going, so the panel never grows before it shrinks. */}
            {visible.length === 0 && <motion.div key="empty" className={styles.emptyFrame} initial={reduce ? { opacity: 0 } : { height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={reduce ? fadeOut : { height: 0, opacity: 0, transition: { height: motionTokens.spring.smooth, opacity: exitFast } }} transition={reduce ? instant : { height: { ...motionTokens.spring.smooth, delay: bulk ? cascade(3) : 0 }, opacity: { ...enter, delay: motionTokens.duration.fast } }}>
              <motion.div className={styles.empty} initial={reduce ? false : { y: 6 }} animate={{ y: 0 }} transition={reduce ? instant : { ...enter, delay: motionTokens.duration.fast }}><CircleCheck size={24} strokeWidth={1.5} aria-hidden="true" /><strong><SwapText reduce={reduce}>{status ?? (view === "unread" ? "暂无未读通知" : "暂无通知")}</SwapText></strong><p><SwapText reduce={reduce}>{status ? "可使用刷新通知重新读取。" : (view === "unread" ? "所有通知均已读。" : "新的离线告警将显示在这里。")}</SwapText></p>{view === "unread" && items.length > 0 && <button type="button" onClick={() => { setBulk(false); setView("all"); }}>查看全部通知</button>}</motion.div>
            </motion.div>}
          </AnimatePresence>
        </div>

        <AnimatePresence initial={false}>{(readCount > 0 || onRefresh) && <motion.div key="footer" className={styles.footerFrame} initial={reduce ? { opacity: 0 } : { height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={reduce ? fadeOut : { height: 0, opacity: 0, transition: { height: motionTokens.spring.smooth, opacity: exitFast } }} transition={height}>
          <div className={styles.footer}><span><RollingCount value={readCount} reduce={reduce} /> 条已读</span>{onDismiss && <button type="button" onClick={clearRead}>清除已读</button>}{onRefresh && <button type="button" disabled={disabled} onClick={onRefresh}>刷新通知</button>}</div>
        </motion.div>}</AnimatePresence>
      </PopoverPrimitive.Content>
    </PopoverPrimitive.Portal>
  </PopoverPrimitive.Root>;
}

export default NotificationCenter;
