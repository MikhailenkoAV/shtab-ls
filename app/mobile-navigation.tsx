"use client";

import { useEffect, useId, useRef, useState } from "react";

type NavItem<T extends string> = { id: T; label: string; glyph: string };

export function MobileNavigation<T extends string>({ active, primary, secondary, onNavigate }: {
  active: T; primary: NavItem<T>[]; secondary: NavItem<T>[]; onNavigate: (view: T) => void;
}) {
  const [open, setOpen] = useState(false);
  const titleId = useId();
  const menuRef = useRef<HTMLElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const overflow = document.body.style.overflow;
    const trigger = triggerRef.current;
    document.body.style.overflow = "hidden";
    menuRef.current?.focus();
    const media = window.matchMedia("(max-width: 760px)");
    const resize = () => { if (!media.matches) setOpen(false); };
    media.addEventListener("change", resize);
    return () => { media.removeEventListener("change", resize); document.body.style.overflow = overflow; trigger?.focus(); };
  }, [open]);
  function navigate(id: T) { setOpen(false); onNavigate(id); window.scrollTo({ top: 0 }); }
  return <>
    <nav className="quick-nav mobile-nav" aria-label="Основные разделы">
      {primary.map((item) => <button key={item.id} className={active === item.id ? "active" : ""} aria-current={active === item.id ? "page" : undefined} onClick={() => navigate(item.id)}><span aria-hidden="true">{item.glyph}</span>{item.label}</button>)}
      <button ref={triggerRef} className={secondary.some((item) => item.id === active) ? "active" : ""} aria-expanded={open} aria-haspopup="dialog" onClick={() => setOpen(true)}><span aria-hidden="true">⋯</span>Ещё</button>
    </nav>
    {open && <div className="mobile-menu-backdrop" onMouseDown={(event) => { if (event.currentTarget === event.target) setOpen(false); }}><section ref={menuRef} className="mobile-menu" tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby={titleId} onKeyDown={(event) => {
      if (event.key === "Escape") { setOpen(false); return; }
      if (event.key !== "Tab") return;
      const controls = [...(menuRef.current?.querySelectorAll<HTMLButtonElement>("button") ?? [])];
      const first = controls[0]; const last = controls.at(-1);
      if (event.shiftKey && (document.activeElement === first || document.activeElement === menuRef.current)) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || document.activeElement === menuRef.current)) { event.preventDefault(); first?.focus(); }
    }}><header><h2 id={titleId}>Разделы сайта</h2><button className="modal-close" aria-label="Закрыть меню" onClick={() => setOpen(false)}>×</button></header><nav aria-label="Дополнительные разделы">{secondary.map((item) => <button key={item.id} className={active === item.id ? "active" : ""} aria-current={active === item.id ? "page" : undefined} onClick={() => navigate(item.id)}><span aria-hidden="true">{item.glyph}</span>{item.label}<span aria-hidden="true">›</span></button>)}</nav></section></div>}
  </>;
}
