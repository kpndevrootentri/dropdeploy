import type { Metadata } from 'next';
import { LandingPage } from '@/components/landing/landing-page';

export const metadata: Metadata = {
  title: 'DropDeploy — Deploy Projects Instantly',
  description:
    'Deploy your projects instantly by dragging a folder or pasting a GitHub URL. Automatic containerization, real-time logs, and zero DevOps expertise required.',
  keywords: ['deployment', 'docker', 'developer tools', 'CI/CD', 'GitHub', 'container'],
  openGraph: {
    title: 'DropDeploy — Deploy Projects Instantly',
    description:
      'Drop a folder or paste a GitHub URL. DropDeploy handles containerization, routing, and real-time logs in under 30 seconds.',
    type: 'website',
  },
};

export default function HomePage(): React.ReactElement {
  return <LandingPage />;
}
