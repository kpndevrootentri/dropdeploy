import Link from 'next/link';
import { ArrowRight, Info } from 'lucide-react';
import { CopyValue } from '@/components/ui/copy-value';

/** Shared by the answer-first docs pages: the heading is the question, the first paragraph its answer. */

export interface DocStep {
  name: string;
  text: string;
  /** A command to copy, shown under the text. */
  command?: string;
  /** Anything else the step needs, such as a download button. */
  action?: React.ReactNode;
}

/** Step text as one string, for HowTo JSON-LD. */
export function stepsForJsonLd(steps: readonly DocStep[]): { name: string; text: string }[] {
  return steps.map((s) => ({ name: s.name, text: s.command ? `${s.text} ${s.command}` : s.text }));
}

export function DocsHeader({ eyebrow, title, children }: { eyebrow: string; title: string; children: React.ReactNode }): React.ReactElement {
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-widest text-blue-500 mb-2">{eyebrow}</p>
      <h1 className="text-3xl font-bold tracking-tight mb-3">{title}</h1>
      <div className="text-muted-foreground leading-relaxed space-y-2">{children}</div>
    </div>
  );
}

export function Code({ children }: { children: React.ReactNode }): React.ReactElement {
  return <code className="rounded bg-muted px-1.5 py-0.5 text-sm font-mono">{children}</code>;
}

export function Pre({ children }: { children: string }): React.ReactElement {
  return (
    <pre className="rounded-lg border border-border bg-muted/60 p-4 overflow-x-auto text-sm font-mono leading-relaxed text-foreground">
      {children}
    </pre>
  );
}

export function Note({ children }: { children: React.ReactNode }): React.ReactElement {
  return (
    <div className="flex gap-3 rounded-lg border border-blue-500/30 bg-blue-500/5 p-4 text-sm">
      <Info className="h-4 w-4 text-blue-500 shrink-0 mt-0.5" aria-hidden="true" />
      <div className="text-muted-foreground leading-relaxed space-y-1">{children}</div>
    </div>
  );
}

export function Steps({ steps }: { steps: readonly DocStep[] }): React.ReactElement {
  return (
    <ol className="space-y-0">
      {steps.map((step, i) => (
        <li key={step.name} className="flex gap-5">
          <div
            className="shrink-0 w-8 h-8 rounded-full bg-blue-500/10 border border-blue-500/30 flex items-center justify-center text-sm font-bold text-blue-500"
            aria-hidden="true"
          >
            {i + 1}
          </div>
          <div className="flex-1 min-w-0 pb-8 border-l border-dashed border-border pl-5 -ml-[21px]">
            <h3 className="font-semibold text-base mb-2 mt-0.5">{step.name}</h3>
            <div className="text-muted-foreground text-sm leading-relaxed space-y-3">
              <p>{step.text}</p>
              {step.command && <CopyValue label="Command" value={step.command} />}
              {step.action}
            </div>
          </div>
        </li>
      ))}
    </ol>
  );
}

/** A short Q&A block; the H2 is the question so answer engines can lift it. */
export function QA({ id, question, children }: { id?: string; question: string; children: React.ReactNode }): React.ReactElement {
  return (
    <section id={id} className="space-y-2 scroll-mt-20">
      <h2 className="text-xl font-semibold">{question}</h2>
      <div className="text-sm text-muted-foreground leading-relaxed space-y-2">{children}</div>
    </section>
  );
}

export function DocsNext({ href, label }: { href: string; label: string }): React.ReactElement {
  return (
    <div className="border-t border-border pt-8 flex items-center justify-between text-sm">
      <span className="text-muted-foreground">Next</span>
      <Link href={href} className="flex items-center gap-1.5 text-blue-500 font-medium hover:underline">
        {label}
        <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
      </Link>
    </div>
  );
}

export function TextLink({ href, children }: { href: string; children: React.ReactNode }): React.ReactElement {
  return <Link href={href} className="text-blue-500 hover:underline">{children}</Link>;
}
