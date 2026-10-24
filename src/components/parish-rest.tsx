"use client";

import { Fragment, useEffect, useLayoutEffect, useRef, useState, type PointerEvent, type ReactNode } from "react";
import {
  historyParagraphs,
  historySubtitle,
  historyTitle,
  prayerBlocks,
  prayerTitle,
} from "@/content/parish-copy";

const ONES = ["", "፩", "፪", "፫", "፬", "፭", "፮", "፯", "፰", "፱"];
const TENS = ["", "፲", "፳", "፴", "፵", "፶", "፷", "፸", "፹", "፺"];
const DURATION = 17 * 60 + 26;
const PRAYER_AUDIO = "/melke-filipos.mp3";

type SheetTurn = { direction: "next" | "prev"; from: number; to: number };

function easeSheet(progress: number): number {
  const x1 = 0.645;
  const y1 = 0.045;
  const x2 = 0.355;
  const y2 = 1;
  const cx = 3 * x1;
  const bx = 3 * (x2 - x1) - cx;
  const ax = 1 - cx - bx;
  const cy = 3 * y1;
  const by = 3 * (y2 - y1) - cy;
  const ay = 1 - cy - by;
  const sampleX = (unit: number) => ((ax * unit + bx) * unit + cx) * unit;
  const sampleY = (unit: number) => ((ay * unit + by) * unit + cy) * unit;
  const slopeX = (unit: number) => (3 * ax * unit + 2 * bx) * unit + cx;
  let unit = progress;
  for (let step = 0; step < 6; step += 1) {
    const error = sampleX(unit) - progress;
    const slope = slopeX(unit);
    if (Math.abs(error) < 1e-4 || Math.abs(slope) < 1e-4) break;
    unit -= error / slope;
  }
  return sampleY(Math.min(1, Math.max(0, unit)));
}

function playTurn(node: HTMLElement, from: number, to: number, ms: number, signal: { stop: boolean }): Promise<void> {
  return new Promise((resolve) => {
    let settled = false;
    let timer = 0;
    const finish = () => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      if (!signal.stop) node.style.transform = `rotateY(${to}deg)`;
      resolve();
    };
    const start = performance.now();
    node.style.transition = "none";
    const step = () => {
      if (signal.stop) {
        finish();
        return;
      }
      const progress = Math.min(1, (performance.now() - start) / ms);
      const angle = from + (to - from) * easeSheet(progress);
      node.style.transform = `rotateY(${angle}deg)`;
      if (progress < 1) timer = window.setTimeout(step, 16);
      else finish();
    };
    step();
    window.setTimeout(finish, ms + 80);
  });
}

type Token = { word: string; paraBreak: boolean };

function geez(value: number): string {
  if (value < 100) return `${TENS[Math.floor(value / 10)]}${ONES[value % 10]}`;
  return String(value);
}

function tokenize(paragraphs: string[]): Token[] {
  const tokens: Token[] = [];
  paragraphs.forEach((paragraph, index) => {
    paragraph
      .trim()
      .split(/\s+/)
      .forEach((word, wordIndex) => {
        tokens.push({ word, paraBreak: wordIndex === 0 && index > 0 });
      });
  });
  return tokens;
}

function joinTokens(tokens: Token[], start: number, end: number): string {
  let text = "";
  for (let index = start; index < end; index += 1) {
    const token = tokens[index];
    if (!text) text = token.word;
    else if (token.paraBreak) text += `\n\n${token.word}`;
    else text += ` ${token.word}`;
  }
  return text;
}

function roughPages(paragraphs: string[]): string[] {
  const pages: string[] = [];
  let budget = 520;
  let current = "";
  paragraphs.forEach((paragraph) => {
    const next = current ? `${current}\n\n${paragraph}` : paragraph;
    if (current && next.length > budget) {
      pages.push(current);
      current = paragraph;
      budget = 860;
    } else {
      current = next;
    }
  });
  if (current) pages.push(current);
  return pages;
}

