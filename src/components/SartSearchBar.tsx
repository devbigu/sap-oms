"use client";

import { useState, useRef, useEffect } from "react";
import { useSmartSearch, SearchResult } from "@/hooks/useSmartSearch";

type Role = "admin" | "dealer" | "staff" | "accountant";

interface SmartSearchBarProps {
  role: Role;
  userId?: string | number;
  placeholder?: string;
}

const CATEGORY_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  dealers:  { bg: "rgba(83,74,183,0.18)",  text: "#a99ef7", border: "rgba(83,74,183,0.4)" },
  staff:    { bg: "rgba(29,158,117,0.18)", text: "#5de0b3", border: "rgba(29,158,117,0.4)" },
  orders:   { bg: "rgba(239,159,39,0.18)", text: "#f5c065", border: "rgba(239,159,39,0.4)" },
  products: { bg: "rgba(55,138,221,0.18)", text: "#78bbf0", border: "rgba(55,138,221,0.4)" },
  results:  { bg: "rgba(255,255,255,0.08)", text: "rgba(255,255,255,0.55)", border: "rgba(255,255,255,0.15)" },
};

const CATEGORY_ICONS: Record<string, string> = {
  dealers: "🏢",
  staff: "👤",
  orders: "📦",
  products: "🛍️",
  results: "🔍",
};

function Badge({ category }: { category: string }) {
  const c = CATEGORY_COLORS[category] || CATEGORY_COLORS.results;
  return (
    <span style={{
      fontSize: 10,
      fontWeight: 600,
      letterSpacing: "0.05em",
      textTransform: "uppercase",
      padding: "2px 7px",
      borderRadius: 5,
      background: c.bg,
      color: c.text,
      border: `1px solid ${c.border}`,
      flexShrink: 0,
      fontFamily: "'DM Sans', sans-serif",
    }}>
      {category}
    </span>
  );
}

