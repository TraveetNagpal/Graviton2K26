import React, { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import styles from './Landing.module.css';

const SECTIONS = [
  { id: 'hero', index: '01', label: 'Overview' },
  { id: 'capabilities', index: '02', label: 'Capabilities' },
  { id: 'method', index: '03', label: 'Method' },
  { id: 'begin', index: '04', label: 'Begin' },
];

const CAPABILITIES = [
  {
    index: 'I',
    title: 'Observe',
    copy:
      'A living basemap in 2D and 3D. Search a coordinate, draw a footprint, and read every scene at ten-metre resolution.',
    cta: 'Open the Explorer',
    meta: 'MapLibre · Cesium · Google satellite',
    to: '/explorer',
  },
  {
    index: 'II',
    title: 'Analyse',
    copy:
      'Send observations to Earth Engine for vegetation, water, temperature, and land-cover change — with statistics returned beside the map.',
    cta: 'Run an analysis',
    meta: 'Google Earth Engine',
    to: '/explorer',
  },
  {
    index: 'III',
    title: 'Monitor',
    copy:
      'Register a region once. Every scheduled pass is compared with its baseline, and meaningful change surfaces as an alert.',
    cta: 'Open monitoring',
    meta: 'Automated passes · alerts',
    to: '/dashboard',
  },
  {
    index: 'IV',
    title: 'Report',
    copy:
      'Bind observations and measurements into a dated record, then export it as PDF, CSV, or GeoJSON.',
    cta: 'View reports',
    meta: 'PDF · CSV · GeoJSON',
    to: '/reports',
  },
];

const STEPS = [
  {
    title: 'Choose a place',
    body:
      'Search, drop a pin, or draw a polygon. The selection becomes the area of interest for everything that follows.',
    signal: '46.8182° N · 8.2275° E',
    rows: [
      ['Sensor', 'Sentinel-2 MSI'],
      ['Resolution', '10 m'],
      ['Footprint', 'Arbitrary polygon'],
    ],
  },
  {
    title: 'Ask a question',
    body:
      'Pick a method and a set of observations. The request is sent to Earth Engine, reduced over your footprint, and returned as statistics and map layers.',
    signal: 'COMPUTING · SENTINEL-2',
    rows: [
      ['Product', 'S2_SR_HARMONIZED'],
      ['Index', 'NDVI / NDWI / NBR'],
      ['Reducers', 'mean · median · max'],
    ],
  },
  {
    title: 'Read the change',
    body:
      'Compare scenes, inspect the layer, and carry the result into monitoring or a signed, dated report.',
    signal: 'Δ NDVI · 0.42 → 0.38',
    rows: [
      ['Output', 'GeoTIFF · statistics'],
      ['Link', 'Analysis · report'],
      ['Export', 'PDF · CSV · GeoJSON'],
    ],
  },
];

const METRICS = [
  { value: 1972, suffix: '', label: 'Landsat archive begins' },
  { value: 13, suffix: '', label: 'Sentinel-2 bands per scene' },
  { value: 24, suffix: '/7', label: 'Automated monitoring' },
];

function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

function Counter({ to, suffix }: { to: number; suffix: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [value, setValue] = useState(0);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    if (prefersReducedMotion() || !('IntersectionObserver' in window)) {
      setValue(to);
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        observer.disconnect();
        const start = performance.now();
        const duration = 1600;
        const tick = (now: number) => {
          const progress = Math.min(1, (now - start) / duration);
          const eased = 1 - Math.pow(1 - progress, 3);
          setValue(to * eased);
          if (progress < 1) requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      },
      { threshold: 0.6 }
    );

    observer.observe(element);
    return () => observer.disconnect();
  }, [to]);

  return (
    <span ref={ref}>
      {Math.round(value)}
      {suffix}
    </span>
  );
}

