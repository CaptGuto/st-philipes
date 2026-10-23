"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { ParishRest } from "@/components/parish-rest";

const FRAME_COUNT = 80;
const FRAME_BEHIND = 2;
const FRAME_AHEAD = 10;

function frameSrc(index: number): string {
  return `/frame-webp/frame_${String(index + 1).padStart(3, "0")}.webp`;
}

function drawCover(
  canvas: HTMLCanvasElement,
  image: ImageBitmap,
): void {
  const context = canvas.getContext("2d");
  if (!context || !image.width) return;

  const canvasRatio = canvas.width / canvas.height;
  const imageRatio = image.width / image.height;
  let width = canvas.width;
  let height = canvas.height;
  let x = 0;
  let y = 0;

  if (imageRatio > canvasRatio) {
    width = canvas.height * imageRatio;
    x = (canvas.width - width) / 2;
  } else {
    height = canvas.width / imageRatio;
    y = (canvas.height - height) / 2;
  }

  context.clearRect(0, 0, canvas.width, canvas.height);
  context.drawImage(image, x, y, width, height);
}

function bindFilmToScroll(
  stage: HTMLElement,
  canvas: HTMLCanvasElement,
  topbar: HTMLElement,
): () => void {
  const root = document.documentElement;
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const frames: Array<ImageBitmap | undefined> = [];
  const inflight = new Map<number, AbortController>();
  let raf = 0;
  let stageHeight = 0;
  let wanted = 0;
  let shown = -1;

  const sizeStage = () => {
    const step = window.innerWidth < 800 ? 42 : 86;
    const next = window.innerHeight + FRAME_COUNT * step;
    if (Math.abs(next - stageHeight) < 1) return;
    stageHeight = next;
    stage.style.height = `${next}px`;
  };

  const fitCanvas = () => {
    const rect = canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const width = Math.max(1, Math.round(rect.width * dpr));
    const height = Math.max(1, Math.round(rect.height * dpr));
    if (canvas.width === width && canvas.height === height) return false;
    canvas.width = width;
    canvas.height = height;
    shown = -1;
    return true;
  };

  const nearestReady = (index: number): number => {
    if (frames[index]) return index;
    for (let distance = 1; distance < FRAME_COUNT; distance += 1) {
      if (frames[index - distance]) return index - distance;
      if (frames[index + distance]) return index + distance;
    }
    return -1;
  };

  const paint = (index: number) => {
    const image = frames[index];
    if (!image) return;
    fitCanvas();
    drawCover(canvas, image);
    shown = index;
    canvas.dataset.frame = String(index + 1);
  };

  const release = (index: number) => {
    inflight.get(index)?.abort();
    inflight.delete(index);
    frames[index]?.close();
    frames[index] = undefined;
    if (shown === index) shown = -1;
  };

  const load = (index: number) => {
    if (frames[index] || inflight.has(index)) return;
    const controller = new AbortController();
    inflight.set(index, controller);

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const targetWidth = Math.max(1, Math.round(window.innerWidth * dpr));

    fetch(frameSrc(index), { signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error(`Frame ${index + 1} failed`);
        return response.blob();
      })
      .then((blob) =>
        createImageBitmap(blob, {
          resizeWidth: targetWidth,
          resizeQuality: "high",
        }),
      )
      .then((bitmap) => {
        if (controller.signal.aborted || inflight.get(index) !== controller) {
          bitmap.close();
          return;
        }
        frames[index] = bitmap;
        inflight.delete(index);
        if (index === wanted || shown < 0) paint(nearestReady(wanted));
      })
      .catch(() => {
        if (inflight.get(index) === controller) inflight.delete(index);
      });
  };

  const syncWindow = (center: number) => {
    const start = Math.max(0, center - FRAME_BEHIND);
    const end = Math.min(FRAME_COUNT - 1, center + FRAME_AHEAD);
    for (let index = 0; index < FRAME_COUNT; index += 1) {
      if (index < start || index > end) release(index);
      else load(index);
    }
  };

  const apply = () => {
    sizeStage();
    const distance = Math.max(stage.offsetHeight - window.innerHeight, 1);
    const scrolled = Math.min(Math.max(-stage.getBoundingClientRect().top, 0), distance);
    const t = scrolled / distance;
    wanted = Math.round(t * (FRAME_COUNT - 1));
    syncWindow(wanted);
    const resized = fitCanvas();
    const ready = frames[wanted] ? wanted : nearestReady(wanted);
    if (ready >= 0 && (resized || ready !== shown)) paint(ready);

    const end = reduce ? 0 : Math.min(Math.max((t - 0.82) / 0.18, 0), 1);
    const span = (from: number, to: number) =>
      Math.min(Math.max((t - from) / (to - from), 0), 1);
    const open = reduce ? 1 : 1 - span(0.2, 0.36);
    const title = reduce ? 0 : span(0.4, 0.54);
    root.style.setProperty("--film-blur", `${(end * 2).toFixed(2)}px`);
    root.style.setProperty("--film-shade", (0.1 + end * 0.08).toFixed(3));
    root.style.setProperty("--film-scale", "1.03");
    root.style.setProperty("--film-dim", (1 - end * 0.05).toFixed(3));
    root.style.setProperty("--line-open", open.toFixed(3));
    root.style.setProperty("--line-title", title.toFixed(3));
    topbar.classList.toggle("is-solid", stage.getBoundingClientRect().bottom <= 72);
  };

  const onScroll = () => {
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(apply);
  };

  window.addEventListener("scroll", onScroll, { passive: true });
  window.addEventListener("resize", onScroll);
  apply();

  return () => {
    cancelAnimationFrame(raf);
    window.removeEventListener("scroll", onScroll);
    window.removeEventListener("resize", onScroll);
    for (let index = 0; index < FRAME_COUNT; index += 1) release(index);
  };
}