export default function SmartSearchBar({ role, userId, placeholder }: SmartSearchBarProps) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [focused, setFocused] = useState(false);
  const [activeIdx, setActiveIdx] = useState(-1);
  const wrapRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const { results, loading, geminiSuggestion, search, navigate, navigateToGeminiSuggestion } =
    useSmartSearch({ role, id: userId });

  // Trigger search on query change
  useEffect(() => {
    if (query.trim().length >= 2) {
      search(query);
      setOpen(true);
    } else {
      setOpen(false);
    }
  }, [query, search]);

  // Close on outside click
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
        setFocused(false);
      }
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const allItems: (SearchResult | { type: "gemini"; route: string })[] = [
    ...(geminiSuggestion
      ? [{ type: "gemini" as const, route: geminiSuggestion }]
      : []),
    ...results,
  ];

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIdx((i) => Math.min(i + 1, allItems.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIdx((i) => Math.max(i - 1, -1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (activeIdx >= 0) {
        const item = allItems[activeIdx];
        if ("type" in item && item.type === "gemini") {
          navigateToGeminiSuggestion();
        } else {
          navigate((item as SearchResult).route);
        }
        setQuery("");
      } else if (geminiSuggestion) {
        navigateToGeminiSuggestion();
        setQuery("");
      }
    } else if (e.key === "Escape") {
      setOpen(false);
      inputRef.current?.blur();
    }
  }

  const showDropdown = open && (loading || results.length > 0 || geminiSuggestion);

  return (
    <>
      <style>{`
        .ss-wrap {
          flex: 1;
          max-width: 480px;
          margin: 0 16px;
          position: relative;
          font-family: 'DM Sans', sans-serif;
        }
        .ss-input-row {
          display: flex;
          align-items: center;
          gap: 8px;
          background: rgba(255,255,255,0.09);
          border: 1px solid rgba(255,255,255,0.13);
          border-radius: 10px;
          padding: 0 12px;
          height: 38px;
          transition: border-color .2s, background .2s;
        }
        .ss-input-row.focused {
          border-color: rgba(99,102,241,0.6);
          background: rgba(255,255,255,0.12);
        }
        .ss-icon { color: rgba(255,255,255,0.45); flex-shrink: 0; display: flex; align-items: center; }
        .ss-input {
          flex: 1;
          background: transparent;
          border: none;
          outline: none;
          font-size: 13.5px;
          color: #fff;
          font-family: 'DM Sans', sans-serif;
        }
        .ss-input::placeholder { color: rgba(255,255,255,0.35); }
        .ss-clear {
          background: none; border: none; cursor: pointer;
          color: rgba(255,255,255,0.4); font-size: 18px; line-height: 1;
          padding: 0; flex-shrink: 0; transition: color .15s;
        }
        .ss-clear:hover { color: rgba(255,255,255,0.75); }
        .ss-spinner {
          width: 14px; height: 14px; border-radius: 50%;
          border: 2px solid rgba(255,255,255,0.2);
          border-top-color: #a99ef7;
          animation: ss-spin .6s linear infinite;
          flex-shrink: 0;
        }
        @keyframes ss-spin { to { transform: rotate(360deg); } }

        .ss-dropdown {
          position: absolute;
          top: calc(100% + 6px);
          left: 0; right: 0;
          background: #1a1a2e;
          border: 1px solid rgba(255,255,255,0.12);
          border-radius: 12px;
          overflow: hidden;
          box-shadow: 0 12px 40px rgba(0,0,0,0.5);
          z-index: 9999;
          animation: ss-fade .12s ease;
        }
        @keyframes ss-fade { from { opacity:0; transform: translateY(-4px); } to { opacity:1; transform:none; } }

        .ss-gemini-row {
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 9px 14px;
          cursor: pointer;
          background: rgba(99,102,241,0.12);
          border-bottom: 1px solid rgba(255,255,255,0.07);
          transition: background .15s;
        }
        .ss-gemini-row:hover, .ss-gemini-row.active {
          background: rgba(99,102,241,0.22);
        }
        .ss-gemini-chip {
          font-size: 10px; font-weight: 700; letter-spacing: .06em;
          text-transform: uppercase; padding: 2px 7px;
          border-radius: 5px; flex-shrink: 0;
          background: rgba(99,102,241,0.3); color: #c4c6ff;
          border: 1px solid rgba(99,102,241,0.5);
        }
        .ss-gemini-label {
          font-size: 13px; color: rgba(255,255,255,0.8);
          overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
        }
        .ss-gemini-route {
          margin-left: auto; font-size: 11px;
          color: rgba(99,102,241,0.8); flex-shrink: 0;
        }

        .ss-section-label {
          font-size: 10px; font-weight: 700; letter-spacing: .08em;
          text-transform: uppercase; color: rgba(255,255,255,0.3);
          padding: 8px 14px 4px;
        }
        .ss-result-row {
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 8px 14px;
          cursor: pointer;
          transition: background .12s;
        }
        .ss-result-row:hover, .ss-result-row.active {
          background: rgba(255,255,255,0.07);
        }
        .ss-result-icon {
          font-size: 14px; flex-shrink: 0; width: 28px; height: 28px;
          border-radius: 7px; background: rgba(255,255,255,0.06);
          display: flex; align-items: center; justify-content: center;
        }
        .ss-result-label {
          flex: 1; font-size: 13px; color: rgba(255,255,255,0.88);
          overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 500;
        }
        .ss-result-sub {
          font-size: 11px; color: rgba(255,255,255,0.4);
          overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
          max-width: 140px;
        }

        .ss-empty {
          padding: 14px; text-align: center;
          font-size: 13px; color: rgba(255,255,255,0.3);
        }
        .ss-footer {
          padding: 7px 14px;
          border-top: 1px solid rgba(255,255,255,0.06);
          display: flex; align-items: center; gap: 6px;
          font-size: 11px; color: rgba(255,255,255,0.25);
        }
        .ss-footer kbd {
          background: rgba(255,255,255,0.08); border-radius: 4px;
          padding: 1px 5px; font-size: 10px; font-family: monospace;
          color: rgba(255,255,255,0.4); border: 1px solid rgba(255,255,255,0.12);
        }
      `}</style>

      <div className="ss-wrap" ref={wrapRef}>
        {/* Input row — exact same visual as original .dl-search-wrap */}
        <div className={`ss-input-row${focused ? " focused" : ""}`}>
          <span className="ss-icon">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" />
            </svg>
          </span>
          <input
            ref={inputRef}
            type="text"
            className="ss-input"
            value={query}
            placeholder={placeholder || "Smart search with AI…"}
            autoComplete="off"
            onChange={(e) => { setQuery(e.target.value); setActiveIdx(-1); }}
            onFocus={() => setFocused(true)}
            onKeyDown={handleKeyDown}
          />
          {loading && <span className="ss-spinner" />}
          {query && !loading && (
            <button
              className="ss-clear"
              onClick={() => { setQuery(""); setOpen(false); setActiveIdx(-1); }}
            >×</button>
          )}
        </div>

        {/* Dropdown */}
        {showDropdown && (
          <div className="ss-dropdown">
            {/* Gemini AI suggestion row */}
            {geminiSuggestion && (() => {
              const gIdx = 0;
              return (
                <div
                  className={`ss-gemini-row${activeIdx === gIdx ? " active" : ""}`}
                  onClick={() => { navigateToGeminiSuggestion(); setQuery(""); setOpen(false); }}
                  onMouseEnter={() => setActiveIdx(gIdx)}
                >
                  <span className="ss-gemini-chip">AI</span>
                  <span className="ss-gemini-label">Navigate to best match</span>
                  <span className="ss-gemini-route">{geminiSuggestion}</span>
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="rgba(99,102,241,0.7)" strokeWidth="2.5" strokeLinecap="round">
                    <path d="M5 12h14M12 5l7 7-7 7" />
                  </svg>
                </div>
              );
            })()}

            {/* Live results grouped by category */}
            {results.length > 0 ? (() => {
              const categories = [...new Set(results.map((r) => r.category))];
              let rowIdx = geminiSuggestion ? 1 : 0;
              return categories.map((cat) => {
                const items = results.filter((r) => r.category === cat);
                return (
                  <div key={cat}>
                    <div className="ss-section-label">{cat}</div>
                    {items.map((item) => {
                      const idx = rowIdx++;
                      return (
                        <div
                          key={`${item.category}-${item.id}`}
                          className={`ss-result-row${activeIdx === idx ? " active" : ""}`}
                          onClick={() => { navigate(item.route); setQuery(""); setOpen(false); }}
                          onMouseEnter={() => setActiveIdx(idx)}
                        >
                          <span className="ss-result-icon">
                            {CATEGORY_ICONS[item.category] || "🔍"}
                          </span>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div className="ss-result-label">{item.label}</div>
                            {item.sublabel && (
                              <div className="ss-result-sub">{item.sublabel}</div>
                            )}
                          </div>
                          <Badge category={item.category} />
                        </div>
                      );
                    })}
                  </div>
                );
              });
            })() : (
              !loading && (
                <div className="ss-empty">
                  No results found for "{query}"
                </div>
              )
            )}

            {/* Keyboard hint footer */}
            <div className="ss-footer">
              <kbd>↑↓</kbd> navigate &nbsp;·&nbsp; <kbd>↵</kbd> open &nbsp;·&nbsp; <kbd>esc</kbd> close
            </div>
          </div>
        )}
      </div>
    </>
  );
}