'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import { FaHtml5, FaNodeJs, FaReact, FaJava, FaRust } from 'react-icons/fa';
import { SiNextdotjs, SiDjango, SiFastapi, SiFlask, SiVuedotjs, SiSvelte, SiGo } from 'react-icons/si';

const NAV_SECTIONS = [
  {
    title: 'Getting Started',
    items: [
      { href: '/docs/getting-started', label: 'Project Creation' },
      { href: '/docs/git-setup', label: 'Git Setup' },
      { href: '/docs/local-dev', label: 'Local Development' },
    ],
  },
  {
    title: 'Frameworks',
    items: [
      { href: '/docs/frameworks/static',  label: 'Static HTML',       Icon: () => <FaHtml5   size={12} className="text-orange-500 shrink-0" /> },
      { href: '/docs/frameworks/nodejs',  label: 'Node.js',           Icon: () => <FaNodeJs  size={12} className="text-green-600 shrink-0" /> },
      { href: '/docs/frameworks/nextjs',  label: 'Next.js',           Icon: () => <SiNextdotjs size={12} className="text-foreground shrink-0" /> },
      { href: '/docs/frameworks/react',   label: 'React',             Icon: () => <FaReact   size={12} className="text-cyan-400 shrink-0" /> },
      { href: '/docs/frameworks/vue',     label: 'Vue',               Icon: () => <SiVuedotjs size={12} className="text-emerald-500 shrink-0" /> },
      { href: '/docs/frameworks/svelte',  label: 'Svelte',            Icon: () => <SiSvelte  size={12} className="text-orange-600 shrink-0" /> },
      { href: '/docs/frameworks/django',  label: 'Django',            Icon: () => <SiDjango  size={12} className="text-green-800 dark:text-green-500 shrink-0" /> },
      { href: '/docs/frameworks/fastapi', label: 'FastAPI',           Icon: () => <SiFastapi size={12} className="text-teal-500 shrink-0" /> },
      { href: '/docs/frameworks/flask',   label: 'Flask',             Icon: () => <SiFlask   size={12} className="text-foreground shrink-0" /> },
      { href: '/docs/frameworks/go',      label: 'Go',                Icon: () => <SiGo      size={12} className="text-cyan-500 shrink-0" /> },
      { href: '/docs/frameworks/rust',    label: 'Rust',              Icon: () => <FaRust    size={12} className="text-orange-700 shrink-0" /> },
      { href: '/docs/frameworks/java',    label: 'Java / Spring Boot', Icon: () => <FaJava   size={12} className="text-red-600 shrink-0" /> },
    ],
  },
];

export function DocsSidebar(): React.ReactElement {
  const pathname = usePathname();

  return (
    <nav className="space-y-6 text-sm" aria-label="Documentation navigation">
      {NAV_SECTIONS.map((section) => (
        <div key={section.title}>
          <p className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground mb-1.5 px-2">
            {section.title}
          </p>
          <ul className="space-y-0.5">
            {section.items.map((item) => {
              const isActive = pathname === item.href;
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    className={cn(
                      'flex items-center gap-2 px-2 py-1.5 rounded-md transition-colors',
                      isActive
                        ? 'bg-primary/10 text-primary font-medium'
                        : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
                    )}
                  >
                    {'Icon' in item && <item.Icon />}
                    {item.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}
