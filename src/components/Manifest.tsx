import { useEffect, useRef } from "react";
import type { GraphNode } from "../lib/types";
import { titleCase } from "../lib/theme";

const shortName = (s: string) => s.replace(/^[^—]+—\s*/, "").trim() || s;
import { FILTER_KEYS } from "../hooks/useManifest";
import { Reader } from "./Reader";

interface Props {
  nodes: GraphNode[];
  projects: { id: string; label: string }[];
  m: ReturnType<typeof import("../hooks/useManifest").useManifest>;
  onHover: (n: GraphNode | null) => void;
}

/** Highlights the matched run inside a title so search results are scannable. */
function Highlight({ text, q }: { text: string; q: string }) {
  const needle = q.trim();
  if (!needle) return <>{text}</>;
  const i = text.toUpperCase().indexOf(needle.toUpperCase());
  if (i < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, i)}
      <mark>{text.slice(i, i + needle.length)}</mark>
      {text.slice(i + needle.length)}
    </>
  );
}

export function Manifest({ nodes, projects, m, onHover }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Keyboard: / or cmd-K focuses search, arrows walk the list, enter opens,
  // escape steps back out one level at a time.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const el = e.target as HTMLElement;
      const inInput = el.tagName === "INPUT";

      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault(); inputRef.current?.focus(); inputRef.current?.select(); return;
      }
      if (e.key === "/" && !inInput) { e.preventDefault(); inputRef.current?.focus(); return; }

      if (inInput) {
        if (e.key === "Escape") {
          if (m.query) m.setQuery(""); else inputRef.current?.blur();
        }
        if (e.key === "ArrowDown") { e.preventDefault(); inputRef.current?.blur(); m.moveCursor(1); }
        if (e.key === "Enter") {
          e.preventDefault(); inputRef.current?.blur();
          if (m.cursor < 0) m.moveCursor(1);
          else m.setSelectedId(m.walkable[m.cursor]?.id ?? null);
        }
        return;
      }

      if (e.key === "Escape") {
        if (m.selected) m.setSelectedId(null);
        else if (m.projectId) m.setProjectId(null);
        return;
      }
      if (m.selected) {
        if (e.key === "ArrowDown" || e.key === "j") { e.preventDefault(); m.stepSelection(1); }
        if (e.key === "ArrowUp" || e.key === "k") { e.preventDefault(); m.stepSelection(-1); }
        return;
      }
      if (e.key === "ArrowDown" || e.key === "j") { e.preventDefault(); m.moveCursor(1); }
      if (e.key === "ArrowUp" || e.key === "k") { e.preventDefault(); m.moveCursor(-1); }
      if (e.key === "Enter") {
        e.preventDefault();
        const n = m.walkable[m.cursor];
        if (n) m.setSelectedId(n.id);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [m]);

  // Keep the keyboard cursor in view as it moves.
  useEffect(() => {
    if (m.cursor < 0) return;
    const n = m.walkable[m.cursor];
    if (!n) return;
    listRef.current?.querySelector<HTMLElement>(`[data-id="${CSS.escape(n.id)}"]`)
      ?.scrollIntoView({ block: "nearest" });
    onHover(n);
  }, [m.cursor, m.walkable, onHover]);

  const cursorId = m.cursor >= 0 ? m.walkable[m.cursor]?.id : null;
  const cls = [
    "manifest",
    m.selected ? "reading" : "",
    m.isSearching ? "searching" : "",
    m.isFiltered ? "filtered" : "",
    m.visible.length === 0 ? "noresults" : "",
  ].filter(Boolean).join(" ");

  return (
    <aside className={cls}>
      <div className="pane index">
        <div className="m-head">
          <div className="m-title"><span className="big">PIERRE</span></div>

          <div className="search">
            <input
              ref={inputRef}
              value={m.query}
              onChange={e => m.setQuery(e.target.value)}
              placeholder="Search documents"
              autoComplete="off"
              spellCheck={false}
              aria-label="Search documents"
            />
            {m.isSearching
              ? <span className="clear" onClick={() => { m.setQuery(""); inputRef.current?.focus(); }}>CLEAR</span>
              : <span className="k">⌘K</span>}
          </div>

          <div className="fbar">
            <span className="lab">FILTER</span>
            <span className="reset" onClick={m.resetFilters}>RESET</span>
          </div>
          <div className="filters">
            {FILTER_KEYS.map(k => (
              <div
                key={k}
                className="f"
                role="checkbox"
                tabIndex={0}
                aria-checked={m.active.has(k)}
                aria-pressed={m.active.has(k)}
                onClick={() => m.toggleFilter(k)}
                onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); m.toggleFilter(k); } }}
              >{k.toUpperCase()}</div>
            ))}
          </div>
        </div>

        {(m.isSearching || m.isFiltered) && (
          <div className="rescount">{m.visible.length} OF {nodes.length} DOCUMENTS</div>
        )}
        {m.visible.length === 0 && <div className="empty">No documents match.</div>}

        <div className="list" ref={listRef}>
          {projects.map(p => {
            const rows = m.visible.filter(n => (n.project ?? "team") === p.id);
            if (!rows.length) return null;
            const open = m.sectionOpen(p.id);
            return (
              <div key={p.id} className={`sec${open ? " open" : ""}${m.projectId === p.id ? " on" : ""}`}>
                <div
                  className="sec-h"
                  role="button"
                  tabIndex={0}
                  aria-expanded={open}
                  onClick={e => {
                    if (e.altKey) { m.setSelectedId(null); m.setProjectId(m.projectId === p.id ? null : p.id); return; }
                    m.toggleSection(p.id);
                  }}
                  onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); m.toggleSection(p.id); } }}
                >
                  <span className="nm">{p.label}</span>
                  <span className="chev" />
                </div>
                <div className="rows"><div>
                  {rows.map(n => (
                    <div
                      key={n.id}
                      data-id={n.id}
                      className={[
                        "row",
                        m.selectedId === n.id ? "sel" : "",
                        m.neighbourIds.has(n.id) ? "nb" : "",
                        m.selectedId && m.selectedId !== n.id && !m.neighbourIds.has(n.id) ? "dim" : "",
                        cursorId === n.id ? "cursor" : "",
                      ].filter(Boolean).join(" ")}
                      onMouseEnter={() => onHover(n)}
                      onMouseLeave={() => onHover(null)}
                      onClick={() => m.setSelectedId(n.id)}
                    >
                      <div className="t"><Highlight text={titleCase(shortName(n.name))} q={m.query} /></div>
                    </div>
                  ))}
                </div></div>
              </div>
            );
          })}
        </div>
      </div>

      <Reader nodes={nodes} projects={projects} m={m} onHover={onHover} />
    </aside>
  );
}
