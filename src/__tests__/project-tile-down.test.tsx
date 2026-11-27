/**
 * @jest-environment jsdom
 */
import { render, screen } from '@testing-library/react';
import { ProjectTile, type ProjectItem } from '@/components/features/project-tile';

const project: ProjectItem = {
  id: 'p1', name: 'shop', slug: 'shop', description: null, source: 'GITHUB', type: 'NODEJS', githubUrl: null,
  createdAt: '2026-11-01T00:00:00.000Z', unhealthySince: '2026-11-27T10:00:00.000Z', healthReason: "The site's container is missing.",
  deployments: [{ id: 'd1', status: 'DEPLOYED', subdomain: 'shop', containerPort: 4001, buildStep: null, createdAt: '2026-11-01T00:00:00.000Z' }],
};

describe('ProjectTile', () => {
  it('shows Down with the reason while the health sweep says so', () => {
    render(<ProjectTile project={project} onCopyUrl={jest.fn()} copiedUrl={null} />);
    expect(screen.getByText('Down').getAttribute('title')).toBe("The site's container is missing.");
  });

  it('still shows Down when a redeploy failed and the older live container is the one down', () => {
    const failed = { id: 'd2', status: 'FAILED', subdomain: null, containerPort: null, buildStep: null, createdAt: '2026-11-27T11:00:00.000Z' };
    render(<ProjectTile project={{ ...project, deployments: [failed, ...project.deployments!] }} onCopyUrl={jest.fn()} copiedUrl={null} />);
    expect(screen.getByText('Down').getAttribute('title')).toBe("The site's container is missing.");
  });

  it('shows Stopped, not Down, for a site an admin stopped', () => {
    render(<ProjectTile project={{ ...project, stoppedAt: '2026-11-27T11:00:00.000Z' }} onCopyUrl={jest.fn()} copiedUrl={null} />);
    expect(screen.getByText('Stopped')).toBeTruthy();
    expect(screen.queryByText('Down')).toBeNull();
  });
});