function renderCopy(text: string, dropCap: boolean): ReactNode {
  const source = dropCap ? text.slice(1) : text;
  const pieces = source.split(/(\([^)]+\))/g);
  return (
    <>
      {dropCap ? <span className="drop-cap">{text.slice(0, 1)}</span> : null}
      {pieces.map((piece, index) =>
        piece.startsWith("(") ? (
          <span className="cite" key={index}>
            {piece}
          </span>
        ) : (
          <span key={index}>{piece}</span>
        ),
      )}
    </>
  );
}

function Leaf({
  text,
  index,
  side,
}: {
  text: string | undefined;
  index: number;
  side: "left" | "right";
}) {
  const first = index === 0;
  return (
    <article className={`leaf leaf-${side}${first ? " is-first" : ""}`}>
      <header className="leaf-kicker">
        <span>{side === "left" ? "ታሪክ" : historySubtitle}</span>
        <img src="/design/book-rule.svg" width={480} height={1} alt="" />
      </header>
      {first ? (
        <div className="frontispiece">
          <h2>{historyTitle}</h2>
          <p>{historySubtitle}</p>
          <img src="/design/book-rule-title.svg" width={480} height={1} alt="" />
        </div>
      ) : null}
      <div className="leaf-body">
        {text ? <p className="leaf-copy">{renderCopy(text, first)}</p> : null}
      </div>
      {text ? <p className="folio">{geez(index + 1)}</p> : <p className="folio" />}
    </article>
  );
}

export function ParishRest(): ReactNode {
  return (
    <>
      <HistoryBook />
      <PrayerPanel />
      <footer className="colophon">
        <div className="seal">
          <img src="/design/footer-mark.png" width={52} height={52} alt="" />
        </div>
        <p>© 2026 ኢትዮጵያዊው ጃንደረባ ትውልድ</p>
      </footer>
    </>
  );
}