export default function Landing() {
  const pageRef = useRef<HTMLDivElement>(null);
  const heroRef = useRef<HTMLElement>(null);
  const visualRef = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(0);
  const [progress, setProgress] = useState(0);
  const [openStep, setOpenStep] = useState(0);

  useEffect(() => {
    const page = pageRef.current;
    if (!page) return;
    const elements = Array.from(
      page.querySelectorAll<HTMLElement>('[data-reveal]')
    );

    if (prefersReducedMotion() || !('IntersectionObserver' in window)) {
      elements.forEach((element) => element.classList.add(styles.visible));
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          entry.target.classList.add(styles.visible);
          observer.unobserve(entry.target);
        });
      },
      { root: page, threshold: 0.12, rootMargin: '0px 0px -6% 0px' }
    );

    elements.forEach((element) => observer.observe(element));
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const page = pageRef.current;
    if (!page) return;
    let frame = 0;

    const update = () => {
      frame = 0;
      const max = page.scrollHeight - page.clientHeight;
      setProgress(max > 0 ? Math.min(1, page.scrollTop / max) : 0);

      const probe = page.scrollTop + page.clientHeight * 0.4;
      let current = 0;
      SECTIONS.forEach((section, index) => {
        const element = page.querySelector<HTMLElement>(`#${section.id}`);
        if (element && element.offsetTop <= probe) current = index;
      });
      setActive(current);

      if (visualRef.current && !prefersReducedMotion()) {
        const shift = Math.min(page.scrollTop, page.clientHeight) * 0.16;
        visualRef.current.style.setProperty('--scroll-shift', `${shift}px`);
      }
    };

    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };

    update();
    page.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    return () => {
      page.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, []);

  useEffect(() => {
    const hero = heroRef.current;
    const visual = visualRef.current;
    if (!hero || !visual || prefersReducedMotion()) return;
    let frame = 0;

    const onMove = (event: PointerEvent) => {
      if (event.pointerType === 'touch' || frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        const rect = hero.getBoundingClientRect();
        const x = (event.clientX - rect.left) / rect.width - 0.5;
        const y = (event.clientY - rect.top) / rect.height - 0.5;
        visual.style.setProperty('--pointer-x', `${(x * 26).toFixed(2)}px`);
        visual.style.setProperty('--pointer-y', `${(y * 16).toFixed(2)}px`);
      });
    };

    const onLeave = () => {
      visual.style.setProperty('--pointer-x', '0px');
      visual.style.setProperty('--pointer-y', '0px');
    };

    hero.addEventListener('pointermove', onMove);
    hero.addEventListener('pointerleave', onLeave);
    return () => {
      hero.removeEventListener('pointermove', onMove);
      hero.removeEventListener('pointerleave', onLeave);
      if (frame) cancelAnimationFrame(frame);
    };
  }, []);

  function goTo(id: string) {
    const page = pageRef.current;
    const target = page?.querySelector<HTMLElement>(`#${id}`);
    if (!page || !target) return;
    page.scrollTo({
      top: target.offsetTop,
      behavior: prefersReducedMotion() ? 'auto' : 'smooth',
    });
  }

  const step = STEPS[openStep] ?? STEPS[0];

  return (
    <div ref={pageRef} className={styles.page}>
      <div className={styles.grain} aria-hidden="true" />
      <div className={styles.vignette} aria-hidden="true" />

      <div className={styles.progress} aria-hidden="true">
        <span
          className={styles.progressBar}
          style={{ transform: `scaleX(${progress})` }}
        />
      </div>

      <nav className={styles.rail} aria-label="Page sections">
        {SECTIONS.map((section, index) => (
          <button
            key={section.id}
            type="button"
            onClick={() => goTo(section.id)}
            className={`${styles.railItem} ${
              index === active ? styles.railActive : ''
            }`}
            aria-label={`Go to ${section.label}`}
            aria-current={index === active ? 'location' : undefined}
            title={section.label}
          >
            <span className={styles.railIndex}>{section.index}</span>
            <span className={styles.railDot} />
          </button>
        ))}
      </nav>

      <section
        id="hero"
        ref={heroRef}
        className={`${styles.section} ${styles.hero}`}
      >
        <div className={styles.heroGlow} aria-hidden="true" />
        <div ref={visualRef} className={styles.heroVisual} aria-hidden="true">
          <img src="/images/earth-horizon.jpg" alt="" draggable={false} />
        </div>
        <div className={styles.heroShade} aria-hidden="true" />

        <div className={styles.heroInner}>
          <p className={styles.eyebrow} data-reveal>
            Planetary intelligence
          </p>

          <h1
            className={styles.heroTitle}
            data-reveal
            style={{ '--reveal-delay': '90ms' } as React.CSSProperties}
          >
            Observe the Earth
            <br />
            <em>as it changes.</em>
          </h1>

          <p
            className={styles.heroCopy}
            data-reveal
            style={{ '--reveal-delay': '180ms' } as React.CSSProperties}
          >
            Satellite analysis, automated monitoring, and traceable reports —
            brought together in one quiet, precise workspace.
          </p>

          <div
            className={styles.heroActions}
            data-reveal
            style={{ '--reveal-delay': '270ms' } as React.CSSProperties}
          >
            <Link to="/explorer" className={styles.cta}>
              Enter the Explorer <span aria-hidden="true">→</span>
            </Link>
            <Link to="/dashboard" className={styles.ghost}>
              Explore monitoring
            </Link>
          </div>

          <div
            className={styles.heroFoot}
            data-reveal
            style={{ '--reveal-delay': '360ms' } as React.CSSProperties}
          >
            <span className={styles.coords}>46.8182° N · 8.2275° E</span>
            <span className={styles.heroRule} aria-hidden="true" />
            <button
              type="button"
              className={styles.scrollCue}
              onClick={() => goTo('capabilities')}
            >
              Scroll to explore <span aria-hidden="true">↓</span>
            </button>
          </div>
        </div>
      </section>

      <section id="capabilities" className={styles.section}>
        <div className={styles.wrap}>
          <header className={styles.sectionHead} data-reveal>
            <div>
              <p className={styles.kicker}>
                <span>02</span> Capabilities
              </p>
              <h2 className={styles.sectionTitle}>
                One surface, <em>four instruments.</em>
              </h2>
            </div>
            <p className={styles.sectionNote}>
              Everything the platform does, arranged around a single question:
              what changed here?
            </p>
          </header>

          <div className={styles.capGrid}>
            {CAPABILITIES.map((capability, index) => (
              <Link
                key={capability.title}
                to={capability.to}
                className={styles.capCard}
                data-reveal
                style={
                  {
                    '--reveal-delay': `${index * 90}ms`,
                  } as React.CSSProperties
                }
              >
                <span className={styles.capTop}>
                  <span className={styles.capIndex}>{capability.index}</span>
                  <span className={styles.capArrow} aria-hidden="true">
                    ↗
                  </span>
                </span>
                <h3>{capability.title}</h3>
                <p>{capability.copy}</p>
                <span className={styles.capCta}>
                  {capability.cta} <span aria-hidden="true">→</span>
                </span>
                <span className={styles.capMeta}>{capability.meta}</span>
              </Link>
            ))}
          </div>
        </div>
      </section>

      <section id="method" className={styles.section}>
        <div className={styles.wrap}>
          <header className={styles.sectionHead} data-reveal>
            <div>
              <p className={styles.kicker}>
                <span>03</span> Method
              </p>
              <h2 className={styles.sectionTitle}>
                From orbit to <em>insight.</em>
              </h2>
            </div>
            <p className={styles.sectionNote}>
              Three steps, no black boxes. Select the place, choose the
              measurement, read the result.
            </p>
          </header>

          <div className={styles.methodGrid}>
            <div className={styles.steps} data-reveal>
              {STEPS.map((item, index) => {
                const isOpen = index === openStep;
                return (
                  <div
                    key={item.title}
                    className={`${styles.step} ${isOpen ? styles.stepOpen : ''}`}
                  >
                    <button
                      type="button"
                      className={styles.stepHead}
                      onClick={() => setOpenStep(isOpen ? -1 : index)}
                      aria-expanded={isOpen}
                      aria-controls={`step-panel-${index}`}
                    >
                      <span className={styles.stepNum}>
                        {String(index + 1).padStart(2, '0')}
                      </span>
                      <span className={styles.stepTitle}>{item.title}</span>
                      <span className={styles.stepIcon} aria-hidden="true" />
                    </button>
                    <div
                      id={`step-panel-${index}`}
                      className={styles.stepBody}
                      aria-hidden={!isOpen}
                    >
                      <div className={styles.stepBodyInner}>
                        <p>{item.body}</p>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            <aside className={styles.readout} data-reveal>
              <div className={styles.readoutHead}>
                <span>Live readout</span>
                <span className={styles.readoutDot} aria-hidden="true" />
              </div>
              <div key={openStep} className={styles.readoutBody}>
                <p className={styles.readoutSignal}>{step.signal}</p>
                <dl className={styles.readoutRows}>
                  {step.rows.map(([term, value]) => (
                    <div key={term} className={styles.readoutRow}>
                      <dt>{term}</dt>
                      <dd>{value}</dd>
                    </div>
                  ))}
                </dl>
                <p className={styles.readoutNote}>
                  Values shown are the shape of a real response, not a
                  placeholder map.
                </p>
              </div>
            </aside>
          </div>
        </div>
      </section>

      <section id="begin" className={`${styles.section} ${styles.begin}`}>
        <div className={styles.wrap}>
          <div className={styles.metrics} data-reveal>
            {METRICS.map((metric) => (
              <div key={metric.label} className={styles.metric}>
                <span className={styles.metricValue}>
                  <Counter to={metric.value} suffix={metric.suffix} />
                </span>
                <p>{metric.label}</p>
              </div>
            ))}
          </div>

          <div className={styles.beginBody} data-reveal>
            <p className={styles.kicker}>
              <span>04</span> Begin
            </p>
            <h2 className={styles.beginTitle}>
              Start with a<br />
              <em>single observation.</em>
            </h2>
            <Link to="/explorer" className={styles.cta}>
              Open the Earth Explorer <span aria-hidden="true">→</span>
            </Link>
          </div>

          <footer className={styles.footer}>
            <span>TerraMind AI</span>
            <span className={styles.footerNote}>
              Earth observation, made legible.
            </span>
            <span>© {new Date().getFullYear()}</span>
          </footer>
        </div>
      </section>
    </div>
  );
}
