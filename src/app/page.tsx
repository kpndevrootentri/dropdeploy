import type { Metadata } from 'next';
import { LandingPage } from '@/components/landing/landing-page';

export const metadata: Metadata = {
  title: 'DropDeploy — Deploy Projects Instantly',
  description:
    'Deploy GitHub and GitLab projects instantly — public or private. Automatic containerization, real-time logs, and zero DevOps expertise required.',
  keywords: ['deployment', 'docker', 'developer tools', 'CI/CD', 'GitHub', 'GitLab', 'private repos', 'container'],
  openGraph: {
    title: 'DropDeploy — Deploy Projects Instantly',
    description:
      'Connect GitHub or GitLab, pick any repo — public or private. DropDeploy handles containerization, routing, and real-time logs in under 30 seconds.',
    type: 'website',
  },
};

export default function HomePage(): React.ReactElement {
  return <LandingPage />;
}