function HistoryBook(): ReactNode {
  const paperRef = useRef<HTMLDivElement>(null);
  const firstLimitRef = useRef<HTMLDivElement>(null);
  const restLimitRef = useRef<HTMLDivElement>(null);
  const probeRef = useRef<HTMLParagraphElement>(null);
  const [pages, setPages] = useState<string[]>(() => roughPages(historyParagraphs));
  const [spread, setSpread] = useState(0);
  const [sheet, setSheet] = useState<SheetTurn | null>(null);
  const sheetRef = useRef<HTMLDivElement>(null);
  const turnLock = useRef(false);

  useEffect(() => {
    const paper = paperRef.current;
    const probe = probeRef.current;
    if (!paper || !probe) return;

    const tokens = tokenize(historyParagraphs);

    const measure = (text: string, first: boolean) => {
      probe.replaceChildren();
      if (first && text) {
        const cap = document.createElement("span");
        cap.className = "drop-cap";
        cap.textContent = text.slice(0, 1);
        probe.append(cap, document.createTextNode(text.slice(1)));
      } else {
        probe.textContent = text;
      }
      return probe.scrollHeight;
    };

    const pack = () => {
      const mobile = window.matchMedia("(max-width: 800px)").matches;
      const liveLeaf = mobile
        ? paper.querySelector(".story-face .leaf")
        : paper.querySelector(".book-spread > .leaf-left:not(.leaf-gauge)");
      const columnWidth = liveLeaf?.querySelector(".leaf-body")?.clientWidth ?? 0;
      const gaugeRoot = mobile ? paper.querySelector(".story-slider") : paper.querySelector(".book-spread");
      if (liveLeaf && columnWidth > 40 && gaugeRoot) {
        for (const gauge of gaugeRoot.querySelectorAll<HTMLElement>(".leaf-gauge")) {
          gauge.style.width = `${liveLeaf.clientWidth}px`;
        }
      }

      const firstLimit = mobile
        ? (paper.querySelector(".story-slider .leaf-gauge-first .leaf-body")?.clientHeight ?? 0)
        : (firstLimitRef.current?.offsetHeight ?? 0);
      const restLimit = mobile
        ? (paper.querySelector(".story-slider .leaf-gauge-rest .leaf-body")?.clientHeight ?? 0)
        : (restLimitRef.current?.offsetHeight ?? 0);
      const width = columnWidth;
      if (firstLimit < 40 || restLimit < 40 || width < 40) return;

      probe.style.width = `${width}px`;
      const packed: string[] = [];
      let cursor = 0;
      while (cursor < tokens.length) {
        const first = packed.length === 0;
        const limit = (first ? firstLimit : restLimit) - 4;
        let low = cursor + 1;
        let high = tokens.length;
        let best = cursor;
        while (low <= high) {
          const mid = Math.floor((low + high) / 2);
          const height = measure(joinTokens(tokens, cursor, mid), first);
          if (height <= limit) {
            best = mid;
            low = mid + 1;
          } else {
            high = mid - 1;
          }
        }
        const end = Math.max(best, cursor + 1);
        packed.push(joinTokens(tokens, cursor, end));
        cursor = end;
      }

      setPages((current) =>
        current.length === packed.length && current.every((page, index) => page === packed[index])
          ? current
          : packed,
      );
      setSpread((current) => Math.min(current, Math.max(0, Math.ceil(packed.length / 2) - 1)));
    };

    const observer = new ResizeObserver(pack);
    observer.observe(paper);
    const slider = paper.querySelector(".story-viewport");
    if (slider) observer.observe(slider);
    if (firstLimitRef.current) observer.observe(firstLimitRef.current);
    if (restLimitRef.current) observer.observe(restLimitRef.current);
    document.fonts.ready.then(pack).catch(() => pack());
    pack();
    return () => observer.disconnect();
  }, []);

  const spreadCount = Math.max(1, Math.ceil(pages.length / 2));
  const left = pages[spread * 2];
  const right = pages[spread * 2 + 1];

  useLayoutEffect(() => {
    const node = sheetRef.current;
    if (!sheet || !node) return;
    const signal = { stop: false };
    const from = sheet.direction === "next" ? 0 : -180;
    const to = sheet.direction === "next" ? -180 : 0;
    playTurn(node, from, to, 900, signal).then(() => {
      if (signal.stop) return;
      setSpread(sheet.to);
      setSheet(null);
      turnLock.current = false;
    });
    return () => {
      signal.stop = true;
    };
  }, [sheet]);

  function turnTo(nextIndex: number) {
    if (turnLock.current) return;
    const target = Math.min(Math.max(nextIndex, 0), spreadCount - 1);
    if (target === spread) return;
    const direction = target > spread ? "next" : "prev";
    const reduce =
      window.matchMedia("(prefers-reduced-motion: reduce)").matches ||
      window.matchMedia("(max-width: 800px)").matches;
    if (reduce) {
      setSpread(target);
      return;
    }
    turnLock.current = true;
    setSheet({ direction, from: spread, to: target });
  }

  return (
    <section className="history" id="history" lang="am" aria-label="ታሪክ" ref={paperRef}>
      <div className="book">
        <div className="book-paper">
          <img className="book-edges" src="/design/book-edges.svg" width={1200} height={724} alt="" />
          <img
            className="book-surface"
            src="/design/book-surface.svg"
            width={1182}
            height={729}
            alt=""
          />
          <img className="book-spine" src="/design/book-spine.svg" width={65} height={728} alt="" />
          <div className="book-spread">
            <Leaf text={left} index={spread * 2} side="left" />
            <Leaf text={right} index={spread * 2 + 1} side="right" />
            {sheet ? (
              <>
                <div className={`page-under is-${sheet.direction}`} aria-hidden="true">
                  <Leaf
                    text={sheet.direction === "next" ? pages[sheet.to * 2 + 1] : pages[sheet.to * 2]}
                    index={sheet.direction === "next" ? sheet.to * 2 + 1 : sheet.to * 2}
                    side={sheet.direction === "next" ? "right" : "left"}
                  />
                </div>
                <div className={`sheet is-${sheet.direction}`} ref={sheetRef} aria-hidden="true">
                  <div className="sheet-face sheet-front">
                    <Leaf
                      text={sheet.direction === "next" ? pages[sheet.from * 2 + 1] : pages[sheet.to * 2 + 1]}
                      index={sheet.direction === "next" ? sheet.from * 2 + 1 : sheet.to * 2 + 1}
                      side="right"
                    />
                  </div>
                  <div className="sheet-face sheet-back">
                    <Leaf
                      text={sheet.direction === "next" ? pages[sheet.to * 2] : pages[sheet.from * 2]}
                      index={sheet.direction === "next" ? sheet.to * 2 : sheet.from * 2}
                      side="left"
                    />
                  </div>
                </div>
              </>
            ) : null}
            <div className="leaf leaf-gauge leaf-gauge-first" aria-hidden="true">
              <header className="leaf-kicker">
                <span>ታሪክ</span>
                <img src="/design/book-rule.svg" width={480} height={1} alt="" />
              </header>
              <div className="frontispiece">
                <h2>{historyTitle}</h2>
                <p>{historySubtitle}</p>
                <img src="/design/book-rule-title.svg" width={480} height={1} alt="" />
              </div>
              <div className="leaf-body" ref={firstLimitRef} />
              <p className="folio">፩</p>
            </div>
            <div className="leaf leaf-right leaf-gauge leaf-gauge-rest" aria-hidden="true">
              <header className="leaf-kicker">
                <span>{historySubtitle}</span>
                <img src="/design/book-rule.svg" width={480} height={1} alt="" />
              </header>
              <div className="leaf-body" ref={restLimitRef} />
              <p className="folio">፪</p>
            </div>
          </div>
        </div>

        <nav className="book-nav" aria-label="የመጽሐፍ ገጾች">
          {spread === 0 ? (
            <span className="book-nav-slot" />
          ) : (
            <button className="book-step" type="button" disabled={sheet !== null} onClick={() => turnTo(spread - 1)}>
              ← ቀዳሚ
            </button>
          )}
          <div className="book-spreads">
            {Array.from({ length: spreadCount }, (_, index) => {
              const label = `${geez(index * 2 + 1)}–${geez(index * 2 + 2)}`;
              const active = index === spread;
              return (
                <button
                  key={label}
                  className={active ? "spread-chip is-on" : "spread-chip"}
                  type="button"
                  aria-current={active ? "page" : undefined}
                  onClick={() => turnTo(index)}
                >
                  {active ? (
                    <img src="/design/chip-active.svg" width={53} height={28} alt="" />
                  ) : null}
                  <span>{label}</span>
                </button>
              );
            })}
          </div>
          <button
            className="book-step"
            type="button"
            disabled={sheet !== null || spread >= spreadCount - 1}
            onClick={() => turnTo(spread + 1)}
          >
            ቀጣይ →
          </button>
        </nav>
      </div>
      <StorySlider pages={pages} />
      <p className="leaf-copy leaf-probe" ref={probeRef} />
    </section>
  );
}

