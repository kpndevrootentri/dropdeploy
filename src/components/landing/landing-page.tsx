'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { ThemeToggle } from '@/components/theme-toggle';
import {
  Rocket,
  Zap,
  Shield,
  GitBranch,
  Eye,
  ArrowRight,
  Check,
  Code,
  Globe,
  Link2,
  ChevronRight,
  Lock,
  Copy,
  ExternalLink,
  Loader2,
  CheckCircle2,
  RefreshCw,
  LayoutDashboard,
  Compass,
  BookOpen,
  Terminal,
  Package,
} from 'lucide-react';

function useInView(threshold = 0.12) {
  const ref = useRef<HTMLDivElement>(null);
  const [inView, setInView] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setInView(true);
          observer.disconnect();
        }
      },
      { threshold }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [threshold]);

  return { ref, inView };
}

function AnimatedSection({
  children,
  className,
  delay = 0,
}: {
  children: React.ReactNode;
  className?: string;
  delay?: number;
}) {
  const { ref, inView } = useInView();
  return (
    <div
      ref={ref}
      className={className}
      style={{
        opacity: inView ? 1 : 0,
        transform: inView ? 'translateY(0)' : 'translateY(28px)',
        transition: `opacity 0.55s ease ${delay}ms, transform 0.55s ease ${delay}ms`,
      }}
    >
      {children}
    </div>
  );
}

const FEATURES = [
  {
    icon: GitBranch,
    title: 'Public or private — just deploy',
    desc: 'Connect your GitHub or GitLab account and deploy any repo — public or private. Or paste a URL directly. No tokens to manage.',
  },
  {
    icon: Code,
    title: 'Works with your language',
    desc: 'Supports 9 popular languages and frameworks. Pick yours from the list and everything is set up correctly for you.',
  },
  {
    icon: Eye,
    title: 'Watch it go live',
    desc: "See your project build step by step in real time. You're never left staring at a spinner wondering what's happening.",
  },
  {
    icon: Lock,
    title: 'Keep your secrets safe',
    desc: 'Store API keys and passwords securely in the dashboard. They stay private and are never exposed in your code.',
  },
  {
    icon: Globe,
    title: 'A link you can share',
    desc: 'Every project gets its own URL the moment it goes live. Copy it and share it with anyone, instantly.',
  },
  {
    icon: Shield,
    title: 'Safe by default',
    desc: 'Every project is automatically checked for known security issues before it goes live. No extra steps needed.',
  },
  {
    icon: RefreshCw,
    title: 'Redeploy in one click',
    desc: 'Push new code to GitHub and hit Deploy again. Your live link updates — same URL, no disruption.',
  },
  {
    icon: LayoutDashboard,
    title: 'Everything in one place',
    desc: 'All your projects, their live links, deployment history, and settings — in a single clean dashboard.',
  },
];

const HOW_IT_WORKS = [
  {
    step: '01',
    icon: GitBranch,
    title: 'Add your project',
    desc: 'Give your project a name, pick your language, and paste a GitHub or GitLab link — or pick a repo from your connected account. That takes about 30 seconds.',
    detail: 'Private repos work too — connect your account once and pick from a list',
  },
  {
    step: '02',
    icon: Rocket,
    title: 'Click Deploy',
    desc: "One button. DropDeploy picks up your project immediately and starts working on it.",
    detail: 'You can deploy multiple projects at the same time',
  },
  {
    step: '03',
    icon: Eye,
    title: 'Watch it go live',
    desc: 'Follow the progress right on your dashboard. Each step is shown as it completes so you always know where things stand.',
    detail: 'If something fails, you see exactly what went wrong',
  },
  {
    step: '04',
    icon: Globe,
    title: 'Share your live link',
    desc: 'Your project is live and has its own URL. Copy it and share it with anyone — teammates, clients, or the whole internet.',
    detail: 'Your link stays the same on every future deploy',
  },
];

