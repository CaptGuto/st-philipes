"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { ParishRest } from "@/components/parish-rest";

const FRAME_COUNT = 80;
const FRAME_READY = Math.ceil(FRAME_COUNT * 0.9);
const FRAME_BEHIND = 2;
const FRAME_AHEAD = 10;
const PRAYER_AUDIO = "/melke-filipos.mp3";

const frameBlobs = new Map<number, Blob>();
const primedFrames = new Map<number, ImageBitmap>();
let primeTask: Promise<void> | null = null;

function frameSrc(index: number): string {
  return `/frame-medium/frame_${String(index + 1).padStart(3, "0")}.webp`;
}

async function runPool(tasks: Array<() => Promise<void>>, limit: number): Promise<void> {
  let cursor = 0;
  const worker = async () => {
    while (cursor < tasks.length) {
      const current = cursor;
      cursor += 1;
      await tasks[current]();
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, () => worker()));
}

async function loadFrameBlob(index: number, signal: AbortSignal): Promise<void> {
  if (frameBlobs.has(index)) return;
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    if (signal.aborted) throw new DOMException("Aborted", "AbortError");
    try {
      const response = await fetch(frameSrc(index), { signal });
      if (!response.ok) throw new Error(`Frame ${index + 1} failed`);
      frameBlobs.set(index, await response.blob());
      return;
    } catch (error) {
      if (signal.aborted) throw error;
      lastError = error;
    }
  }
  throw lastError;
}

function loadImage(src: string): Promise<void> {
  return new Promise((resolve) => {
    const image = new Image();
    image.onload = () => resolve();
    image.onerror = () => resolve();
    image.src = src;
  });
}

function loadAudio(src: string, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const audio = new Audio();
    const finish = () => {
      audio.removeEventListener("canplaythrough", finish);
      audio.removeEventListener("error", finish);
      resolve();
    };
    signal.addEventListener("abort", finish, { once: true });
    audio.preload = "auto";
    audio.addEventListener("canplaythrough", finish, { once: true });
    audio.addEventListener("error", finish, { once: true });
    audio.src = src;
    audio.load();
  });
}

function primeFirstFrame(): Promise<void> {
  if (primeTask) return primeTask;
  const blob = frameBlobs.get(0);
  if (!blob) return Promise.resolve();
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const targetWidth = Math.max(1, Math.round(window.innerWidth * dpr));
  primeTask = createImageBitmap(blob, { resizeWidth: targetWidth, resizeQuality: "high" })
    .then((bitmap) => {
      primedFrames.set(0, bitmap);
    })
    .catch(() => {
      primeTask = null;
    });
  return primeTask;
}

async function preloadSite(onProgress: (ratio: number) => void, signal: AbortSignal): Promise<void> {
  const mobile = window.matchMedia("(max-width: 800px)").matches;
  const frameTarget = mobile ? 0 : FRAME_READY;
  const images = mobile
    ? [
        "/design/hero/background.png",
        "/design/hero/mark.png",
        "/design/hero/seal-ring.svg",
        "/design/hero/badge.svg",
        "/design/hero/title-plate.svg",
        "/design/hero/header.svg",
      ]
    : ["/design/hero/mark.png", "/design/hero/seal-ring.svg"];
  const total = frameTarget + images.length + 1;
  let done = 0;
  const tick = () => onProgress(total === 0 ? 1 : done / total);
  const tasks: Array<() => Promise<void>> = [];

  for (let index = 0; index < frameTarget; index += 1) {
    tasks.push(async () => {
      try {
        await loadFrameBlob(index, signal);
      } catch (error) {
        if (signal.aborted) throw error;
      } finally {
        if (!signal.aborted) {
          done += 1;
          tick();
        }
      }
    });
  }

  for (const src of images) {
    tasks.push(async () => {
      await loadImage(src);
      if (signal.aborted) return;
      done += 1;
      tick();
    });
  }

  tasks.push(async () => {
    await loadAudio(PRAYER_AUDIO, signal);
    if (signal.aborted) return;
    done += 1;
    tick();
  });

  await runPool(tasks, 6);
  if (signal.aborted) throw new DOMException("Aborted", "AbortError");
  if (!mobile) await primeFirstFrame();
  onProgress(1);
}

function BootScreen({ progress }: { progress: number }): ReactNode {
  const percent = Math.round(progress * 100);
  return (
    <div className="boot" role="status" aria-live="polite" aria-label="በመጫን ላይ">
      <div className="boot-seal" aria-hidden="true">
        <img src="/design/hero/seal-ring.svg" width={128} height={128} alt="" />
        <img className="boot-mark" src="/design/hero/mark.png" width={88} height={88} alt="" />
      </div>
      <div className="boot-track" aria-hidden="true">
        <span style={{ width: `${percent}%` }} />
      </div>
    </div>
  );
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
    const primed = primedFrames.get(index);
    if (primed) {
      primedFrames.delete(index);
      frames[index] = primed;
      if (index === wanted || shown < 0) paint(nearestReady(wanted));
      return;
    }
    const controller = new AbortController();
    inflight.set(index, controller);

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const targetWidth = Math.max(1, Math.round(window.innerWidth * dpr));
    const cached = frameBlobs.get(index);
    const blobTask = cached
      ? Promise.resolve(cached)
      : fetch(frameSrc(index), { signal: controller.signal }).then((response) => {
          if (!response.ok) throw new Error(`Frame ${index + 1} failed`);
          return response.blob();
        });

    blobTask
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
  const [progress, setProgress] = useState(0);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    document.documentElement.classList.add("is-booting");
    preloadSite((ratio) => {
      if (active) setProgress(ratio);
    }, controller.signal)
      .catch(() => undefined)
      .then(() => {
        if (!active || controller.signal.aborted) return;
        document.documentElement.classList.remove("is-booting");
        setReady(true);
      });
    return () => {
      active = false;
      controller.abort();
      document.documentElement.classList.remove("is-booting");
    };
  }, []);

  useEffect(() => {
    if (!ready) return;
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
  }, [ready]);

  if (!ready) return <BootScreen progress={progress} />;

  return (
    <>
      <header className="topbar" ref={topbarRef}>
        <a className="hero-seal" href="#top" aria-label="ዋና ገጽ">
          <img src="/design/hero/seal-ring.svg" width={51} height={51} alt="" />
          <img className="hero-seal-mark" src="/design/hero/mark.png" width={35} height={35} alt="" />
        </a>
        <span>ጃን ፊልጶስ</span>
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
          <img className="film-logo" src="/logo.png" width={176} height={232} alt="ጃን ፊልጶስ" />
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
            ቅዱስ ፊልጶስ ኢትዮጲያዊውን ባኮስ አጥምቆ ክርስትናን ወደ ኢትዮጵያ እንዲገባ አደረገ
            <br />
            በኢትዮጵያ ወንጌልን በመጀመሪያ የተከለ።
          </p>
          <a className="figma-cta figma-cta-main" href="#prayer">
            መልክዐ ቅዱስ ፊልጶስ
          </a>
        </div>
      </section>

      <ParishRest />
    </>
  );
}