export function ScrollFilm(): ReactNode {
  const stageRef = useRef<HTMLElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const topbarRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const query = window.matchMedia("(max-width: 800px)");
    let stop = () => {};
    const sync = () => {
      stop();
      stop = () => {};
      if (query.matches) return;
      const stage = stageRef.current;
      const canvas = canvasRef.current;
      const topbar = topbarRef.current;
      if (!stage || !canvas || !topbar) return;
      stop = bindFilmToScroll(stage, canvas, topbar);
    };
    sync();
    query.addEventListener("change", sync);
    return () => {
      query.removeEventListener("change", sync);
      stop();
    };
  }, []);

  return (
    <>
      <header className="topbar" ref={topbarRef}>
        <a className="hero-seal" href="#top" aria-label="ዋና ገጽ">
          <img src="/design/hero/seal-ring.svg" width={51} height={51} alt="" />
          <img className="hero-seal-mark" src="/design/hero/mark.png" width={35} height={35} alt="" />
        </a>
        <span>ቅዱስ ፊልጶስ</span>
        <span>ኢትዮጲያዊው ጃንደረባ ትውልድ</span>
      </header>

      <section className="stage" ref={stageRef}>
        <div className="film">
          <canvas
            ref={canvasRef}
            className="film-canvas"
            aria-label="St. Philipos, advancing frame by frame as you scroll"
          />
          <div className="film-shade" />
          <div className="hero">
            <p className="hero-open" lang="am">
              ቅዱስ ፊልጶስ ኢትዮጲያዊውን ባኮስ አጥምቆ ክርስትናን ወደ ኢትዮጵያ እንዲገባ አደረገ
            </p>
            <h1 className="hero-title" lang="am">
              የወንጌላዊው ቅዱስ ፊልጶስ ዝክር
            </h1>
          </div>
        </div>
      </section>

      <section className="figma-hero" id="top" lang="am" aria-label="ዋና ገጽ">
        <div className="figma-hero-wash" />
        <img className="figma-hero-art" src="/design/hero/background.png" alt="" />
        <div className="figma-hero-shade" />
        <img className="figma-hero-header" src="/design/hero/header.svg" width={1440} height={88} alt="" />
        <header className="figma-hero-bar">
          <a className="figma-seal" href="#top" aria-label="ዋና ገጽ">
            <img src="/design/hero/seal-ring.svg" width={51} height={51} alt="" />
            <img className="figma-seal-mark" src="/design/hero/mark.png" width={35} height={35} alt="" />
          </a>
          <a className="figma-cta" href="#prayer">
            ጃን ፊልጶስ
          </a>
        </header>
        <div className="figma-hero-copy">
          <p className="figma-badge">
            <img src="/design/hero/badge.svg" width={351} height={37} alt="" />
            <span>የኢትዮጵያ ኦርቶዶክስ ተዋሕዶ እርቅ</span>
          </p>
          <img className="figma-plate" src="/design/hero/title-plate.svg" width={525} height={36} alt="" />
          <h1>
            ቅዱስ <span>ፊልጶስ</span> ወንጌላዊ
          </h1>
          <p>
            የቀዳሚው እርቅ ዲያቆን፣ የኢትዮጵያ ጃንደረባ መምህር፣
            <br />
            በኢትዮጵያ ወንጌልን በመጀመሪያ የተከለ።
          </p>
          <a className="figma-cta figma-cta-main" href="#prayer">
            መልካ ቅዱስ ፊልጶስ
          </a>
        </div>
      </section>

      <ParishRest />
    </>
  );
}
