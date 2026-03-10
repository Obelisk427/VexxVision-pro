import { useState, useRef, useEffect, type FormEvent, type KeyboardEvent } from 'react';
import type { CharacterQuery, Region } from '../types';

// ─── Realm data ──────────────────────────────────────────────────────────────

const US_REALMS = [
  'Area 52', 'Illidan', 'Stormrage', 'Tichondrius', 'Mal\'Ganis',
  'Bleeding Hollow', 'Barthilas', 'Frostmourne', 'Sargeras', 'Zul\'jin',
  'Proudmoore', 'Thrall', 'Kil\'jaeden', 'Emerald Dream', 'Kel\'Thuzad',
  'Whisperwind', 'Moon Guard', 'Lightbringer', 'Dalaran', 'Azuremyst',
];

const EU_REALMS = [
  'Silvermoon', 'Kazzak', 'Draenor', 'Twisting Nether', 'Defias Brotherhood',
  'Ravencrest', 'Tarren Mill', 'Stormscale', 'Ragnaros', 'Outland',
  'Frostwhisper', 'Burning Legion', 'Chamber of Aspects', 'Arathor', 'Ysera',
  'Argent Dawn', 'Light\'s Hope', 'Shattered Halls', 'Al\'Akir', 'Thunderhorn',
];

// ─── Props ────────────────────────────────────────────────────────────────────

interface SearchBarProps {
  onSearch: (query: CharacterQuery) => void;
  loading: boolean;
  /** When true, renders the compact header variant (no decorative chips). */
  compact?: boolean;
}

// ─── Realm Combobox ───────────────────────────────────────────────────────────

interface RealmComboboxProps {
  value: string;
  onChange: (v: string) => void;
  region: Region;
  disabled: boolean;
}

function RealmCombobox({ value, onChange, region, disabled }: RealmComboboxProps) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const allRealms = region === 'us' ? US_REALMS : EU_REALMS;
  const query = value.trim().toLowerCase();
  const filtered = query
    ? allRealms.filter((r) => r.toLowerCase().includes(query))
    : allRealms;

  // Close when clicking outside
  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
        setActiveIndex(-1);
      }
    }
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, []);

  // Scroll active item into view
  useEffect(() => {
    if (activeIndex >= 0 && listRef.current) {
      const item = listRef.current.children[activeIndex] as HTMLElement | undefined;
      item?.scrollIntoView({ block: 'nearest' });
    }
  }, [activeIndex]);

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (!open && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
      setOpen(true);
      setActiveIndex(0);
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, filtered.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter' && activeIndex >= 0 && filtered[activeIndex]) {
      e.preventDefault();
      onChange(filtered[activeIndex]);
      setOpen(false);
      setActiveIndex(-1);
    } else if (e.key === 'Escape') {
      setOpen(false);
      setActiveIndex(-1);
    }
  }

  function selectRealm(realm: string) {
    onChange(realm);
    setOpen(false);
    setActiveIndex(-1);
    inputRef.current?.focus();
  }

  return (
    <div ref={containerRef} className="relative flex-1 min-w-0">
      <div className="relative">
        <input
          id="search-realm"
          ref={inputRef}
          type="text"
          placeholder="Realm (e.g. Area 52)"
          value={value}
          autoComplete="off"
          disabled={disabled}
          onChange={(e) => {
            onChange(e.target.value);
            setOpen(true);
            setActiveIndex(-1);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={handleKeyDown}
          className="w-full bg-white/5 border border-white/10 text-white placeholder-slate-600 rounded-lg pl-4 pr-8 py-2.5 text-sm focus:outline-none focus:border-accent-violet/60 focus:ring-1 focus:ring-accent-violet/30 transition disabled:opacity-50"
        />
        {/* Chevron icon */}
        <span
          className={`absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none transition-transform duration-150 ${open ? 'rotate-180' : ''}`}
        >
          <svg className="w-3.5 h-3.5 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </span>
      </div>

      {/* Dropdown */}
      {open && filtered.length > 0 && (
        <ul
          ref={listRef}
          role="listbox"
          className="absolute z-50 mt-1.5 w-full max-h-52 overflow-y-auto rounded-lg border border-white/10 bg-bg-card shadow-2xl shadow-black/40 py-1"
        >
          {filtered.map((realm, i) => (
            <li
              key={realm}
              role="option"
              aria-selected={i === activeIndex}
              onMouseDown={(e) => { e.preventDefault(); selectRealm(realm); }}
              onMouseEnter={() => setActiveIndex(i)}
              className={`px-3 py-2 text-sm cursor-pointer transition-colors ${
                i === activeIndex
                  ? 'bg-accent-violet/20 text-white'
                  : 'text-slate-300 hover:bg-white/5'
              }`}
            >
              {realm}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ─── SearchBar ────────────────────────────────────────────────────────────────

export function SearchBar({ onSearch, loading, compact = false }: SearchBarProps) {
  const [name, setName] = useState('');
  const [realm, setRealm] = useState('');
  const [region, setRegion] = useState<Region>('us');
  const [validationError, setValidationError] = useState('');

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !realm.trim()) {
      setValidationError('Both character name and realm are required.');
      return;
    }
    setValidationError('');
    onSearch({ name: name.trim(), realm: realm.trim(), region });
  };

  return (
    <form onSubmit={handleSubmit} className="w-full">
      <div className="flex flex-col sm:flex-row gap-2.5">
        {/* Character name */}
        <input
          id="search-char-name"
          type="text"
          placeholder="Character Name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          disabled={loading}
          autoComplete="off"
          className="flex-1 min-w-0 bg-white/5 border border-white/10 text-white placeholder-slate-600 rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:border-accent-violet/60 focus:ring-1 focus:ring-accent-violet/30 transition disabled:opacity-50"
        />

        {/* Realm combobox */}
        <RealmCombobox
          value={realm}
          onChange={setRealm}
          region={region}
          disabled={loading}
        />

        {/* Region select */}
        <select
          id="search-region"
          value={region}
          onChange={(e) => { setRegion(e.target.value as Region); setRealm(''); }}
          disabled={loading}
          className="bg-white/5 border border-white/10 text-white rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:border-accent-violet/60 focus:ring-1 focus:ring-accent-violet/30 transition disabled:opacity-50 cursor-pointer"
        >
          <option value="us">US</option>
          <option value="eu">EU</option>
        </select>

        {/* Submit */}
        <button
          id="search-submit-btn"
          type="submit"
          disabled={loading}
          className="px-6 py-2.5 rounded-lg font-semibold text-sm text-white bg-gradient-to-r from-accent-violet to-accent-teal hover:brightness-110 active:scale-[0.97] transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 whitespace-nowrap"
        >
          {loading ? (
            <>
              <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin shrink-0" />
              {!compact && 'Searching…'}
            </>
          ) : (
            <>
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35M17 11A6 6 0 1 1 5 11a6 6 0 0 1 12 0z" />
              </svg>
              {!compact && 'Search'}
            </>
          )}
        </button>
      </div>

      {validationError && (
        <p className="text-red-400 text-xs mt-1.5">{validationError}</p>
      )}
    </form>
  );
}