function playSlide(
  node: HTMLElement,
  from: number,
  to: number,
  ms: number,
  signal: { stop: boolean },
): Promise<void> {
  return new Promise((resolve) => {
    const started = performance.now();
    const frame = () => {
      if (signal.stop) {
        resolve();
        return;
      }
      const progress = Math.min(1, (performance.now() - started) / ms);
      const eased = progress < 0.5 ? 2 * progress * progress : 1 - ((-2 * progress + 2) ** 2) / 2;
      node.style.transform = `translateX(${from + (to - from) * eased}%)`;
      if (progress < 1) setTimeout(frame, 16);
      else resolve();
    };
    node.style.transform = `translateX(${from}%)`;
    setTimeout(frame, 16);
  });
}

function StorySlider({ pages }: { pages: string[] }): ReactNode {
  const [card, setCard] = useState(0);
  const [glide, setGlide] = useState<{ from: number; to: number } | null>(null);
  const pairRef = useRef<HTMLDivElement>(null);
  const start = useRef({ x: 0, y: 0 });
  const index = Math.min(card, Math.max(0, pages.length - 1));

  useLayoutEffect(() => {
    const node = pairRef.current;
    if (!glide || !node) return;
    const signal = { stop: false };
    const forward = glide.to > glide.from;
    playSlide(node, forward ? 0 : -50, forward ? -50 : 0, 420, signal).then(() => {
      if (signal.stop) return;
      setCard(glide.to);
      setGlide(null);
    });
    return () => {
      signal.stop = true;
    };
  }, [glide]);

  function slideTo(next: number) {
    const target = Math.min(Math.max(next, 0), pages.length - 1);
    if (glide || target === index) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setCard(target);
      return;
    }
    setGlide({ from: index, to: target });
  }

  function onPointerDown(event: PointerEvent<HTMLDivElement>) {
    start.current = { x: event.clientX, y: event.clientY };
  }

  function onPointerUp(event: PointerEvent<HTMLDivElement>) {
    const dx = event.clientX - start.current.x;
    const dy = event.clientY - start.current.y;
    if (Math.abs(dx) < 48 || Math.abs(dx) < Math.abs(dy)) return;
    slideTo(index + (dx < 0 ? 1 : -1));
  }

  const forward = glide ? glide.to > glide.from : true;
  const leading = glide ? (forward ? glide.from : glide.to) : index;
  const trailing = glide ? (forward ? glide.to : glide.from) : index;

  return (
    <div className="story-slider">
      <div
        className="story-viewport"
        onPointerDown={onPointerDown}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        {glide ? (
          <div key="glide" className="story-pair" ref={pairRef}>
            <div className="story-face">
              <Leaf text={pages[leading]} index={leading} side="left" />
            </div>
            <div className="story-face">
              <Leaf text={pages[trailing]} index={trailing} side="left" />
            </div>
          </div>
        ) : (
          <div key="rest" className="story-face">
            <Leaf text={pages[index]} index={index} side="left" />
          </div>
        )}
        <div className="leaf leaf-gauge leaf-gauge-first" aria-hidden="true">
          <header className="leaf-kicker">
            <span>ታሪክ</span>
            <img src="/design/book-rule.svg" width={480} height={1} alt="" />
          </header>
          <div className="frontispiece">
            <h2>{historyTitle}</h2>
            <p>{historySubtitle}</p>
            <img src="/design/book-rule-title.svg" width={480} height={1} alt="" />
          </div>
          <div className="leaf-body" />
          <p className="folio">፩</p>
        </div>
        <div className="leaf leaf-right leaf-gauge leaf-gauge-rest" aria-hidden="true">
          <header className="leaf-kicker">
            <span>ታሪክ</span>
            <img src="/design/book-rule.svg" width={480} height={1} alt="" />
          </header>
          <div className="leaf-body" />
          <p className="folio">፪</p>
        </div>
      </div>
      <nav className="story-nav" aria-label="የታሪክ ገጾች">
        <button className="book-step" type="button" disabled={glide !== null || index === 0} onClick={() => slideTo(index - 1)}>
          ← ቀዳሚ
        </button>
        <div className="story-pages">
          {pages.map((_, page) => (
            <button
              key={page}
              className={page === index ? "spread-chip is-on" : "spread-chip"}
              type="button"
              aria-current={page === index ? "page" : undefined}
              onClick={() => slideTo(page)}
            >
              {page === index ? <img src="/design/chip-active.svg" width={53} height={28} alt="" /> : null}
              <span>{geez(page + 1)}</span>
            </button>
          ))}
        </div>
        <button
          className="book-step"
          type="button"
          disabled={glide !== null || index >= pages.length - 1}
          onClick={() => slideTo(index + 1)}
        >
          ቀጣይ →
        </button>
      </nav>
    </div>
  );
}