const USE_CASES = [
  {
    icon: Code,
    audience: 'Solo Developers',
    tagline: 'Build it. Share it. Move on.',
    desc: 'Stop spending weekends on server setup. Paste your GitHub link, click Deploy, and have a live link ready to share — so you can get back to building.',
    points: ['No server knowledge needed', 'Live link in minutes', 'Redeploy any time'],
  },
  {
    icon: Zap,
    audience: 'Students & Bootcampers',
    tagline: 'Show your work with a real link.',
    desc: "Don't just screenshot your project. Get a real, live URL you can put in your portfolio, send to a recruiter, or share with a friend — in minutes.",
    points: ['9 frameworks supported', 'No cloud account needed', 'Live link to show employers'],
  },
  {
    icon: Shield,
    audience: 'Internal Tools',
    tagline: 'Host tools just for your team.',
    desc: 'Run private dashboards and admin tools on your own setup, with access control built in. Only the people you invite can see or manage what you deploy.',
    points: ['You control the infrastructure', 'Restrict access by role', 'Built-in security checks'],
  },
];

const EXPLORE_PREVIEW = [
  {
    name: 'Portfolio Generator',
    owner: 'alex',
    tags: ['Web App', 'Utility'],
    desc: 'Build a polished portfolio site from your GitHub profile in seconds.',
    liveUrl: true,
    color: 'bg-blue-500/15 text-blue-500',
    initial: 'R',
  },
  {
    name: 'Habit Tracker API',
    owner: 'priya',
    tags: ['API', 'Data Tool'],
    desc: 'A REST API to track daily habits with streaks and reminders.',
    liveUrl: false,
    color: 'bg-green-500/15 text-green-500',
    initial: 'N',
  },
  {
    name: 'Data Viz Dashboard',
    owner: 'marcus',
    tags: ['Dashboard', 'ML / AI'],
    desc: 'Interactive charts and tables for exploring CSV datasets visually.',
    liveUrl: true,
    color: 'bg-violet-500/15 text-violet-500',
    initial: 'P',
  },
];

const HERO_STEPS: { label: string; done: boolean; active: boolean }[] = [
  { label: 'Getting your latest code', done: true, active: false },
  { label: 'Checking for issues', done: true, active: false },
  { label: 'Building your app', done: false, active: true },
  { label: 'Going live', done: false, active: false },
];

