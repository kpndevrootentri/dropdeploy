'use client';

import { useTheme } from 'next-themes';
import { Toaster as Sonner, type ToasterProps } from 'sonner';

function Toaster({ ...props }: ToasterProps): React.ReactElement {
  const { theme = 'system' } = useTheme();

  return (
    <Sonner
      theme={theme as ToasterProps['theme']}
      className="toaster group"
      style={
        {
          // The theme tokens are bare HSL channels (globals.css), so they need hsl() to be a colour.
          '--normal-bg': 'hsl(var(--popover))',
          '--normal-text': 'hsl(var(--popover-foreground))',
          '--normal-border': 'hsl(var(--border))',
          '--width': 'min(360px, calc(100vw - 2rem))',
        } as React.CSSProperties
      }
      {...props}
    />
  );
}

export { Toaster };