function formatTime(seconds: number): string {
  const whole = Math.max(0, Math.round(seconds));
  const minutes = Math.floor(whole / 60);
  const remain = whole % 60;
  return `${minutes}:${String(remain).padStart(2, "0")}`;
}

const RED_STANZAS = new Set([3, 8, 12, 17, 22]);

function PrayerStanza({ text, accent }: { text: string; accent: boolean }): ReactNode {
  const lines = text.split("\n");
  return (
    <p className="prayer-stanza">
      {lines.map((line, index) => {
        const marked = accent && index === lines.length - 1;
        return (
          <Fragment key={index}>
            {index > 0 ? <br /> : null}
            {marked ? <span className="is-close">{line}</span> : line}
          </Fragment>
        );
      })}
    </p>
  );
}

function PrayerPanel(): ReactNode {
  const railRef = useRef<HTMLDivElement>(null);
  const copyRef = useRef<HTMLDivElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(DURATION);
  const [playing, setPlaying] = useState(false);
  const [thumb, setThumb] = useState(0);
  const dragging = useRef(false);
  const barDrag = useRef(false);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const onTime = () => setTime(audio.currentTime);
    const onMeta = () => {
      if (Number.isFinite(audio.duration) && audio.duration > 0) setDuration(audio.duration);
    };
    const onEnd = () => {
      setPlaying(false);
      setTime(Number.isFinite(audio.duration) ? audio.duration : 0);
    };
    onMeta();
    audio.addEventListener("timeupdate", onTime);
    audio.addEventListener("loadedmetadata", onMeta);
    audio.addEventListener("durationchange", onMeta);
    audio.addEventListener("ended", onEnd);
    return () => {
      audio.removeEventListener("timeupdate", onTime);
      audio.removeEventListener("loadedmetadata", onMeta);
      audio.removeEventListener("durationchange", onMeta);
      audio.removeEventListener("ended", onEnd);
    };
  }, []);

  useEffect(() => {
    const node = copyRef.current;
    if (!node) return;
    const sync = () => {
      const range = node.scrollHeight - node.clientHeight;
      setThumb(range <= 1 ? 0 : node.scrollTop / range);
    };
    sync();
    node.addEventListener("scroll", sync, { passive: true });
    const observer = new ResizeObserver(sync);
    observer.observe(node);
    return () => {
      node.removeEventListener("scroll", sync);
      observer.disconnect();
    };
  }, []);

  const ratio = duration > 0 ? Math.min(1, Math.max(0, time / duration)) : 0;

  const seek = (next: number) => {
    const audio = audioRef.current;
    const limit = audio && Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : duration;
    const clamped = Math.min(limit, Math.max(0, next));
    if (audio) audio.currentTime = clamped;
    setTime(clamped);
  };

  const seekTo = (clientX: number) => {
    const rail = railRef.current;
    if (!rail) return;
    const rect = rail.getBoundingClientRect();
    const next = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    seek(next * duration);
  };

  const scrollFromBar = (clientY: number) => {
    const bar = barRef.current;
    const copy = copyRef.current;
    if (!bar || !copy) return;
    const rect = bar.getBoundingClientRect();
    const travel = rect.height - 52;
    const next = travel <= 0 ? 0 : (clientY - rect.top - 16 - 10) / travel;
    const range = copy.scrollHeight - copy.clientHeight;
    copy.scrollTop = Math.min(1, Math.max(0, next)) * Math.max(0, range);
  };

  const nudgeCopy = (delta: number) => {
    copyRef.current?.scrollBy({ top: delta, behavior: "smooth" });
  };

  const play = () => {
    const audio = audioRef.current;
    if (!audio) return;
    const limit = Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : duration;
    if (audio.currentTime >= limit - 0.25) audio.currentTime = 0;
    audio.play().then(() => setPlaying(true)).catch(() => setPlaying(false));
  };

  const pause = () => {
    audioRef.current?.pause();
    setPlaying(false);
  };

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    dragging.current = true;
    event.currentTarget.setPointerCapture(event.pointerId);
    seekTo(event.clientX);
  };

  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!dragging.current) return;
    seekTo(event.clientX);
  };

  const onPointerUp = () => {
    dragging.current = false;
  };

  const onBarDown = (event: PointerEvent<HTMLDivElement>) => {
    if ((event.target as HTMLElement).closest("button")) return;
    barDrag.current = true;
    event.currentTarget.setPointerCapture(event.pointerId);
    scrollFromBar(event.clientY);
  };

  const onBarMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!barDrag.current) return;
    scrollFromBar(event.clientY);
  };

  return (
    <section className="prayer" id="prayer" lang="am" aria-label="ፀሎት">
      <audio ref={audioRef} src={PRAYER_AUDIO} preload="metadata" />
      <img className="prayer-ground" src="/design/prayer-ground.svg" width={1460} height={1154} alt="" />
      <div className="prayer-inner">
        <h2 className="prayer-kicker">የቅዱስ ፊልጶስ መልክ</h2>
        <div className="prayer-card">
          <h3 className="prayer-title">
            {prayerTitle.map((line) => (
              <span key={line}>
                {line}
                <br />
              </span>
            ))}
          </h3>
          <hr className="prayer-rule" />
          <div className="prayer-scroll">
            <div className="prayer-copy" ref={copyRef}>
              {prayerBlocks.map((block, index) => {
                if (block.kind === "note") {
                  return (
                    <p className="prayer-note" key={index}>
                      {block.text}
                    </p>
                  );
                }
                const stanzaIndex = prayerBlocks
                  .slice(0, index)
                  .filter((item) => item.kind === "stanza").length;
                return <PrayerStanza key={index} text={block.text} accent={RED_STANZAS.has(stanzaIndex)} />;
              })}
            </div>
            <div
              className="prayer-bar"
              ref={barRef}
              onPointerDown={onBarDown}
              onPointerMove={onBarMove}
              onPointerUp={() => {
                barDrag.current = false;
              }}
            >
              <button
                className="prayer-nub prayer-nub-up"
                type="button"
                aria-label="ጽሑፉን ወደ ላይ"
                onPointerDown={(event) => event.stopPropagation()}
                onClick={() => nudgeCopy(-120)}
              >
                <svg width="8" height="6" viewBox="0 0 8 6" aria-hidden="true">
                  <path d="M4 0.6 L7.2 5.2 H0.8 Z" fill="#630014" />
                </svg>
              </button>
              <span className="prayer-bar-thumb" style={{ top: `calc(16px + ${thumb} * (100% - 52px))` }} />
              <button
                className="prayer-nub prayer-nub-down"
                type="button"
                aria-label="ጽሑፉን ወደ ታች"
                onPointerDown={(event) => event.stopPropagation()}
                onClick={() => nudgeCopy(120)}
              >
                <svg width="8" height="6" viewBox="0 0 8 6" aria-hidden="true">
                  <path d="M4 5.4 L0.8 0.8 H7.2 Z" fill="#630014" />
                </svg>
              </button>
            </div>
          </div>
          <hr className="prayer-rule" />
          <div className="transport">
            <div className="scrub">
              <span className="time">{formatTime(time)}</span>
              <div
                className="rail"
                ref={railRef}
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
                role="slider"
                aria-label="የፀሎት ጊዜ"
                aria-valuemin={0}
                aria-valuemax={Math.round(duration)}
                aria-valuenow={Math.round(time)}
                aria-valuetext={formatTime(time)}
                tabIndex={0}
                onKeyDown={(event) => {
                  if (event.key === "ArrowRight") seek(time + 5);
                  if (event.key === "ArrowLeft") seek(time - 5);
                }}
              >
                <img src="/design/scrub-track.svg" width={620} height={20} alt="" />
                <span className="rail-played" style={{ width: `${ratio * 96.12}%` }} />
                <span className="rail-open" style={{ left: `${1.94 + ratio * 96.12}%` }} />
                <img
                  className="rail-thumb"
                  src="/design/scrub-thumb.svg"
                  width={40}
                  height={40}
                  alt=""
                  style={{ left: `${1.94 + ratio * 96.12}%` }}
                />
              </div>
              <span className="time">{formatTime(duration)}</span>
            </div>
            <div className="transport-buttons">
              <button type="button" aria-label={playing ? "ለአፍታ አቁም" : "አጫውት"} onClick={() => (playing ? pause() : play())}>
                <img
                  src={playing ? "/design/control-pause.svg" : "/design/control-next.svg"}
                  width={playing ? 33 : 35}
                  height={35}
                  alt=""
                />
              </button>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
