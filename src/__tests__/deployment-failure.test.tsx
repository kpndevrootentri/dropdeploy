/**
 * @jest-environment jsdom
 */
import { Suspense } from 'react';
import { act, render, screen } from '@testing-library/react';
import { DeploymentFailure } from '@/components/features/deployment-failure';
import BatchProjectsPage from '@/app/(dashboard)/dashboard/batches/[cohortId]/page';

jest.mock('sonner', () => ({ toast: { error: jest.fn() } }));
jest.mock('@/components/features/add-students-dialog', () => ({ AddStudentsDialog: () => null }));
const mockRequest = jest.fn();
jest.mock('@/components/admin/admin-request', () => ({ adminRequest: (url: string) => mockRequest(url) }));

describe('DeploymentFailure', () => {
  it('names the step in plain words, then the reason', () => {
    render(<DeploymentFailure buildStep="BUILDING_IMAGE" failureReason='npm error Missing script: "build"' />);
    expect(screen.getByText(/Failed while building/).closest('p')?.textContent).toBe('Failed while building: npm error Missing script: "build"');
  });

  it('shows what is known for older deployments, and nothing when neither is', () => {
    const { container, rerender } = render(<DeploymentFailure buildStep="STARTING" failureReason={null} />);
    expect(container.textContent).toBe('Failed while starting the app');
    rerender(<DeploymentFailure buildStep={null} failureReason="The project has no repository to build from." />);
    expect(container.textContent).toBe('Failed: The project has no repository to build from.');
    rerender(<DeploymentFailure buildStep={null} failureReason={null} />);
    expect(container.textContent).toBe('');
  });
});

describe('the mentor batch page', () => {
  it("shows why a student's latest deployment failed", async () => {
    mockRequest.mockImplementation(async (url: string) => url.endsWith('/projects')
      ? [{
        id: 'p1', name: 'portfolio', slug: 'portfolio', type: 'NODEJS', isPrivate: false,
        user: { id: 's1', email: 'student@entri.me', name: null },
        deployments: [{ id: 'd1', status: 'FAILED', containerPort: null, createdAt: '2026-11-01T00:00:00.000Z', buildStep: 'CLONING', failureReason: 'fatal: Remote branch dev not found in upstream origin' }],
      }]
      : {
        cohort: { id: 'c1', name: 'FSD', program: 'Full Stack', startsAt: '2026-11-01T00:00:00.000Z', endsAt: '2027-01-01T00:00:00.000Z', archivedAt: null },
        joinLink: null,
        students: [],
      });
    await act(async () => {
      render(<Suspense><BatchProjectsPage params={Promise.resolve({ cohortId: 'c1' })} /></Suspense>);
    });
    expect((await screen.findByText(/Failed while getting the code/)).closest('p')?.textContent)
      .toBe('Failed while getting the code: fatal: Remote branch dev not found in upstream origin');
  });
});
