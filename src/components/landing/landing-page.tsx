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
    title: 'Paste a link, deploy instantly',
    desc: 'Just paste your GitHub link. No files to upload, no setup to configure. DropDeploy takes it from there.',
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
    desc: 'Give your project a name, choose your language from the list, and paste your GitHub link. That takes about 30 seconds.',
    detail: 'No account setup, no config files, no terminal',
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

const HERO_STEPS: { label: string; done: boolean; active: boolean }[] = [
  { label: 'Getting your latest code', done: true, active: false },
  { label: 'Checking for issues', done: true, active: false },
  { label: 'Building your app', done: false, active: true },
  { label: 'Going live', done: false, active: false },
];

export function LandingPage() {
  const heroRef = useRef<HTMLDivElement>(null);
  const [scrollY, setScrollY] = useState(0);

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
                <a href="#use-cases" className="hover:text-foreground transition-colors">Who It&apos;s For</a>
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
            Works with 9 popular languages and frameworks
            <ChevronRight className="h-3 w-3" aria-hidden="true" />
          </div>

          <h1 className="text-5xl sm:text-6xl lg:text-7xl font-bold tracking-tight leading-[1.08] mb-6">
            Your project,{' '}
            <span className="text-blue-500">live on the internet.</span>
          </h1>

          <p className="text-xl text-muted-foreground max-w-xl mx-auto mb-10 leading-relaxed">
            Paste your GitHub link, pick your language, click Deploy.
            DropDeploy builds and hosts your app — share it with anyone in seconds.
          </p>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-4 mb-16">
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

      {/* ── Problem ── */}
      <section className="py-24 bg-muted/30 border-y border-border" aria-labelledby="problem-heading">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          <AnimatedSection className="text-center mb-16">
            <p className="text-blue-500 text-sm font-medium uppercase tracking-widest mb-4">The Problem</p>
            <h2 id="problem-heading" className="text-4xl sm:text-5xl font-bold mb-6">
              Getting your project online is harder than it should be.
            </h2>
            <p className="text-xl text-muted-foreground max-w-2xl mx-auto">
              You built something great. Sharing it with the world shouldn&apos;t take hours of setup.
            </p>
          </AnimatedSection>

          <div className="grid md:grid-cols-3 gap-8">
            {[
              {
                icon: Zap,
                title: 'Setup takes longer than building',
                description:
                  'Before anyone can see your project, you spend hours on things that have nothing to do with what you actually built.',
              },
              {
                icon: Code,
                title: 'Too much to learn just to share',
                description:
                  "Hosting an app online shouldn't require learning a completely separate set of skills. You should be able to just press publish.",
              },
              {
                icon: Eye,
                title: "When something breaks, you're in the dark",
                description:
                  "Something went wrong, but you have no idea where. No feedback, no way to trace the problem, no idea what to fix.",
              },
            ].map((item, i) => (
              <AnimatedSection key={item.title} delay={i * 100}>
                <div className="p-6 rounded-xl border border-border bg-card hover:border-red-500/20 transition-colors h-full">
                  <div className="w-10 h-10 rounded-lg bg-destructive/10 flex items-center justify-center mb-4">
                    <item.icon className="h-5 w-5 text-destructive" aria-hidden="true" />
                  </div>
                  <h3 className="font-semibold text-lg mb-2">{item.title}</h3>
                  <p className="text-muted-foreground leading-relaxed text-sm">{item.description}</p>
                </div>
              </AnimatedSection>
            ))}
          </div>
        </div>
      </section>

      {/* ── Solution ── */}
      <section className="py-24" aria-labelledby="solution-heading">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          <AnimatedSection className="text-center mb-16">
            <p className="text-blue-500 text-sm font-medium uppercase tracking-widest mb-4">The Solution</p>
            <h2 id="solution-heading" className="text-4xl sm:text-5xl font-bold mb-6">
              We handle the hard part. You just click Deploy.
            </h2>
            <p className="text-xl text-muted-foreground max-w-2xl mx-auto">
              DropDeploy is a simple web dashboard. Fill in three fields, click one button, and your project is live.
            </p>
          </AnimatedSection>

          <div className="grid lg:grid-cols-2 gap-16 items-center">
            <AnimatedSection className="space-y-7">
              {[
                {
                  icon: GitBranch,
                  title: 'Your code, always up to date',
                  desc: 'Paste your GitHub link once. Every time you deploy, DropDeploy grabs your latest code automatically.',
                },
                {
                  icon: Code,
                  title: 'Pick your language, we do the rest',
                  desc: 'Choose from 9 popular options. DropDeploy knows exactly how to set up each one — you never have to figure it out.',
                },
                {
                  icon: Shield,
                  title: 'Projects never interfere with each other',
                  desc: 'Each project runs in its own isolated space. One project going down or acting up never affects another.',
                },
                {
                  icon: Eye,
                  title: 'Always know what&apos;s happening',
                  desc: 'Watch your project go live step by step. If something fails, you see exactly where and why — no guessing.',
                },
              ].map((item) => (
                <div key={item.title} className="flex gap-4">
                  <div className="w-10 h-10 rounded-lg bg-blue-500/10 flex items-center justify-center flex-shrink-0 mt-0.5">
                    <item.icon className="h-5 w-5 text-blue-500" aria-hidden="true" />
                  </div>
                  <div>
                    <h3 className="font-semibold mb-1">{item.title}</h3>
                    <p className="text-muted-foreground text-sm leading-relaxed">{item.desc}</p>
                  </div>
                </div>
              ))}
            </AnimatedSection>

            <AnimatedSection delay={200}>
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
      <section id="features" className="py-24 bg-muted/30 border-y border-border" aria-labelledby="features-heading">
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

      {/* ── How It Works ── */}
      <section id="how-it-works" className="py-24" aria-labelledby="hiw-heading">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          <AnimatedSection className="text-center mb-16">
            <p className="text-blue-500 text-sm font-medium uppercase tracking-widest mb-4">How It Works</p>
            <h2 id="hiw-heading" className="text-4xl sm:text-5xl font-bold mb-6">
              Four steps. That&apos;s it.
            </h2>
            <p className="text-xl text-muted-foreground max-w-2xl mx-auto">
              No terminal. No config files. No documentation to read first.
            </p>
          </AnimatedSection>

          <div className="relative">
            <div
              className="absolute left-[23px] top-10 bottom-10 w-px bg-gradient-to-b from-blue-500/40 via-border to-border hidden sm:block"
              aria-hidden="true"
            />
            <div className="space-y-12">
              {HOW_IT_WORKS.map((item, i) => (
                <AnimatedSection key={item.step} delay={i * 100}>
                  <div className="flex gap-6 sm:gap-8">
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
        </div>
      </section>

      {/* ── Who It's For ── */}
      <section id="use-cases" className="py-24 bg-muted/30 border-y border-border" aria-labelledby="use-cases-heading">
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
              Sign in, paste your GitHub link, and click Deploy. Your project is live in minutes — no setup, no expertise required.
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
              <a href="#" className="hover:text-foreground transition-colors">Privacy</a>
              <a href="#" className="hover:text-foreground transition-colors">Terms</a>
              <a href="#" className="hover:text-foreground transition-colors">GitHub</a>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
