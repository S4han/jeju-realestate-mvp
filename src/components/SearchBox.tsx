import { useEffect, useId, useRef, useState } from "react";
import { searchApartments, type ApartmentListItem, type CityCode } from "../api";
import { CITY_LABEL, displayAddress } from "../format";

type Props = { city: CityCode | ""; onSelect: (item: ApartmentListItem) => void };

// Apartment name autocomplete (FR-001, FR-003): debounced, cancels stale requests, keyboard navigable.
export function SearchBox({ city, onSelect }: Props) {
  const [q, setQ] = useState("");
  const [items, setItems] = useState<ApartmentListItem[]>([]);
  const [state, setState] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const listId = useId();
  const blurTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    const term = q.trim();
    if (!term) {
      setItems([]);
      setState("idle");
      return;
    }
    const ctrl = new AbortController();
    const t = setTimeout(() => {
      setState("loading");
      searchApartments(term, city, ctrl.signal)
        .then((r) => {
          setItems(r.items);
          setActive(-1);
          setState("done");
        })
        .catch((e) => {
          if ((e as Error).name !== "AbortError") setState("error");
        });
    }, 200);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [q, city]);

  const choose = (item: ApartmentListItem) => {
    setQ(item.name);
    setOpen(false);
    onSelect(item);
  };

  return (
    <div className="relative">
      <input
        type="search"
        role="combobox"
        aria-expanded={open && items.length > 0}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-label="아파트명 검색"
        placeholder="아파트명 검색 (예: 노형, 부영)"
        value={q}
        maxLength={30}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => (blurTimer.current = setTimeout(() => setOpen(false), 150))}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") setActive((i) => Math.min(i + 1, items.length - 1));
          else if (e.key === "ArrowUp") setActive((i) => Math.max(i - 1, 0));
          else if (e.key === "Enter" && items[active >= 0 ? active : 0]) choose(items[active >= 0 ? active : 0]!);
          else if (e.key === "Escape") setOpen(false);
        }}
        className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-base outline-none focus:border-sky-600"
      />
      {open && q.trim() && (
        <ul id={listId} role="listbox" className="absolute z-30 mt-1 max-h-80 w-full overflow-auto rounded-lg border border-slate-200 bg-white shadow-lg">
          {state === "loading" && items.length === 0 && <li className="px-3 py-2 text-sm text-slate-500">검색 중…</li>}
          {state === "error" && <li className="px-3 py-2 text-sm text-red-700">검색 서버에 연결할 수 없습니다.</li>}
          {state === "done" && items.length === 0 && <li className="px-3 py-2 text-sm text-slate-500">일치하는 아파트가 없습니다.</li>}
          {items.map((it, i) => (
            <li
              key={it.id}
              role="option"
              aria-selected={i === active}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => choose(it)}
              className={`cursor-pointer px-3 py-2 ${i === active ? "bg-sky-50" : ""}`}
            >
              <div className="text-sm font-medium">{it.name}</div>
              {/* Address distinguishes same-named complexes (AT-003). */}
              <div className="text-xs text-slate-500">
                {CITY_LABEL[it.city_code]} · {displayAddress(it.road_address, it.lot_address)}
                {it.lat === null && " · 위치 미확인"}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
