import { redirect } from 'next/navigation';

export default function DocsPage(): never {
  redirect('/docs/getting-started');
}
