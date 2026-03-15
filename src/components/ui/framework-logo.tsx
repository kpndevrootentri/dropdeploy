import { cn } from '@/lib/utils';
import { FaHtml5, FaNodeJs, FaReact } from 'react-icons/fa';
import { SiNextdotjs, SiDjango, SiFastapi, SiFlask, SiVuedotjs, SiSvelte, SiAndroid } from 'react-icons/si';

const BASE_DOMAIN =
  typeof process !== 'undefined' && process.env?.NEXT_PUBLIC_BASE_DOMAIN
    ? process.env.NEXT_PUBLIC_BASE_DOMAIN
    : 'domain.in';

/** True when app is running on localhost (dev); use port-based deploy URLs when available. */
function isLocalhostDev(): boolean {
  if (typeof process === 'undefined') return false;
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? '';
  return appUrl.includes('localhost') || process.env.NEXT_PUBLIC_USE_LOCALHOST_DEPLOY_URL === 'true';
}

export const FRAMEWORK_CONFIG = {
  STATIC: {
    label: 'Static',
    Logo: ({ size = 24, className }: { size?: number; className?: string }) => (
      <FaHtml5 size={size} className={cn('shrink-0 text-orange-500', className)} aria-hidden="true" />
    ),
    description: 'HTML / CSS / JS',
  },
  NODEJS: {
    label: 'Node.js',
    Logo: ({ size = 24, className }: { size?: number; className?: string }) => (
      <FaNodeJs size={size} className={cn('shrink-0 text-green-600', className)} aria-hidden="true" />
    ),
    description: 'Node.js',
  },
  NEXTJS: {
    label: 'Next.js',
    Logo: ({ size = 24, className }: { size?: number; className?: string }) => (
      <SiNextdotjs size={size} className={cn('shrink-0 text-foreground', className)} aria-hidden="true" />
    ),
    description: 'Next.js',
  },
  DJANGO: {
    label: 'Django',
    Logo: ({ size = 24, className }: { size?: number; className?: string }) => (
      <SiDjango size={size} className={cn('shrink-0 text-green-800', className)} aria-hidden="true" />
    ),
    description: 'Python / Django',
  },
  REACT: {
    label: 'React',
    Logo: ({ size = 24, className }: { size?: number; className?: string }) => (
      <FaReact size={size} className={cn('shrink-0 text-cyan-400', className)} aria-hidden="true" />
    ),
    description: 'React + Vite',
  },
  FASTAPI: {
    label: 'FastAPI',
    Logo: ({ size = 24, className }: { size?: number; className?: string }) => (
      <SiFastapi size={size} className={cn('shrink-0 text-teal-500', className)} aria-hidden="true" />
    ),
    description: 'Python / FastAPI',
  },
  FLASK: {
    label: 'Flask',
    Logo: ({ size = 24, className }: { size?: number; className?: string }) => (
      <SiFlask size={size} className={cn('shrink-0 text-foreground', className)} aria-hidden="true" />
    ),
    description: 'Python / Flask',
  },
  VUE: {
    label: 'Vue',
    Logo: ({ size = 24, className }: { size?: number; className?: string }) => (
      <SiVuedotjs size={size} className={cn('shrink-0 text-emerald-500', className)} aria-hidden="true" />
    ),
    description: 'Vue + Vite',
  },
  SVELTE: {
    label: 'Svelte',
    Logo: ({ size = 24, className }: { size?: number; className?: string }) => (
      <SiSvelte size={size} className={cn('shrink-0 text-orange-600', className)} aria-hidden="true" />
    ),
    description: 'Svelte / SvelteKit',
  },
  ANDROID: {
    label: 'Android',
    Logo: ({ size = 24, className }: { size?: number; className?: string }) => (
      <SiAndroid size={size} className={cn('shrink-0 text-green-500', className)} aria-hidden="true" />
    ),
    description: 'Gradle / APK',
  },
} as const;

export interface FrameworkLogoProps {
  framework: 'STATIC' | 'NODEJS' | 'NEXTJS' | 'DJANGO' | 'REACT' | 'FASTAPI' | 'FLASK' | 'VUE' | 'SVELTE' | 'ANDROID';
  size?: number;
  className?: string;
  showLabel?: boolean;
}

export function FrameworkLogo({
  framework,
  size = 24,
  className,
  showLabel = false,
}: FrameworkLogoProps): React.ReactElement {
  const config = FRAMEWORK_CONFIG[framework] ?? FRAMEWORK_CONFIG.STATIC;
  const { Logo } = config;

  return (
    <span className={cn('inline-flex items-center gap-1.5', className)} title={config.label}>
      <Logo size={size} />
      {showLabel && <span className="text-sm font-medium">{config.label}</span>}
    </span>
  );
}

/**
 * Returns the public URL for a deployed project.
 * In localhost dev (NEXT_PUBLIC_APP_URL has localhost), uses http://localhost:<containerPort> when port is set.
 */
export function getProjectUrl(slug: string, containerPort?: number | null): string {
  if (containerPort != null && isLocalhostDev()) {
    return `http://localhost:${containerPort}`;
  }
  return `https://${slug}.${BASE_DOMAIN}`;
}