export function LandingPage() {
  const heroRef = useRef<HTMLDivElement>(null);
  const [scrollY, setScrollY] = useState(0);
  const [installCopied, setInstallCopied] = useState(false);

  useEffect(() => {
    const handleScroll = () => setScrollY(window.scrollY);
    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  const parallaxOffset = scrollY * 0.2;

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* ── Navbar ── */}
      <nav
        className="fixed top-0 left-0 right-0 z-50 border-b border-border/50 backdrop-blur-md bg-background/80"
        aria-label="Main navigation"
      >
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center gap-8">
              <Link href="/" className="flex items-center gap-2" aria-label="DropDeploy home">
                <Rocket className="h-5 w-5 text-blue-500" aria-hidden="true" />
                <span className="font-bold text-lg tracking-tight">DropDeploy</span>
              </Link>
              <div className="hidden md:flex items-center gap-6 text-sm text-muted-foreground">
                <a href="#features" className="hover:text-foreground transition-colors">Features</a>
                <a href="#how-it-works" className="hover:text-foreground transition-colors">How It Works</a>
                <a href="#cli" className="hover:text-foreground transition-colors flex items-center gap-1.5">
                  <Terminal className="h-3.5 w-3.5" aria-hidden="true" />
                  CLI
                </a>
                <Link href="/explore" className="hover:text-foreground transition-colors flex items-center gap-1.5">
                  <Compass className="h-3.5 w-3.5" aria-hidden="true" />
                  Explore
                </Link>
                <Link href="/docs" className="hover:text-foreground transition-colors flex items-center gap-1.5">
                  <BookOpen className="h-3.5 w-3.5" aria-hidden="true" />
                  Docs
                </Link>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <ThemeToggle variant="ghost" size="icon" />
              <Button variant="ghost" size="sm" asChild>
                <Link href="/login">Log in</Link>
              </Button>
              <Button size="sm" asChild>
                <Link href="/login">Get Started</Link>
              </Button>
            </div>
          </div>
        </div>
      </nav>

      {/* ── Hero ── */}
      <section
        ref={heroRef}
        className="relative min-h-screen flex items-center justify-center overflow-hidden pt-16"
        aria-label="Hero"
      >
        <div
          className="absolute inset-0 opacity-[0.035] dark:opacity-[0.07] pointer-events-none"
          style={{ transform: `translateY(${parallaxOffset}px)` }}
          aria-hidden="true"
        >
          <div
            className="absolute inset-0"
            style={{
              backgroundImage:
                'linear-gradient(rgba(59,130,246,0.6) 1px, transparent 1px), linear-gradient(90deg, rgba(59,130,246,0.6) 1px, transparent 1px)',
              backgroundSize: '64px 64px',
            }}
          />
        </div>
        <div className="absolute top-1/4 -left-32 w-[500px] h-[500px] bg-blue-500/10 rounded-full blur-3xl pointer-events-none" aria-hidden="true" />
        <div className="absolute bottom-1/4 -right-32 w-[500px] h-[500px] bg-violet-500/10 rounded-full blur-3xl pointer-events-none" aria-hidden="true" />

        <div className="relative max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 text-center py-24">
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full border border-border bg-muted/60 text-xs text-muted-foreground mb-8 select-none">
            <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" aria-hidden="true" />
            GitHub & GitLab · Public & private repos · 9 frameworks
            <ChevronRight className="h-3 w-3" aria-hidden="true" />
          </div>

          <h1 className="text-5xl sm:text-6xl lg:text-7xl font-bold tracking-tight leading-[1.08] mb-6">
            Your project,{' '}
            <span className="text-blue-500">live on the internet.</span>
          </h1>

          <p className="text-xl text-muted-foreground max-w-xl mx-auto mb-10 leading-relaxed">
            Connect GitHub or GitLab, pick any repo — public or private — click Deploy.
            DropDeploy builds and hosts your app — share it with anyone in seconds.
          </p>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-4 mb-5">
            <Button size="lg" className="text-base px-8 h-12 gap-2" asChild>
              <Link href="/login">
                Get Started Free
                <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </Link>
            </Button>
            <Button size="lg" variant="outline" className="text-base px-8 h-12" asChild>
              <a href="#how-it-works">See How It Works</a>
            </Button>
          </div>

          {/* CLI hint */}
          <div className="flex items-center justify-center gap-2.5 mb-14">
            <span className="text-xs text-muted-foreground/60">or via CLI</span>
            <button
              type="button"
              onClick={() => {
                navigator.clipboard.writeText('npm install -g dropdeploy-cli').then(() => {
                  setInstallCopied(true);
                  setTimeout(() => setInstallCopied(false), 2000);
                });
              }}
              className="inline-flex items-center gap-2 rounded-md border border-border bg-muted/40 px-3 py-1.5 font-mono text-xs text-muted-foreground hover:text-foreground hover:bg-muted/70 transition-colors cursor-pointer group"
              aria-label="Copy CLI install command"
            >
              npm install -g dropdeploy-cli
              {installCopied
                ? <Check className="h-3 w-3 text-green-500 flex-shrink-0" aria-hidden="true" />
                : <Copy className="h-3 w-3 text-muted-foreground/40 group-hover:text-muted-foreground flex-shrink-0 transition-colors" aria-hidden="true" />
              }
            </button>
          </div>

          {/* Dashboard mockup */}
          <div
            className="relative max-w-sm mx-auto rounded-xl border border-border bg-card shadow-2xl overflow-hidden text-left"
            role="img"
            aria-label="DropDeploy dashboard showing a project going live"
          >
            <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-muted/40">
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-blue-500" aria-hidden="true" />
                <span className="text-xs font-medium text-muted-foreground">my-portfolio</span>
              </div>
              <span className="text-[10px] text-yellow-500 font-medium">In progress</span>
            </div>

            <div className="p-4 space-y-4">
              <div className="space-y-2.5">
                {HERO_STEPS.map((step) => (
                  <div key={step.label} className="flex items-center gap-3 text-sm">
                    {step.done ? (
                      <CheckCircle2 className="h-4 w-4 text-green-500 flex-shrink-0" aria-hidden="true" />
                    ) : 'active' in step && step.active ? (
                      <Loader2 className="h-4 w-4 text-yellow-500 animate-spin flex-shrink-0" aria-hidden="true" />
                    ) : (
                      <div className="h-4 w-4 rounded-full border border-muted-foreground/30 flex-shrink-0" aria-hidden="true" />
                    )}
                    <span
                      className={
                        step.done
                          ? 'text-muted-foreground'
                          : 'active' in step && step.active
                            ? 'text-foreground font-medium'
                            : 'text-muted-foreground/40'
                      }
                    >
                      {step.label}
                    </span>
                  </div>
                ))}
              </div>

              <div className="flex items-center gap-2 rounded-md border border-dashed border-border bg-muted/30 px-3 py-2">
                <Link2 className="h-3.5 w-3.5 text-muted-foreground/40 flex-shrink-0" aria-hidden="true" />
                <span className="text-xs text-muted-foreground/40 flex-1 truncate">
                  my-portfolio.domain.in
                </span>
                <Copy className="h-3.5 w-3.5 text-muted-foreground/30 flex-shrink-0" aria-hidden="true" />
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── How It Works (combined Problem + Solution + Steps) ── */}
      <section id="how-it-works" className="py-24 bg-muted/30 border-y border-border" aria-labelledby="hiw-heading">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">

          {/* Header */}
          <AnimatedSection className="text-center mb-14">
            <p className="text-blue-500 text-sm font-medium uppercase tracking-widest mb-4">How It Works</p>
            <h2 id="hiw-heading" className="text-4xl sm:text-5xl font-bold mb-6">
              Built for builders, not DevOps engineers.
            </h2>
            <p className="text-xl text-muted-foreground max-w-2xl mx-auto">
              Getting your project live shouldn&apos;t take hours of setup. We handle the hard part — you just click Deploy.
            </p>
          </AnimatedSection>

          {/* Problem strip */}
          <div className="grid md:grid-cols-3 gap-3 mb-10">
            {[
              { icon: Zap,  title: 'Setup takes longer than building', desc: 'Hours of config before anyone can even see your work.' },
              { icon: Code, title: 'Too much to learn just to share',  desc: "Hosting shouldn't require a completely different skill set." },
              { icon: Eye,  title: "When it breaks, you're in the dark", desc: 'No feedback, no trace, no idea what went wrong.' },
            ].map((item, i) => (
              <AnimatedSection key={item.title} delay={i * 80}>
                <div className="flex gap-3 p-4 rounded-lg border border-destructive/20 bg-destructive/5">
                  <item.icon className="h-4 w-4 text-destructive flex-shrink-0 mt-0.5" aria-hidden="true" />
                  <div>
                    <p className="text-sm font-medium mb-0.5">{item.title}</p>
                    <p className="text-xs text-muted-foreground leading-relaxed">{item.desc}</p>
                  </div>
                </div>
              </AnimatedSection>
            ))}
          </div>

          {/* Bridge */}
          <AnimatedSection className="flex items-center gap-4 mb-14">
            <div className="flex-1 h-px bg-border" aria-hidden="true" />
            <span className="text-sm font-medium text-blue-500 px-3 whitespace-nowrap">DropDeploy fixes this in four steps</span>
            <div className="flex-1 h-px bg-border" aria-hidden="true" />
          </AnimatedSection>

          {/* Steps + mockup */}
          <div className="grid lg:grid-cols-2 gap-16 items-start">

            <div className="relative">
              <div
                className="absolute left-[23px] top-10 bottom-10 w-px bg-gradient-to-b from-blue-500/40 via-border to-border hidden sm:block"
                aria-hidden="true"
              />
              <div className="space-y-10">
                {HOW_IT_WORKS.map((item, i) => (
                  <AnimatedSection key={item.step} delay={i * 100}>
                    <div className="flex gap-6">
                      <div className="flex-shrink-0">
                        <div className="w-12 h-12 rounded-full bg-background border-2 border-blue-500/40 flex items-center justify-center relative z-10">
                          <item.icon className="h-5 w-5 text-blue-500" aria-hidden="true" />
                        </div>
                      </div>
                      <div className="pb-2">
                        <div className="text-xs font-mono text-blue-500 mb-1">Step {item.step}</div>
                        <h3 className="font-semibold text-xl mb-2">{item.title}</h3>
                        <p className="text-muted-foreground leading-relaxed mb-2 text-sm">{item.desc}</p>
                        <p className="text-xs text-muted-foreground/60 border-l-2 border-blue-500/20 pl-3">
                          {item.detail}
                        </p>
                      </div>
                    </div>
                  </AnimatedSection>
                ))}
              </div>
            </div>

            <AnimatedSection delay={200} className="lg:sticky lg:top-24">
              <div className="rounded-xl border border-border bg-card p-6 shadow-lg">
                <div className="flex items-center justify-between mb-5">
                  <div>
                    <p className="text-sm font-medium">my-portfolio</p>
                    <p className="text-xs text-muted-foreground mt-0.5">github.com/you/my-portfolio</p>
                  </div>
                  <span className="text-xs text-green-500 bg-green-500/10 px-2.5 py-0.5 rounded-full font-medium">
                    ● Live
                  </span>
                </div>
                <div className="space-y-2.5 mb-5">
                  {[
                    'Got your latest code',
                    'No security issues found',
                    'App built successfully',
                    'App is now running',
                    'Your link is ready to share',
                  ].map((step) => (
                    <div key={step} className="flex items-center gap-3 text-sm">
                      <Check className="h-4 w-4 text-green-500 flex-shrink-0" aria-hidden="true" />
                      <span className="text-muted-foreground">{step}</span>
                    </div>
                  ))}
                </div>
                <div className="rounded-md border bg-muted/40 px-3 py-2 flex items-center gap-2">
                  <span className="text-xs text-muted-foreground flex-1 truncate">
                    https://my-portfolio.domain.in
                  </span>
                  <Copy className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" aria-hidden="true" />
                  <ExternalLink className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" aria-hidden="true" />
                </div>
              </div>
            </AnimatedSection>

          </div>
        </div>
      </section>

      {/* ── Features ── */}
      <section id="features" className="py-24" aria-labelledby="features-heading">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          <AnimatedSection className="text-center mb-16">
            <p className="text-blue-500 text-sm font-medium uppercase tracking-widest mb-4">Features</p>
            <h2 id="features-heading" className="text-4xl sm:text-5xl font-bold mb-6">
              Everything you need to go from idea to live.
            </h2>
            <p className="text-xl text-muted-foreground max-w-2xl mx-auto">
              No setup. No expertise. Just your project and a button.
            </p>
          </AnimatedSection>

          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {FEATURES.map((feature, i) => (
              <AnimatedSection key={feature.title} delay={(i % 3) * 80}>
                <div className="group p-6 rounded-xl border border-border bg-card hover:border-blue-500/40 hover:shadow-lg hover:shadow-blue-500/5 transition-all duration-300 h-full">
                  <div className="w-10 h-10 rounded-lg bg-blue-500/10 group-hover:bg-blue-500/20 flex items-center justify-center mb-4 transition-colors">
                    <feature.icon className="h-5 w-5 text-blue-500" aria-hidden="true" />
                  </div>
                  <h3 className="font-semibold mb-2">{feature.title}</h3>
                  <p className="text-muted-foreground text-sm leading-relaxed">{feature.desc}</p>
                </div>
              </AnimatedSection>
            ))}
          </div>
        </div>
      </section>

      {/* ── Explore ── */}
      <section id="explore" className="py-24 bg-muted/30 border-y border-border" aria-labelledby="explore-heading">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          <AnimatedSection className="text-center mb-12">
            <p className="text-blue-500 text-sm font-medium uppercase tracking-widest mb-4">Explore</p>
            <h2 id="explore-heading" className="text-4xl sm:text-5xl font-bold mb-6">
              Discover what the community is building.
            </h2>
            <p className="text-xl text-muted-foreground max-w-2xl mx-auto mb-8">
              Browse apps, APIs, and tools deployed by other developers. Publish your own project and let the world find it.
            </p>
            <Button size="lg" className="text-base px-8 h-12 gap-2" asChild>
              <Link href="/explore">
                <Compass className="h-4 w-4" aria-hidden="true" />
                Browse Explore
                <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </Link>
            </Button>
          </AnimatedSection>

          <AnimatedSection delay={120} className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4 pointer-events-none select-none">
            {EXPLORE_PREVIEW.map((item) => (
              <div
                key={item.name}
                className="rounded-xl border border-border bg-card p-5 flex flex-col gap-4"
                aria-hidden="true"
              >
                <div className="flex items-start gap-3">
                  <div className={`shrink-0 w-8 h-8 rounded-lg flex items-center justify-center font-bold text-sm ${item.color}`}>
                    {item.initial}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold text-sm truncate">{item.name}</p>
                    <p className="text-xs text-muted-foreground">by {item.owner}</p>
                  </div>
                </div>
                <p className="text-sm text-muted-foreground line-clamp-2 flex-1">{item.desc}</p>
                <div className="flex items-center justify-between gap-2">
                  <div className="flex flex-wrap gap-1">
                    {item.tags.map((t) => (
                      <span key={t} className="rounded-full border border-border px-2 py-0.5 text-xs text-muted-foreground">
                        {t}
                      </span>
                    ))}
                  </div>
                  {item.liveUrl && <Globe className="h-3.5 w-3.5 text-muted-foreground shrink-0" aria-hidden="true" />}
                </div>
              </div>
            ))}
          </AnimatedSection>
        </div>
      </section>

      {/* ── Who It's For ── */}
      <section id="use-cases" className="py-24" aria-labelledby="use-cases-heading">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          <AnimatedSection className="text-center mb-16">
            <p className="text-blue-500 text-sm font-medium uppercase tracking-widest mb-4">Who It&apos;s For</p>
            <h2 id="use-cases-heading" className="text-4xl sm:text-5xl font-bold mb-6">
              Built for every kind of builder.
            </h2>
            <p className="text-xl text-muted-foreground max-w-2xl mx-auto">
              Whether you&apos;re shipping your first project or managing a team, DropDeploy gets out of your way.
            </p>
          </AnimatedSection>

          <div className="grid sm:grid-cols-2 gap-6">
            {USE_CASES.map((item, i) => (
              <AnimatedSection key={item.audience} delay={i * 80}>
                <div className="flex gap-6 p-8 rounded-2xl border border-border bg-card hover:border-blue-500/30 hover:shadow-md transition-all h-full">
                  <div className="flex-shrink-0">
                    <div className="w-12 h-12 rounded-xl bg-blue-500/10 flex items-center justify-center">
                      <item.icon className="h-6 w-6 text-blue-500" aria-hidden="true" />
                    </div>
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs font-medium text-blue-500 uppercase tracking-widest mb-1">{item.audience}</p>
                    <h3 className="font-bold text-xl mb-2">{item.tagline}</h3>
                    <p className="text-muted-foreground text-sm leading-relaxed mb-5">{item.desc}</p>
                    <ul className="space-y-2" aria-label={`Benefits for ${item.audience}`}>
                      {item.points.map((p) => (
                        <li key={p} className="flex items-center gap-2 text-sm text-muted-foreground">
                          <Check className="h-4 w-4 text-green-500 flex-shrink-0" aria-hidden="true" />
                          {p}
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              </AnimatedSection>
            ))}
          </div>
        </div>
      </section>

      {/* ── CLI ── */}
      <section id="cli" className="py-24 bg-muted/30 border-y border-border" aria-labelledby="cli-heading">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid lg:grid-cols-2 gap-16 items-center">

            {/* Terminal mockup */}
            <AnimatedSection>
              <div className="rounded-xl border border-border bg-zinc-950 overflow-hidden shadow-2xl">
                {/* Title bar */}
                <div className="flex items-center gap-2 px-4 py-3 border-b border-zinc-800">
                  <div className="w-3 h-3 rounded-full bg-red-500/80" />
                  <div className="w-3 h-3 rounded-full bg-yellow-500/80" />
                  <div className="w-3 h-3 rounded-full bg-green-500/80" />
                  <span className="ml-2 text-xs text-zinc-500 font-mono">terminal</span>
                </div>
                <div className="p-5 font-mono text-sm space-y-1 leading-relaxed">
                  <p className="text-zinc-500"># install once</p>
                  <p>
                    <span className="text-blue-400">$</span>
                    <span className="text-zinc-200"> npm install -g dropdeploy-cli</span>
                  </p>
                  <p className="text-zinc-500 pt-2"># log in</p>
                  <p>
                    <span className="text-blue-400">$</span>
                    <span className="text-zinc-200"> dropdeploy auth login</span>
                  </p>
                  <p className="text-zinc-400 pl-2">Email: you@example.com</p>
                  <p className="text-zinc-400 pl-2">Password: ••••••••</p>
                  <p className="text-green-400 pl-2">✓ Logged in</p>
                  <p className="text-zinc-500 pt-2"># deploy from any repo</p>
                  <p>
                    <span className="text-blue-400">$</span>
                    <span className="text-zinc-200"> dropdeploy deploy</span>
                  </p>
                  <div className="pt-1 space-y-0.5 text-xs">
                    <p className="text-zinc-400">  Checking repository… <span className="text-green-400">✓</span></p>
                    <p className="text-zinc-400">  Detecting framework… <span className="text-green-400">✓  NEXTJS</span></p>
                    <p className="text-zinc-400">  Triggering deployment… <span className="text-green-400">✓</span></p>
                    <p className="text-zinc-400">  › Cloning repository</p>
                    <p className="text-zinc-400">  › Building Docker image</p>
                    <p className="text-zinc-400">  › Starting container</p>
                    <p className="text-green-400 pt-1 font-semibold">✓ Deployed successfully</p>
                    <p className="text-zinc-400">  Live URL → <span className="text-blue-400">https://my-app.dropdeploy.app</span></p>
                  </div>
                </div>
              </div>
            </AnimatedSection>

            {/* Copy */}
            <AnimatedSection delay={150} className="space-y-8">
              <div>
                <div className="inline-flex items-center gap-2 rounded-full border border-blue-500/30 bg-blue-500/5 px-3 py-1 text-xs font-medium text-blue-500 uppercase tracking-widest mb-4">
                  <Terminal className="h-3.5 w-3.5" />
                  CLI
                </div>
                <h2 id="cli-heading" className="text-4xl sm:text-5xl font-bold mb-4">
                  Deploy without leaving your terminal.
                </h2>
                <p className="text-lg text-muted-foreground leading-relaxed">
                  Install <code className="rounded bg-muted px-1.5 py-0.5 text-sm font-mono">dropdeploy-cli</code> once and deploy any project with a single command — no browser required.
                </p>
              </div>

              <div className="space-y-5">
                {[
                  {
                    icon: Package,
                    title: 'One install, use everywhere',
                    desc: 'Install globally with npm and the dropdeploy command is available in every project on your machine.',
                  },
                  {
                    icon: Zap,
                    title: 'Auto-detects your framework',
                    desc: 'No flags needed. The CLI reads your repo and picks the right build pipeline automatically.',
                  },
                  {
                    icon: Eye,
                    title: 'Live build output, streamed',
                    desc: 'Watch every build step in real time — cloning, installing, building, starting — with a live progress bar.',
                  },
                  {
                    icon: Lock,
                    title: 'CI-ready',
                    desc: 'Set DROPDEPLOY_TOKEN and DROPDEPLOY_URL as environment variables and deploy from any pipeline.',
                  },
                ].map((item) => (
                  <div key={item.title} className="flex gap-4">
                    <div className="w-9 h-9 rounded-lg bg-blue-500/10 flex items-center justify-center flex-shrink-0 mt-0.5">
                      <item.icon className="h-4 w-4 text-blue-500" aria-hidden="true" />
                    </div>
                    <div>
                      <h3 className="font-semibold mb-0.5 text-sm">{item.title}</h3>
                      <p className="text-muted-foreground text-sm leading-relaxed">{item.desc}</p>
                    </div>
                  </div>
                ))}
              </div>

              <div className="flex items-center gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => {
                    navigator.clipboard.writeText('npm install -g dropdeploy-cli').then(() => {
                      setInstallCopied(true);
                      setTimeout(() => setInstallCopied(false), 2000);
                    });
                  }}
                  className="flex-1 flex items-center gap-2 rounded-lg border border-border bg-muted/40 px-4 py-2.5 font-mono text-sm text-foreground hover:bg-muted/70 transition-colors cursor-pointer group text-left"
                  aria-label="Copy install command"
                >
                  <span className="flex-1">npm install -g dropdeploy-cli</span>
                  {installCopied
                    ? <Check className="h-3.5 w-3.5 text-green-500 flex-shrink-0" aria-hidden="true" />
                    : <Copy className="h-3.5 w-3.5 text-muted-foreground/50 group-hover:text-muted-foreground flex-shrink-0 transition-colors" aria-hidden="true" />
                  }
                </button>
                <Button variant="outline" size="sm" className="shrink-0" asChild>
                  <a href="https://www.npmjs.com/package/dropdeploy-cli" target="_blank" rel="noopener noreferrer">
                    <ExternalLink className="h-3.5 w-3.5 mr-1.5" />
                    npm
                  </a>
                </Button>
              </div>
            </AnimatedSection>

          </div>
        </div>
      </section>

      {/* ── Final CTA ── */}
      <section className="py-24 border-t border-border bg-muted/30 relative overflow-hidden" aria-labelledby="cta-heading">
        <div
          className="absolute inset-0 opacity-[0.025] dark:opacity-[0.05] pointer-events-none"
          aria-hidden="true"
        >
          <div
            className="absolute inset-0"
            style={{
              backgroundImage:
                'linear-gradient(rgba(59,130,246,0.6) 1px, transparent 1px), linear-gradient(90deg, rgba(59,130,246,0.6) 1px, transparent 1px)',
              backgroundSize: '64px 64px',
            }}
          />
        </div>
        <div className="relative max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <AnimatedSection>
            <h2 id="cta-heading" className="text-4xl sm:text-5xl font-bold mb-6">
              Ready to share your project with the world?
            </h2>
            <p className="text-xl text-muted-foreground max-w-2xl mx-auto mb-10">
              Sign in, connect GitHub or GitLab, pick your repo, and click Deploy. Your project is live in minutes — public or private, no setup required.
            </p>
            <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
              <Button size="lg" className="text-base px-10 h-12 gap-2" asChild>
                <Link href="/login">
                  Get Started Free
                  <ArrowRight className="h-4 w-4" aria-hidden="true" />
                </Link>
              </Button>
              <Button size="lg" variant="outline" className="text-base px-10 h-12" asChild>
                <a href="#how-it-works">See How It Works</a>
              </Button>
            </div>
          </AnimatedSection>
        </div>
      </section>

      {/* ── Footer ── */}
      <footer className="border-t border-border py-10">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
            <div className="flex items-center gap-2">
              <Rocket className="h-4 w-4 text-blue-500" aria-hidden="true" />
              <span className="font-semibold">DropDeploy</span>
            </div>
            <p className="text-sm text-muted-foreground">Your project, live on the internet. No setup required.</p>
            <div className="flex items-center gap-5 text-sm text-muted-foreground">
              <Link href="/explore" className="hover:text-foreground transition-colors">Explore</Link>
              <Link href="/docs" className="hover:text-foreground transition-colors">Docs</Link>
              <a href="#" className="hover:text-foreground transition-colors">Privacy</a>
              <a href="#" className="hover:text-foreground transition-colors">Terms</a>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
